// Canvas 2D renderer: painted terrain (cached, repainted when grass changes), warrens,
// carcasses, interpolated animals, day/night light, overlays and selection.

import { Terrain } from '../sim/terrain';
import { Cell, DAYS_PER_YEAR, TICKS_PER_DAY } from '../sim/constants';
import { Act, SPECIES, Sp } from '../sim/species';
import { Bit, F_STRIDE, U_STRIDE } from '../sim/protocol';
import { buildSprites, SPRITE_PX, SpriteSet, TOP_DOWN } from './sprites';
import { hueColor } from './palette';
import { TerrainLayers } from './terrain-layers';

interface Snap {
  n: number;
  f: Float32Array;
  u: Uint32Array;
  time: number;
  tick: number;
}

const MOVING = new Set<number>([Act.Forage, Act.Drink, Act.Flee, Act.Hunt, Act.Explore, Act.Mate, Act.Scavenge, Act.Shelter]);

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function hash2(x: number, y: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function seasonWarmth(tick: number): number {
  const doy = Math.floor(tick / TICKS_PER_DAY) % DAYS_PER_YEAR;
  return Math.sin((2 * Math.PI * (doy - 14)) / DAYS_PER_YEAR);
}

/** 0 → 1 as leaves turn in autumn (by calendar, not temperature). */
export function autumnAmount(tick: number): number {
  const doy = Math.floor(tick / TICKS_PER_DAY) % DAYS_PER_YEAR;
  return doy < 56 ? 0 : doy < 70 ? (doy - 56) / 14 : doy < 98 ? 1 : 0;
}

/** Deciduous trees stand bare from late autumn until early spring. */
export function leafless(tick: number): boolean {
  const doy = Math.floor(tick / TICKS_PER_DAY) % DAYS_PER_YEAR;
  return doy >= 90 || doy < 6;
}

export function daylight(tick: number): number {
  const warmth = seasonWarmth(tick);
  const dayLen = 12 + 4 * warmth;
  const h = tick % TICKS_PER_DAY;
  const dawn = 12 - dayLen / 2;
  const dusk = 12 + dayLen / 2;
  return smoothstep(dawn - 1.2, dawn + 1.2, h) * (1 - smoothstep(dusk - 1.2, dusk + 1.2, h));
}

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private dpr = 1;
  terrain: Terrain | null = null;
  private layers: TerrainLayers | null = null;
  private fearTex: HTMLCanvasElement = document.createElement('canvas');
  grass: Uint8Array | null = null;
  fear: Uint8Array | null = null;
  private prev: Snap | null = null;
  private cur: Snap | null = null;
  private prevIndex = new Map<number, number>();
  private sprites: SpriteSet;
  carcasses = new Float32Array(0);
  warrens = new Float32Array(0);
  private _trees = new Float32Array(0);
  get trees(): Float32Array {
    return this._trees;
  }
  set trees(v: Float32Array) {
    this._trees = v;
    this.treeDirty = true;
  }
  private treeDirty = true;
  private treeKey = '';
  private treeLastPaint = 0;
  private treeCanvas: HTMLCanvasElement = document.createElement('canvas');
  selectedId = 0;
  follow = false;
  showFear = false;
  showLineage = false;
  lineageHue = new Map<number, number>();
  hoverCell: { x: number; y: number; r: number } | null = null;
  cam = { x: 0, y: 0, scale: 2 };
  private fitted = false;
  private lastTexWarmth = 99;
  private paintedGrass: Uint8Array | null = null;
  /** Visual exaggeration so small animals read at map scale. */
  boost = 2.1;

  constructor(canvas: HTMLCanvasElement, colors: string[]) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d')!;
    this.sprites = buildSprites(colors);
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
    if (!this.fitted || this.atFit) this.fit();
    this.clampCam();
  }

  /** True until the user zooms or pans, so resizes keep the whole map in view. */
  atFit = true;
  /** Animal the camera follows without selecting it (director mode). */
  followId = 0;

  get viewW(): number {
    return this.canvas.width / this.dpr;
  }
  get viewH(): number {
    return this.canvas.height / this.dpr;
  }

  fit(): void {
    if (!this.terrain) return;
    const { w, h } = this.terrain;
    this.cam.scale = Math.min(this.viewW / w, this.viewH / h);
    this.cam.x = w / 2;
    this.cam.y = h / 2;
    this.fitted = this.viewW > 10;
    this.atFit = true;
  }

  minScale(): number {
    if (!this.terrain) return 1;
    return Math.min(this.viewW / this.terrain.w, this.viewH / this.terrain.h) * 0.9;
  }

  clampCam(): void {
    if (!this.terrain) return;
    const { w, h } = this.terrain;
    this.cam.scale = Math.max(this.minScale(), Math.min(40, this.cam.scale));
    const hw = this.viewW / this.cam.scale / 2;
    const hh = this.viewH / this.cam.scale / 2;
    this.cam.x = hw * 2 >= w ? w / 2 : Math.max(hw, Math.min(w - hw, this.cam.x));
    this.cam.y = hh * 2 >= h ? h / 2 : Math.max(hh, Math.min(h - hh, this.cam.y));
  }

  toScreen(x: number, y: number): [number, number] {
    return [(x - this.cam.x) * this.cam.scale + this.viewW / 2, (y - this.cam.y) * this.cam.scale + this.viewH / 2];
  }

  toWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.viewW / 2) / this.cam.scale + this.cam.x, (sy - this.viewH / 2) / this.cam.scale + this.cam.y];
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    this.atFit = false;
    const [wx, wy] = this.toWorld(sx, sy);
    this.cam.scale *= factor;
    this.clampCam();
    const [nx, ny] = this.toWorld(sx, sy);
    this.cam.x += wx - nx;
    this.cam.y += wy - ny;
    this.clampCam();
  }

  setTerrain(t: Terrain): void {
    this.terrain = t;
    this.fitted = false;
    this.paintedGrass = null;
    this.layers = new TerrainLayers(t);
    this.fearTex.width = t.w;
    this.fearTex.height = t.h;
    this.resize();
    this.fit();
  }

  scar: Uint8Array | null = null;
  wall: Uint8Array | null = null;
  toxin: Uint8Array | null = null;
  fire = new Int32Array(0);
  weather = 0;
  wind: [number, number, number] = [1, 0, 0.3];
  private toxTex: HTMLCanvasElement = document.createElement('canvas');

  dams = new Float32Array(0);

  /** Water changed (dams, drained ponds): repaint the static terrain layers, keep the camera. */
  updateTerrain(type: Uint8Array, depth: Float32Array): void {
    const t = this.terrain;
    if (!t) return;
    let x0 = t.w;
    let y0 = t.h;
    let x1 = -1;
    let y1 = -1;
    for (let c = 0; c < t.w * t.h; c++) {
      if (t.type[c] === type[c] && t.depth[c] === depth[c]) continue;
      const x = c % t.w;
      const y = (c / t.w) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    if (x1 < 0) return;
    t.type.set(type);
    t.depth.set(depth);
    this.layers = this.layers ?? new TerrainLayers(t);
    this.layers.refreshFields();
    this.layers.repaint(x0, y0, x1, y1);
    this.paintedGrass = null;
  }

  setGrass(g: Uint8Array, fear?: Uint8Array, scar?: Uint8Array, wall?: Uint8Array, toxin?: Uint8Array | null): void {
    this.grass = g;
    if (fear) this.fear = fear;
    if (scar) this.scar = scar;
    if (wall) this.wall = wall;
    if (toxin !== undefined) {
      this.toxin = toxin;
      this.paintToxin();
    }
  }

  private paintToxin(): void {
    const t = this.terrain;
    if (!t) return;
    if (this.toxTex.width !== t.w) {
      this.toxTex.width = t.w;
      this.toxTex.height = t.h;
    }
    const g = this.toxTex.getContext('2d')!;
    const img = g.createImageData(t.w, t.h);
    if (this.toxin) {
      for (let c = 0; c < t.w * t.h; c++) {
        const v = this.toxin[c];
        if (!v) continue;
        img.data[c * 4] = 150;
        img.data[c * 4 + 1] = 40;
        img.data[c * 4 + 2] = 190;
        img.data[c * 4 + 3] = Math.min(190, v);
      }
    }
    g.putImageData(img, 0, 0);
  }

  pushFrame(n: number, f: Float32Array, u: Uint32Array, tick: number): void {
    this.prev = this.cur;
    this.cur = { n, f, u, time: performance.now(), tick };
    this.prevIndex.clear();
    if (this.prev) for (let k = 0; k < this.prev.n; k++) this.prevIndex.set(this.prev.u[k * U_STRIDE], k);
  }

  /** Show a still keyframe (scrub preview) without interpolation. */
  showStill(n: number, f: Float32Array, u: Uint32Array, tick: number): void {
    this.prev = null;
    this.cur = { n, f, u, time: performance.now() - 1000, tick };
    this.prevIndex.clear();
  }

  get tick(): number {
    return this.cur?.tick ?? 0;
  }

  private paintTerrain(): void {
    const warmth = seasonWarmth(this.tick);
    const autumn = autumnAmount(this.tick) * 0.8;
    this.layers!.paintGrass(this.grass, autumn, this.scar, this.wall);
    this.paintedGrass = this.grass;
    this.lastTexWarmth = warmth;
  }

  private paintFear(): void {
    const t = this.terrain!;
    const g = this.fearTex.getContext('2d')!;
    const img = g.createImageData(t.w, t.h);
    const f = this.fear;
    if (f) {
      for (let c = 0; c < t.w * t.h; c++) {
        const v = f[c];
        img.data[c * 4] = 220;
        img.data[c * 4 + 1] = 40;
        img.data[c * 4 + 2] = 60;
        img.data[c * 4 + 3] = Math.min(200, v * 1.1);
      }
    }
    g.putImageData(img, 0, 0);
  }

  draw(): void {
    if (!this.terrain) return;
    const g = this.g;
    const now = performance.now();
    if (this.paintedGrass !== this.grass || Math.abs(seasonWarmth(this.tick) - this.lastTexWarmth) > 0.05) this.paintTerrain();
    void autumnAmount;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = '#1d2a30';
    g.fillRect(0, 0, this.viewW, this.viewH);

    // follow the selected animal (or the director's subject)
    const fid = this.followId || this.selectedId;
    if (this.follow && fid && this.cur) {
      const p = this.positionOf(fid, now);
      if (p) {
        this.cam.x += (p[0] - this.cam.x) * 0.15;
        this.cam.y += (p[1] - this.cam.y) * 0.15;
        this.clampCam();
      }
    }

    const s = this.cam.scale;
    const [ox, oy] = this.toScreen(0, 0);
    const warmth = seasonWarmth(this.tick);
    const snow = Math.max(0, Math.min(1, (-warmth - 0.55) / 0.35)) * 0.85;
    this.layers!.draw(g, ox, oy, this.terrain.w * s, this.terrain.h * s, snow);

    if (this.showFear) {
      this.paintFear();
      g.globalAlpha = 0.85;
      g.drawImage(this.fearTex, ox, oy, this.terrain.w * s, this.terrain.h * s);
      g.globalAlpha = 1;
    }

    // warrens: low earth mounds with a dark mouth
    const wr = this.warrens;
    for (let k = 0; k < wr.length; k += 3) {
      const [sx, sy] = this.toScreen(wr[k], wr[k + 1]);
      const rr = Math.max(1.6, s * (wr[k + 2] === Sp.Mouse ? 0.45 : 0.75));
      g.fillStyle = 'rgba(120, 96, 62, 0.55)';
      g.beginPath();
      g.ellipse(sx, sy, rr * 1.5, rr * 0.95, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(38, 28, 18, 0.75)';
      g.beginPath();
      g.ellipse(sx + rr * 0.15, sy + rr * 0.1, rr * 0.45, rr * 0.3, 0, 0, Math.PI * 2);
      g.fill();
    }

    // carcasses
    const cs = this.carcasses;
    for (let k = 0; k < cs.length; k += 4) {
      const [sx, sy] = this.toScreen(cs[k], cs[k + 1]);
      const m = cs[k + 2];
      const rr = Math.max(1.5, Math.min(s * 1.6, s * 0.35 * Math.cbrt(m * 8)));
      g.fillStyle = `rgba(110, 32, 28, ${Math.min(0.85, 0.35 + m * 0.2)})`;
      g.beginPath();
      g.ellipse(sx, sy, rr * 1.3, rr * 0.8, 0.4, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(240, 232, 220, 0.8)';
      g.lineWidth = Math.max(0.8, rr * 0.25);
      g.beginPath();
      g.moveTo(sx - rr * 0.7, sy - rr * 0.2);
      g.lineTo(sx + rr * 0.7, sy + rr * 0.2);
      g.stroke();
    }

    if (this.toxin) {
      g.imageSmoothingEnabled = true;
      g.drawImage(this.toxTex, ox, oy, this.terrain.w * s, this.terrain.h * s);
    }

    this.drawTrees();
    this.drawDams();
    this.drawFire(now);

    // night falls over the land first
    const light = daylight(this.tick + this.alpha(now));
    const dark = (1 - light) * 0.5;
    if (dark > 0.01) {
      g.fillStyle = `rgba(12, 20, 46, ${dark})`;
      g.fillRect(0, 0, this.viewW, this.viewH);
    }

    this.drawAnimals(now);

    if (dark > 0.01) {
      g.fillStyle = `rgba(12, 20, 46, ${dark * 0.35})`;
      g.fillRect(0, 0, this.viewW, this.viewH);
    }

    this.drawWeather(now);

    if (this.wallDraft) {
      const [ax, ay] = this.toScreen(this.wallDraft[0], this.wallDraft[1]);
      const [bx, by] = this.toScreen(this.wallDraft[2], this.wallDraft[3]);
      g.strokeStyle = 'rgba(240, 236, 228, 0.9)';
      g.lineWidth = Math.max(3, s * 1.5);
      g.lineCap = 'round';
      g.setLineDash([6, 5]);
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(bx, by);
      g.stroke();
      g.setLineDash([]);
    }

    if (this.hoverCell) {
      const [sx, sy] = this.toScreen(this.hoverCell.x, this.hoverCell.y);
      g.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      g.setLineDash([5, 4]);
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(sx, sy, this.hoverCell.r * s, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
    }
  }

  wallDraft: [number, number, number, number] | null = null;

  private drawDams(): void {
    const d = this.dams;
    const g = this.g;
    const s = this.cam.scale;
    for (let k = 0; k < d.length; k += 3) {
      const [sx, sy] = this.toScreen(d[k], d[k + 1]);
      const r = Math.max(3, s * 1.3);
      g.strokeStyle = `rgba(92, 64, 38, ${0.5 + 0.5 * d[k + 2]})`;
      g.lineCap = 'round';
      g.lineWidth = Math.max(1.5, s * 0.45);
      for (let q = -1; q <= 1; q++) {
        g.beginPath();
        g.moveTo(sx - r, sy + q * r * 0.35 - r * 0.2);
        g.lineTo(sx + r, sy + q * r * 0.35 + r * 0.2);
        g.stroke();
      }
    }
  }

  private drawFire(now: number): void {
    const f = this.fire;
    if (!f.length || !this.terrain) return;
    const g = this.g;
    const s = this.cam.scale;
    const w = this.terrain.w;
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let k = 0; k < f.length; k++) {
      const c = f[k];
      const [sx, sy] = this.toScreen((c % w) + 0.5, Math.floor(c / w) + 0.5);
      const flick = 0.75 + 0.25 * Math.sin(now / 90 + c * 1.7);
      const r = s * 1.6 * flick;
      const grad = g.createRadialGradient(sx, sy, 0, sx, sy, r);
      grad.addColorStop(0, 'rgba(255, 230, 140, 0.95)');
      grad.addColorStop(0.4, 'rgba(255, 120, 30, 0.75)');
      grad.addColorStop(1, 'rgba(200, 40, 10, 0)');
      g.fillStyle = grad;
      g.fillRect(sx - r, sy - r, r * 2, r * 2);
    }
    g.restore();
    // drifting smoke
    g.fillStyle = 'rgba(70, 66, 62, 0.08)';
    for (let k = 0; k < f.length; k += 3) {
      const c = f[k];
      const t = (now / 1400 + (c % 97) / 97) % 1;
      const [sx, sy] = this.toScreen((c % w) + 0.5 + this.wind[0] * t * 6, Math.floor(c / w) + 0.5 + this.wind[1] * t * 6 - t * 3);
      g.beginPath();
      g.arc(sx, sy, s * (1 + t * 3), 0, Math.PI * 2);
      g.fill();
    }
  }

  private drawWeather(now: number): void {
    const g = this.g;
    const W = this.viewW;
    const H = this.viewH;
    const wx = this.wind[0];
    if (this.weather === 1 || this.weather === 2) {
      const storm = this.weather === 2;
      if (storm) {
        g.fillStyle = 'rgba(20, 26, 36, 0.18)';
        g.fillRect(0, 0, W, H);
      }
      g.strokeStyle = storm ? 'rgba(210, 220, 235, 0.38)' : 'rgba(210, 220, 235, 0.28)';
      g.lineWidth = 1;
      g.beginPath();
      const n = storm ? 260 : 150;
      const slant = wx * (storm ? 14 : 6);
      for (let k = 0; k < n; k++) {
        const x = ((k * 97.13 + now * (0.35 + (k % 5) * 0.03)) % (W + 40)) - 20;
        const y = ((k * 53.7 + now * (0.9 + (k % 7) * 0.05)) % (H + 40)) - 20;
        g.moveTo(x, y);
        g.lineTo(x + slant, y + 14);
      }
      g.stroke();
    } else if (this.weather === 3) {
      g.fillStyle = 'rgba(255, 170, 60, 0.07)';
      g.fillRect(0, 0, W, H);
    } else if (this.weather === 4) {
      g.fillStyle = 'rgba(150, 190, 255, 0.08)';
      g.fillRect(0, 0, W, H);
    }
  }

  /** Trees are painted into a cached layer (5 px per cell) and redrawn only when they change. */
  private drawTrees(): void {
    if (!this.terrain) return;
    const autumn = autumnAmount(this.tick);
    const bare = leafless(this.tick);
    const key = `${Math.round(autumn * 8)}|${bare}`;
    const now = performance.now();
    if ((this.treeDirty || key !== this.treeKey) && now - this.treeLastPaint > 400) {
      this.paintTreeLayer(autumn, bare);
      this.treeDirty = false;
      this.treeKey = key;
      this.treeLastPaint = now;
    }
    const [ox, oy] = this.toScreen(0, 0);
    this.g.drawImage(this.treeCanvas, ox, oy, this.terrain.w * this.cam.scale, this.terrain.h * this.cam.scale);
  }

  private paintTreeLayer(autumn: number, bare: boolean): void {
    const S = 5;
    const t = this.terrain!;
    const c = this.treeCanvas;
    if (c.width !== t.w * S) {
      c.width = t.w * S;
      c.height = t.h * S;
    }
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    const tr = this._trees;
    g.fillStyle = 'rgba(20, 28, 14, 0.22)';
    for (let k = 0; k < tr.length; k += 4) {
      if (tr[k + 3] !== 2 || (bare && tr[k + 2] === 0)) continue;
      const r = S * (tr[k + 2] === 0 ? 1.45 : 1.25);
      g.beginPath();
      g.ellipse(tr[k] * S + r * 0.35, tr[k + 1] * S + r * 0.45, r, r * 0.8, 0, 0, Math.PI * 2);
      g.fill();
    }
    const oakBase = autumn > 0.1 ? `rgb(${66 + 110 * autumn}, ${104 - 10 * autumn}, ${46 - 10 * autumn})` : '#42692f';
    const oakHi = autumn > 0.1 ? `rgb(${92 + 120 * autumn}, ${134 - 10 * autumn}, ${60 - 20 * autumn})` : '#5d8c44';
    for (let k = 0; k < tr.length; k += 4) {
      const sx = tr[k] * S;
      const sy = tr[k + 1] * S;
      const oak = tr[k + 2] === 0;
      const stage = tr[k + 3];
      if (stage === 1) {
        g.fillStyle = bare && oak ? 'rgba(120, 96, 70, 0.8)' : oak ? '#5f8f43' : '#86ad5c';
        g.beginPath();
        g.arc(sx, sy, S * 0.45, 0, Math.PI * 2);
        g.fill();
        continue;
      }
      if (stage === 3) {
        g.strokeStyle = 'rgba(96, 86, 76, 0.9)';
        g.lineWidth = S * 0.25;
        g.beginPath();
        g.moveTo(sx - S * 0.6, sy + S * 0.5);
        g.lineTo(sx + S * 0.1, sy - S * 0.2);
        g.lineTo(sx + S * 0.6, sy - S * 0.7);
        g.moveTo(sx + S * 0.1, sy - S * 0.2);
        g.lineTo(sx - S * 0.3, sy - S * 0.8);
        g.stroke();
        continue;
      }
      const r = S * (oak ? 1.45 : 1.25);
      if (oak && bare) {
        g.fillStyle = 'rgba(110, 92, 72, 0.45)';
        g.strokeStyle = 'rgba(80, 64, 50, 0.75)';
        g.lineWidth = S * 0.12;
        g.beginPath();
        g.arc(sx, sy, r * 0.85, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        continue;
      }
      g.fillStyle = oak ? oakBase : '#6f9a4c';
      g.beginPath();
      if (oak) g.arc(sx, sy, r, 0, Math.PI * 2);
      else g.ellipse(sx, sy, r * 0.85, r, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(24, 36, 18, 0.55)';
      g.lineWidth = S * 0.08;
      g.stroke();
      g.fillStyle = oak ? oakHi : '#93ba69';
      g.beginPath();
      g.arc(sx - r * 0.28, sy - r * 0.3, r * 0.5, 0, Math.PI * 2);
      g.fill();
    }
  }

  private alpha(now: number): number {
    if (!this.cur || !this.prev) return 1;
    const dt = Math.max(16, this.cur.time - this.prev.time);
    return Math.max(0, Math.min(1, (now - this.cur.time) / dt));
  }

  positionOf(id: number, now: number): [number, number] | null {
    const c = this.cur;
    if (!c) return null;
    for (let k = 0; k < c.n; k++) {
      if (c.u[k * U_STRIDE] !== id) continue;
      let x = c.f[k * F_STRIDE];
      let y = c.f[k * F_STRIDE + 1];
      const pk = this.prevIndex.get(id);
      if (pk !== undefined && this.prev) {
        const a = this.alpha(now);
        x = this.prev.f[pk * F_STRIDE] + (x - this.prev.f[pk * F_STRIDE]) * a;
        y = this.prev.f[pk * F_STRIDE + 1] + (y - this.prev.f[pk * F_STRIDE + 1]) * a;
      }
      return [x, y];
    }
    return null;
  }

  private spriteCache = new Map<number, HTMLCanvasElement>();
  private spriteCacheScale = 0;

  /** A sprite pre-scaled to `px` device pixels, optionally mirrored. Cached per zoom. */
  private sprite(sp: number, frame: number, flip: boolean, px: number): HTMLCanvasElement {
    const key = ((sp * 2 + frame) * 2 + (flip ? 1 : 0)) * 512 + Math.min(511, px);
    let c = this.spriteCache.get(key);
    if (!c) {
      c = document.createElement('canvas');
      c.width = c.height = Math.max(1, px);
      const g = c.getContext('2d')!;
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      if (flip) {
        g.translate(px, 0);
        g.scale(-1, 1);
      }
      g.drawImage(this.sprites.frames[sp][frame], 0, 0, px, px);
      this.spriteCache.set(key, c);
    }
    return c;
  }

  private order: Int32Array = new Int32Array(0);
  private sortKeys = new Float64Array(0);
  private ordBuf = new Int32Array(0);
  private sx = new Float32Array(0);
  private sy = new Float32Array(0);

  private drawAnimals(now: number): void {
    const c = this.cur;
    if (!c) return;
    const g = this.g;
    const a = this.alpha(now);
    const s = this.cam.scale;
    const n = c.n;
    if (this.sx.length < n) {
      this.sx = new Float32Array(n * 2);
      this.sy = new Float32Array(n * 2);
      this.order = new Int32Array(n * 2);
    }
    const vw = this.viewW;
    const vh = this.viewH;
    let m = 0;
    for (let k = 0; k < n; k++) {
      let x = c.f[k * F_STRIDE];
      let y = c.f[k * F_STRIDE + 1];
      const pk = this.prev ? this.prevIndex.get(c.u[k * U_STRIDE]) : undefined;
      if (pk !== undefined && this.prev) {
        const px = this.prev.f[pk * F_STRIDE];
        const py = this.prev.f[pk * F_STRIDE + 1];
        if (Math.abs(px - x) < 12 && Math.abs(py - y) < 12) {
          x = px + (x - px) * a;
          y = py + (y - py) * a;
        }
      }
      const [qx, qy] = this.toScreen(x, y);
      if (qx < -40 || qy < -40 || qx > vw + 40 || qy > vh + 40) continue;
      this.sx[k] = qx;
      this.sy[k] = qy;
      this.order[m++] = k;
    }
    // ground animals by depth, birds on top: one native sort over packed numeric keys
    if (this.sortKeys.length < m) this.sortKeys = new Float64Array(m * 2);
    const keys = this.sortKeys.subarray(0, m);
    for (let q = 0; q < m; q++) {
      const k = this.order[q];
      const bird = TOP_DOWN.has(c.u[k * U_STRIDE + 1] & 31) ? 1 : 0;
      const depth = Math.max(0, Math.min(65535, Math.round(this.sy[k] + 4000)));
      keys[q] = ((bird * 65536 + depth) * 65536 + k);
    }
    keys.sort();
    const ord = this.ordBuf.length >= m ? this.ordBuf : (this.ordBuf = new Int32Array(m * 2));
    for (let q = 0; q < m; q++) ord[q] = keys[q] % 65536;
    const tAnim = now / 140;
    if (Math.abs(this.spriteCacheScale - s) > 1e-6) {
      this.spriteCache.clear();
      this.spriteCacheScale = s;
    }
    const d = this.dpr;
    for (let q = 0; q < m; q++) {
      const k = ord[q];
      const bits = c.u[k * U_STRIDE + 1];
      if (bits & Bit.Shel) continue;
      const spc = bits & 31;
      const act = (bits >> 5) & 15;
      const id = c.u[k * U_STRIDE];
      const def = SPECIES[spc];
      let size = Math.max(7, def.size * s * this.boost);
      if (bits & Bit.Juvenile) size *= 0.68;
      const qx = this.sx[k];
      const qy = this.sy[k];
      const moving = MOVING.has(act);
      const frame = moving || TOP_DOWN.has(spc) ? ((tAnim + (id % 7)) | 0) & 1 : 0;
      const img = this.sprites.frames[spc][frame];
      const hx = c.f[k * F_STRIDE + 2];
      const hy = c.f[k * F_STRIDE + 3];
      if (this.showLineage) {
        const hue = this.lineageHue.get(spc * 8 + ((bits >> 12) & 7)) ?? 0;
        g.fillStyle = hueColor(hue, 75, 55);
        g.globalAlpha = 0.75;
        g.beginPath();
        g.ellipse(qx, qy + size * 0.18, size * 0.5, size * 0.22, 0, 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = 1;
      }
      if (TOP_DOWN.has(spc)) {
        void d;
        const lift = size * 0.45;
        g.fillStyle = 'rgba(10, 14, 10, 0.22)';
        g.beginPath();
        g.ellipse(qx + lift * 0.4, qy + lift, size * 0.35, size * 0.16, 0, 0, Math.PI * 2);
        g.fill();
        g.save();
        g.translate(qx, qy);
        g.rotate(Math.atan2(hy, hx) + Math.PI / 2);
        g.drawImage(img, -size / 2, -size / 2, size, size);
        g.restore();
      } else {
        const bob = moving ? Math.sin(tAnim * 2 + id) * size * 0.03 : 0;
        const px = Math.round(size * d);
        const spr = this.sprite(spc, frame, hx < 0, px);
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.drawImage(spr, Math.round(qx * d - px / 2), Math.round((qy - size * 0.25 + bob) * d - px / 2));
        g.setTransform(d, 0, 0, d, 0, 0);
      }
      if (bits & Bit.Sick) {
        g.fillStyle = '#9bd14b';
        g.beginPath();
        g.arc(qx + size * 0.3, qy - size * 0.55, Math.max(1.5, size * 0.09), 0, Math.PI * 2);
        g.fill();
      }
      if (id === this.selectedId) {
        g.strokeStyle = '#fff';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(qx, qy - size * 0.2, size * 0.75, 0, Math.PI * 2);
        g.stroke();
        g.strokeStyle = 'rgba(0,0,0,0.5)';
        g.lineWidth = 1;
        g.beginPath();
        g.arc(qx, qy - size * 0.2, size * 0.75 + 2, 0, Math.PI * 2);
        g.stroke();
      }
    }
    void SPRITE_PX;
  }

  /** Nearest visible animal to a screen point, within 16 px. */
  pick(px: number, py: number): number {
    const c = this.cur;
    if (!c) return 0;
    let best = 0;
    let bd = 16 * 16;
    const now = performance.now();
    for (let k = 0; k < c.n; k++) {
      if (c.u[k * U_STRIDE + 1] & Bit.Shel) continue;
      const id = c.u[k * U_STRIDE];
      const p = this.positionOf(id, now) ?? [c.f[k * F_STRIDE], c.f[k * F_STRIDE + 1]];
      const [qx, qy] = this.toScreen(p[0], p[1]);
      const d = (qx - px) ** 2 + (qy - py - 4) ** 2;
      if (d < bd) {
        bd = d;
        best = id;
      }
    }
    return best;
  }
}
