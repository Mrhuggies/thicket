// Species detail: bloodline share over time, the learning curve per bloodline, trait drift.

import type { StatsRow } from '../sim/protocol';
import { MAX_LINEAGES, N_TRAITS, TRAIT_NAMES, TRAIT_RANGES } from '../sim/constants';
import { SPECIES } from '../sim/species';
import { hueColor } from '../render/palette';

function prep(c: HTMLCanvasElement): { g: CanvasRenderingContext2D; W: number; H: number } {
  const r = c.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  if (c.width !== Math.round(r.width * dpr) || c.height !== Math.round(r.height * dpr)) {
    c.width = Math.round(r.width * dpr);
    c.height = Math.round(r.height * dpr);
  }
  const g = c.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, r.width, r.height);
  return { g, W: r.width, H: r.height };
}

function css(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function renderDetail(host: HTMLElement, rowsIn: StatsRow[], sp: number): void {
  const rows = rowsIn.filter((r) => r && r.linMembers);
  if (sp < 0 || !rows.length) {
    host.hidden = true;
    return;
  }
  host.hidden = false;
  if (host.dataset.sp !== String(sp)) {
    host.dataset.sp = String(sp);
    host.innerHTML = `<h3>${SPECIES[sp].plural} up close <span class="aside">click the row again to close</span></h3>
      <div class="subhead" style="margin-top:0">Bloodlines: share of the population</div>
      <canvas class="mini" id="d-share"></canvas>
      <div class="subhead">Learning curve: average reward per hour, by bloodline</div>
      <canvas class="mini" id="d-learn"></canvas>
      <div class="subhead">Trait drift: species average over time</div>
      <div class="drift" id="d-drift"></div>`;
    const drift = host.querySelector('#d-drift')!;
    drift.innerHTML = TRAIT_NAMES.map((n, t) => `<span>${n}</span><canvas class="spark" data-t="${t}"></canvas><span class="v" data-v="${t}"></span>`).join('');
  }
  const base = sp * MAX_LINEAGES;
  const n = rows.length;
  const maxDay = Math.max(14, rows[n - 1].day);
  const line = css('--line', '#ddd');
  const muted = css('--faint', '#999');

  // bloodline share, stacked; each slot coloured by its hue that day
  {
    const { g, W, H } = prep(host.querySelector('#d-share') as HTMLCanvasElement);
    const X = (d: number) => (d / maxDay) * W;
    for (let k = 0; k < n; k++) {
      const r = rows[k];
      const total = r.linMembers.slice(base, base + MAX_LINEAGES).reduce((a, b) => a + b, 0);
      if (!total) continue;
      const x0 = X(r.day);
      const x1 = k + 1 < n ? X(rows[k + 1].day) : x0 + 2;
      let y = H;
      for (let l = 0; l < MAX_LINEAGES; l++) {
        const m = r.linMembers[base + l];
        if (!m) continue;
        const h = (m / total) * H;
        g.fillStyle = hueColor(r.linHue[base + l], 60, 55);
        g.fillRect(x0, y - h, Math.max(1, x1 - x0 + 0.5), h);
        y -= h;
      }
    }
  }

  // learning curve
  {
    const { g, W, H } = prep(host.querySelector('#d-learn') as HTMLCanvasElement);
    let lo = Infinity;
    let hi = -Infinity;
    for (const r of rows) for (let l = 0; l < MAX_LINEAGES; l++) if (r.linMembers[base + l] > 0) {
      lo = Math.min(lo, r.linReward[base + l]);
      hi = Math.max(hi, r.linReward[base + l]);
    }
    if (hi > lo) {
      const X = (d: number) => (d / maxDay) * W;
      const Y = (v: number) => 4 + (1 - (v - lo) / (hi - lo)) * (H - 8);
      g.strokeStyle = line;
      g.beginPath();
      g.moveTo(0, Y(0));
      g.lineTo(W, Y(0));
      g.stroke();
      for (let l = 0; l < MAX_LINEAGES; l++) {
        g.lineWidth = 1.6;
        let started = false;
        let lastHue = -1;
        g.beginPath();
        for (const r of rows) {
          if (r.linMembers[base + l] <= 0) {
            if (started) {
              g.strokeStyle = hueColor(lastHue, 60, 45);
              g.stroke();
              g.beginPath();
              started = false;
            }
            continue;
          }
          lastHue = r.linHue[base + l];
          const x = X(r.day);
          const y = Y(r.linReward[base + l]);
          if (!started) {
            g.moveTo(x, y);
            started = true;
          } else g.lineTo(x, y);
        }
        if (started) {
          g.strokeStyle = hueColor(lastHue, 60, 45);
          g.stroke();
        }
      }
      g.fillStyle = muted;
      g.font = '10px Inter, system-ui, sans-serif';
      g.fillText(hi.toFixed(2), 2, 11);
      g.fillText(lo.toFixed(2), 2, H - 3);
    }
  }

  // trait drift sparklines
  for (let t = 0; t < N_TRAITS; t++) {
    const c = host.querySelector(`canvas[data-t="${t}"]`) as HTMLCanvasElement;
    const { g, W, H } = prep(c);
    const [lo, hi] = TRAIT_RANGES[t];
    const vals = rows.map((r) => r.traits[sp * N_TRAITS + t]);
    const X = (d: number) => (d / maxDay) * W;
    const Y = (v: number) => 2 + (1 - (v - lo) / (hi - lo)) * (H - 4);
    g.strokeStyle = line;
    g.beginPath();
    g.moveTo(0, Y((lo + hi) / 2));
    g.lineTo(W, Y((lo + hi) / 2));
    g.stroke();
    g.strokeStyle = css('--accent', '#2f6f45');
    g.lineWidth = 1.5;
    g.beginPath();
    let started = false;
    rows.forEach((r, k) => {
      const v = vals[k];
      if (!Number.isFinite(v)) return;
      if (!started) {
        g.moveTo(X(r.day), Y(v));
        started = true;
      } else g.lineTo(X(r.day), Y(v));
    });
    g.stroke();
    const first = vals.find(Number.isFinite);
    const last = [...vals].reverse().find(Number.isFinite);
    const out = host.querySelector(`[data-v="${t}"]`)!;
    if (first !== undefined && last !== undefined) {
      const d = last - first;
      out.textContent = `${last.toFixed(2)} ${Math.abs(d) >= 0.005 ? (d > 0 ? '▲' : '▼') : ''}`;
    }
  }
}
