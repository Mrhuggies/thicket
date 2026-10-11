// Layered terrain: a static 4× land layer (soil, sand, rock, relief), a 1× grass layer
// repainted as grazing changes it (smoothed when scaled up), a snow layer, and a static
// 4× water layer with smooth, noisy shorelines drawn last so coasts stay crisp.

import { Terrain } from '../sim/terrain';
import { Cell } from '../sim/constants';

const S = 4; // static layer resolution per cell

function hash2(x: number, y: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smoothNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export class TerrainLayers {
  readonly land: HTMLCanvasElement;
  readonly water: HTMLCanvasElement;
  readonly snow: HTMLCanvasElement;
  readonly grass: HTMLCanvasElement;
  private grassImg: ImageData;
  private shade: Float32Array;

  constructor(readonly t: Terrain) {
    const { w, h } = t;
    this.land = canvas(w * S, h * S);
    this.water = canvas(w * S, h * S);
    this.snow = canvas(w * S, h * S);
    this.grass = canvas(w, h);
    this.grassImg = this.grass.getContext('2d')!.createImageData(w, h);
    this.shade = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const e = (xx: number, yy: number) => t.elev[Math.max(0, Math.min(h - 1, yy)) * w + Math.max(0, Math.min(w - 1, xx))];
        const sx = e(x + 1, y) - e(x - 1, y);
        const sy = e(x, y + 1) - e(x, y - 1);
        this.shade[y * w + x] = Math.max(0.7, Math.min(1.28, 1 - (sx + sy) * 9));
      }
    }
    this.paintStatic();
  }

  private sample(field: (c: number) => number, u: number, v: number): number {
    const { w, h } = this.t;
    const x0 = Math.max(0, Math.min(w - 1, Math.floor(u)));
    const y0 = Math.max(0, Math.min(h - 1, Math.floor(v)));
    const x1 = Math.min(w - 1, x0 + 1);
    const y1 = Math.min(h - 1, y0 + 1);
    const fx = Math.max(0, Math.min(1, u - x0));
    const fy = Math.max(0, Math.min(1, v - y0));
    const a = field(y0 * w + x0);
    const b = field(y0 * w + x1);
    const c = field(y1 * w + x0);
    const d = field(y1 * w + x1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }

  private wB: Float32Array | null = null;
  private rB: Float32Array | null = null;
  private sB: Float32Array | null = null;

  /** Recompute the smoothed water/rock/sand fields from the current cell types. */
  refreshFields(): void {
    const t = this.t;
    this.wB = this.blurred((c) => (t.type[c] === Cell.Water ? 1 : 0));
    this.rB = this.blurred((c) => (t.type[c] === Cell.Rock ? 1 : 0));
    this.sB = this.blurred((c) => (t.type[c] === Cell.Sand || t.type[c] === Cell.Marsh ? 1 : 0));
  }

  /** Indicator field smoothed by two 3×3 box passes, so iso-lines become curves. */
  private blurred(f: (c: number) => number): Float32Array {
    const { w, h } = this.t;
    let a = new Float32Array(w * h);
    for (let c = 0; c < w * h; c++) a[c] = f(c);
    for (let pass = 0; pass < 2; pass++) {
      const b = new Float32Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let sum = 0;
          let n = 0;
          for (let dy = -1; dy <= 1; dy++) {
            const yy = y + dy;
            if (yy < 0 || yy >= h) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx;
              if (xx < 0 || xx >= w) continue;
              sum += a[yy * w + xx];
              n++;
            }
          }
          b[y * w + x] = sum / n;
        }
      }
      a = b;
    }
    return a;
  }

  /** Repaint the static layers for a cell rectangle (inclusive), e.g. after a dam. */
  repaint(cx0: number, cy0: number, cx1: number, cy1: number): void {
    this.paintStatic(cx0 - 3, cy0 - 3, cx1 + 3, cy1 + 3);
  }

  private paintStatic(cx0 = 0, cy0 = 0, cx1 = this.t.w - 1, cy1 = this.t.h - 1): void {
    const t = this.t;
    cx0 = Math.max(0, cx0);
    cy0 = Math.max(0, cy0);
    cx1 = Math.min(t.w - 1, cx1);
    cy1 = Math.min(t.h - 1, cy1);
    const W = t.w * S;
    const H = t.h * S;
    const landG = this.land.getContext('2d')!;
    const waterG = this.water.getContext('2d')!;
    const snowG = this.snow.getContext('2d')!;
    const px0 = cx0 * S;
    const py0 = cy0 * S;
    const RW = (cx1 - cx0 + 1) * S;
    const RH = (cy1 - cy0 + 1) * S;
    const L = landG.createImageData(RW, RH);
    const Wt = waterG.createImageData(RW, RH);
    const Sn = snowG.createImageData(RW, RH);
    if (!this.wB) this.refreshFields();
    const wB = this.wB!;
    const rB = this.rB!;
    const sB = this.sB!;
    const isWater = (c: number) => wB[c];
    const isRock = (c: number) => rB[c];
    const isSand = (c: number) => sB[c];
    const depth = (c: number) => t.depth[c];
    const shade = (c: number) => this.shade[c];
    for (let py = py0; py < py0 + RH; py++) {
      const v = (py + 0.5) / S - 0.5;
      for (let px = px0; px < px0 + RW; px++) {
        const u = (px + 0.5) / S - 0.5;
        const o = ((py - py0) * RW + (px - px0)) * 4;
        const n1 = smoothNoise(px / 6, py / 6) - 0.5;
        const n2 = hash2(px, py) - 0.5;
        const wv = this.sample(isWater, u, v) + n1 * 0.32;
        const sh = this.sample(shade, u, v);
        // land
        const rock = this.sample(isRock, u, v) + n1 * 0.4;
        const sand = this.sample(isSand, u, v) + n1 * 0.3;
        let r = 128, g = 112, b = 76; // soil
        if (rock > 0.5) {
          r = 146; g = 141; b = 132;
        } else if (sand > 0.45 || (wv > 0.25 && wv <= 0.4)) {
          r = 206; g = 191; b = 146;
        }
        const k = sh * (1 + n2 * 0.1);
        L.data[o] = r * k;
        L.data[o + 1] = g * k;
        L.data[o + 2] = b * k;
        L.data[o + 3] = 255;
        Sn.data[o] = 236 + n2 * 10;
        Sn.data[o + 1] = 240 + n2 * 10;
        Sn.data[o + 2] = 246 + n2 * 8;
        Sn.data[o + 3] = wv > 0.4 ? 0 : 255 * (rock > 0.5 ? 1 : 0.92);
        // water
        if (wv > 0.4) {
          const d = Math.min(1, this.sample(depth, u, v));
          const edge = Math.max(0, 1 - (wv - 0.4) / 0.14); // shallows near the bank
          let wr = 88 - 52 * d;
          let wg = 150 - 64 * d;
          let wb = 170 - 52 * d;
          wr += edge * 40;
          wg += edge * 36;
          wb += edge * 22;
          const ripple = (smoothNoise(px / 3, py / 9) - 0.5) * 10;
          Wt.data[o] = wr + ripple;
          Wt.data[o + 1] = wg + ripple;
          Wt.data[o + 2] = wb + ripple;
          Wt.data[o + 3] = 255;
        } else Wt.data[o + 3] = 0;
      }
    }
    void W;
    void H;
    landG.putImageData(L, px0, py0);
    waterG.putImageData(Wt, px0, py0);
    snowG.putImageData(Sn, px0, py0);
  }

  /** Repaint the grass layer from 0–255 densities. autumn 0..1 bronzes it; scars char it; walls are stone. */
  paintGrass(grass: Uint8Array | null, autumn: number, scar?: Uint8Array | null, wall?: Uint8Array | null): void {
    const t = this.t;
    const d = this.grassImg.data;
    for (let c = 0; c < t.w * t.h; c++) {
      const o = c * 4;
      const ty = t.type[c];
      if (wall && wall[c]) {
        const n = ((c * 2654435761) >>> 24) / 255;
        d[o] = 118 + n * 18;
        d[o + 1] = 112 + n * 16;
        d[o + 2] = 104 + n * 14;
        d[o + 3] = 255;
        continue;
      }
      if (ty === Cell.Water || ty === Cell.Rock) {
        d[o + 3] = 0;
        continue;
      }
      const v = grass ? grass[c] / 255 : t.grassCap[c] * 0.85;
      const k = Math.max(0, Math.min(1, v / 0.8));
      const sh = this.shade[c];
      // dry straw → green → deep green
      let r: number, g: number, b: number;
      if (k < 0.5) {
        const q = k / 0.5;
        r = 172 + (104 - 172) * q; g = 160 + (146 - 160) * q; b = 92 + (66 - 92) * q;
      } else {
        const q = (k - 0.5) / 0.5;
        r = 104 + (62 - 104) * q; g = 146 + (110 - 146) * q; b = 66 + (45 - 66) * q;
      }
      r += autumn * 34 * k; g -= autumn * 6 * k; b -= autumn * 12 * k;
      if (ty === Cell.Marsh) {
        r = r * 0.7 + 30; g = g * 0.8 + 30; b = b * 0.7 + 40;
      }
      const sc = scar ? scar[c] / 255 : 0;
      if (sc > 0) {
        // fresh burns are black; the flush that follows is vivid green
        const blackness = Math.max(0, sc - 0.6) / 0.4;
        r = r * (1 - 0.8 * blackness) + 20 * blackness;
        g = g * (1 - 0.75 * blackness) + 18 * blackness;
        b = b * (1 - 0.8 * blackness) + 16 * blackness;
      }
      d[o] = r * sh;
      d[o + 1] = g * sh;
      d[o + 2] = b * sh;
      d[o + 3] = sc > 0.6 ? 235 : ty === Cell.Sand ? 90 * k : 70 + 185 * Math.min(1, k * 1.6);
    }
    this.grass.getContext('2d')!.putImageData(this.grassImg, 0, 0);
  }

  draw(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, snow: number): void {
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(this.land, x, y, w, h);
    g.drawImage(this.grass, x, y, w, h);
    if (snow > 0.01) {
      g.globalAlpha = snow;
      g.drawImage(this.snow, x, y, w, h);
      g.globalAlpha = 1;
    }
    g.drawImage(this.water, x, y, w, h);
  }
}
