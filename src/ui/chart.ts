// Population chart: one line per species over sim days, with season bands and hover.

import type { StatsRow } from '../sim/protocol';
import { SPECIES } from '../sim/species';
import { DAYS_PER_SEASON, DAYS_PER_YEAR } from '../sim/constants';
import { SPECIES_COLORS } from '../render/palette';

export class PopulationChart {
  rows: StatsRow[] = [];
  rowsB: StatsRow[] | null = null;
  log = true;
  focus = -1;
  cursorDay = -1;
  private hover = -1;
  private g: CanvasRenderingContext2D;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.g = canvas.getContext('2d')!;
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.hover = this.dayAt(e.clientX - r.left, r.width);
      this.draw();
    });
    canvas.addEventListener('pointerleave', () => {
      this.hover = -1;
      this.draw();
    });
  }

  private dayAt(px: number, width: number): number {
    const maxDay = Math.max(14, this.rows.length - 1);
    const pad = 34;
    return Math.round(((px - pad) / (width - pad - 6)) * maxDay);
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
    const muted = css.getPropertyValue('--faint').trim() || '#999';
    const line = css.getPropertyValue('--line').trim() || '#ddd';
    const ink = css.getPropertyValue('--ink').trim() || '#222';
    const panel = css.getPropertyValue('--panel').trim() || '#fff';
    const rows = this.rows.filter(Boolean);
    const maxDay = Math.max(14, this.rows.length - 1);
    const padL = 34;
    const padR = 6;
    const padT = 6;
    const padB = 18;
    const X = (d: number) => padL + (d / maxDay) * (W - padL - padR);
    let maxV = 10;
    for (const row of rows) for (let s = 0; s < 16; s++) if (this.focus < 0 || this.focus === s) maxV = Math.max(maxV, row.counts[s]);
    const Y = this.log
      ? (v: number) => padT + (1 - Math.log10(1 + v) / Math.log10(1 + maxV)) * (H - padT - padB)
      : (v: number) => padT + (1 - v / maxV) * (H - padT - padB);

    // winter bands
    g.fillStyle = line;
    g.globalAlpha = 0.45;
    for (let y0 = 0; y0 <= maxDay; y0 += DAYS_PER_YEAR) {
      const a = y0 + 3 * DAYS_PER_SEASON;
      const b = y0 + DAYS_PER_YEAR;
      if (a > maxDay) break;
      g.fillRect(X(a), padT, X(Math.min(b, maxDay)) - X(a), H - padT - padB);
    }
    g.globalAlpha = 1;

    // grid + labels
    g.font = '10px Inter, system-ui, sans-serif';
    g.fillStyle = muted;
    g.strokeStyle = line;
    g.lineWidth = 1;
    const ticks = this.log ? [1, 10, 100, 1000, 10000].filter((v) => v <= maxV * 1.2) : [0, maxV / 2, maxV].map(Math.round);
    for (const v of ticks) {
      const y = Y(v);
      g.beginPath();
      g.moveTo(padL, y);
      g.lineTo(W - padR, y);
      g.stroke();
      g.textAlign = 'right';
      g.fillText(v >= 1000 ? `${v / 1000}k` : String(v), padL - 5, y + 3);
    }
    g.textAlign = 'center';
    const step = maxDay > 300 ? 112 : maxDay > 100 ? 28 : 14;
    for (let d = 0; d <= maxDay; d += step) g.fillText(`d${d}`, X(d), H - 4);

    // lines
    for (let s = 0; s < 16; s++) {
      if (!rows.some((rw) => rw.counts[s] > 0)) continue;
      const dim = this.focus >= 0 && this.focus !== s;
      g.strokeStyle = SPECIES_COLORS[s];
      g.globalAlpha = dim ? 0.15 : 1;
      g.lineWidth = this.focus === s ? 2.4 : 1.6;
      g.beginPath();
      let started = false;
      for (const row of rows) {
        const x = X(row.day);
        const y = Y(row.counts[s]);
        if (!started) {
          g.moveTo(x, y);
          started = true;
        } else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
    // the untouched twin, dashed
    if (this.rowsB) {
      const rb = this.rowsB.filter(Boolean);
      g.setLineDash([4, 3]);
      for (let s = 0; s < 16; s++) {
        if (!rb.some((rw) => rw.counts[s] > 0)) continue;
        g.strokeStyle = SPECIES_COLORS[s];
        g.globalAlpha = this.focus >= 0 && this.focus !== s ? 0.12 : 0.85;
        g.lineWidth = 1.3;
        g.beginPath();
        let started = false;
        for (const row of rb) {
          if (row.day > maxDay) break;
          const x = X(row.day);
          const y = Y(row.counts[s]);
          if (!started) {
            g.moveTo(x, y);
            started = true;
          } else g.lineTo(x, y);
        }
        g.stroke();
      }
      g.setLineDash([]);
      g.globalAlpha = 1;
    }

    if (this.cursorDay >= 0 && this.cursorDay < maxDay) {
      g.strokeStyle = ink;
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(X(this.cursorDay), padT);
      g.lineTo(X(this.cursorDay), H - padB);
      g.stroke();
      g.setLineDash([]);
    }

    // hover readout
    const hd = Math.max(0, Math.min(this.rows.length - 1, this.hover));
    const row = this.hover >= 0 ? this.rows[hd] : null;
    if (row) {
      const x = X(row.day);
      g.strokeStyle = muted;
      g.beginPath();
      g.moveTo(x, padT);
      g.lineTo(x, H - padB);
      g.stroke();
      const items = SPECIES.filter((sp) => row.counts[sp.id] > 0 || rows.some((rw) => rw.counts[sp.id] > 0)).sort((a, b) => row.counts[b.id] - row.counts[a.id]);
      const lh = 13;
      const bw = 112;
      const bh = 16 + items.length * lh;
      let bx = x + 8;
      if (bx + bw > W) bx = x - bw - 8;
      g.fillStyle = panel;
      g.globalAlpha = 0.94;
      g.fillRect(bx, padT, bw, bh);
      g.globalAlpha = 1;
      g.strokeStyle = line;
      g.strokeRect(bx + 0.5, padT + 0.5, bw, bh);
      g.textAlign = 'left';
      g.fillStyle = ink;
      g.fillText(`Day ${row.day}`, bx + 6, padT + 12);
      items.forEach((sp, k) => {
        const y = padT + 12 + (k + 1) * lh;
        g.fillStyle = SPECIES_COLORS[sp.id];
        g.fillRect(bx + 6, y - 7, 7, 7);
        g.fillStyle = ink;
        g.fillText(sp.plural, bx + 17, y);
        g.textAlign = 'right';
        g.fillText(String(row.counts[sp.id]), bx + bw - 6, y);
        g.textAlign = 'left';
      });
    }
  }
}
