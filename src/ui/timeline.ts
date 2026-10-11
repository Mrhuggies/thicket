// Timeline scrubber: total population as a backdrop, seasons, event marks, the branch head
// and the current position. Drag to preview from keyframes; release to rewind there.

import type { StatsRow } from '../sim/protocol';
import { DAYS_PER_SEASON, DAYS_PER_YEAR, TICKS_PER_DAY } from '../sim/constants';
import { SPECIES } from '../sim/species';
import { SPECIES_COLORS } from '../render/palette';

export class Timeline {
  rows: StatsRow[] = [];
  marks: { tick: number; kind: string; sp: number }[] = [];
  head = 0;
  tick = 0;
  dragTick = -1;
  onPreview: (day: number) => void = () => {};
  onSeek: (tick: number) => void = () => {};
  onHover: (text: string) => void = () => {};
  private g: CanvasRenderingContext2D;
  private lastPreview = -1;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.g = canvas.getContext('2d')!;
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      this.dragTick = this.tickAt(e.clientX);
      this.preview();
      this.draw();
    });
    canvas.addEventListener('pointermove', (e) => {
      const t = this.tickAt(e.clientX);
      const m = this.markNear(e.clientX);
      this.onHover(m ? describeMark(m) : `Day ${Math.floor(t / TICKS_PER_DAY)}`);
      if (this.dragTick < 0) return;
      this.dragTick = t;
      this.preview();
      this.draw();
    });
    canvas.addEventListener('pointerleave', () => this.onHover(''));
    canvas.addEventListener('pointerup', () => {
      if (this.dragTick < 0) return;
      const t = this.dragTick;
      this.dragTick = -1;
      this.lastPreview = -1;
      this.onSeek(t);
    });
  }

  private span(): number {
    return Math.max(this.head, 14 * TICKS_PER_DAY);
  }

  private tickAt(clientX: number): number {
    const r = this.canvas.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    return Math.min(this.head, Math.round(f * this.span()));
  }

  private markNear(clientX: number) {
    const r = this.canvas.getBoundingClientRect();
    const x = clientX - r.left;
    let best: (typeof this.marks)[number] | null = null;
    let bd = 6;
    for (const m of this.marks) {
      const d = Math.abs((m.tick / this.span()) * r.width - x);
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    return best;
  }

  private preview(): void {
    const day = Math.floor(this.dragTick / TICKS_PER_DAY);
    if (day !== this.lastPreview) {
      this.lastPreview = day;
      this.onPreview(day);
    }
  }

  draw(): void {
    const c = this.canvas;
    const r = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(r.width * dpr) || c.height !== Math.round(r.height * dpr)) {
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
    }
    const g = this.g;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = r.width;
    const H = r.height;
    g.clearRect(0, 0, W, H);
    const css = getComputedStyle(document.documentElement);
    const chip = css.getPropertyValue('--chip').trim();
    const line = css.getPropertyValue('--line').trim();
    const accent = css.getPropertyValue('--accent').trim();
    const ink = css.getPropertyValue('--ink').trim();
    const span = this.span();
    const X = (t: number) => (t / span) * W;
    const top = 4;
    const bot = H - 8;

    g.fillStyle = chip;
    g.beginPath();
    g.roundRect(0, top, W, bot - top, 6);
    g.fill();

    // winters
    g.fillStyle = line;
    for (let y0 = 0; y0 * TICKS_PER_DAY <= span; y0 += DAYS_PER_YEAR) {
      const a = (y0 + 3 * DAYS_PER_SEASON) * TICKS_PER_DAY;
      const b = (y0 + DAYS_PER_YEAR) * TICKS_PER_DAY;
      if (a > span) break;
      g.fillRect(X(a), top, X(Math.min(b, span)) - X(a), bot - top);
    }

    // stacked population backdrop
    const rows = this.rows.filter(Boolean);
    let maxT = 1;
    for (const rw of rows) maxT = Math.max(maxT, rw.counts.reduce((a, b) => a + b, 0));
    const order = SPECIES.map((s) => s.id);
    for (let k = order.length - 1; k >= 0; k--) {
      const s = order[k];
      if (!rows.some((rw) => rw.counts[s] > 0)) continue;
      g.fillStyle = SPECIES_COLORS[s];
      g.globalAlpha = 0.55;
      g.beginPath();
      g.moveTo(X(0), bot);
      for (const rw of rows) {
        let cum = 0;
        for (let q = 0; q <= k; q++) cum += rw.counts[order[q]];
        g.lineTo(X(rw.day * TICKS_PER_DAY), bot - (cum / maxT) * (bot - top - 4));
      }
      const lastDay = rows.length ? rows[rows.length - 1].day : 0;
      g.lineTo(X(lastDay * TICKS_PER_DAY), bot);
      g.closePath();
      g.fill();
    }
    g.globalAlpha = 1;

    // unreached part of the span
    if (this.head < span) {
      g.fillStyle = chip;
      g.fillRect(X(this.head), top, W - X(this.head), bot - top);
    }

    // marks
    for (const m of this.marks) {
      const x = X(m.tick);
      g.fillStyle = m.kind === 'extinct' ? '#b8432f' : m.kind === 'ceiling' || m.kind === 'fire' || m.kind === 'ignite' ? '#e07a1f' : m.kind === 'outbreak' ? '#7cb342' : ink;
      g.beginPath();
      g.moveTo(x, bot + 1);
      g.lineTo(x - 4, bot + 7);
      g.lineTo(x + 4, bot + 7);
      g.closePath();
      g.fill();
    }

    // head + cursor
    const cur = this.dragTick >= 0 ? this.dragTick : this.tick;
    g.fillStyle = accent;
    g.fillRect(X(cur) - 1.5, 0, 3, H - 6);
    g.beginPath();
    g.arc(X(cur), top + 1, 4.5, 0, Math.PI * 2);
    g.fill();
  }
}

export function describeMark(m: { tick: number; kind: string; sp: number }): string {
  const day = Math.floor(m.tick / TICKS_PER_DAY);
  const sp = SPECIES[m.sp];
  switch (m.kind) {
    case 'extinct':
      return `Day ${day}: last ${sp?.name.toLowerCase()} lost`;
    case 'ceiling':
      return `Day ${day}: world full, births paused`;
    case 'release':
      return `Day ${day}: you released ${sp?.plural.toLowerCase()}`;
    case 'cull':
      return `Day ${day}: you culled ${m.sp >= 0 ? sp?.plural.toLowerCase() : 'animals'}`;
    case 'fire':
      return `Day ${day}: lightning fire`;
    case 'outbreak':
      return `Day ${day}: outbreak among ${sp?.plural.toLowerCase()}`;
    case 'ignite':
      return `Day ${day}: you lit a fire`;
    default:
      return `Day ${day}: you used ${m.kind}`;
  }
}
