// Seeded terrain: fractal value noise for elevation, basins filled as water, then the
// moisture and "way to water" fields every animal uses.

import { Cell } from './constants';
import { mix32 } from './rng';
import { clamp, sin } from './detmath';

export type Preset = 'valley' | 'lakes' | 'islands' | 'plain' | 'highlands';
export const PRESETS: { id: Preset; name: string }[] = [
  { id: 'valley', name: 'River valley' },
  { id: 'lakes', name: 'Lake country' },
  { id: 'islands', name: 'Islands' },
  { id: 'plain', name: 'Open plain' },
  { id: 'highlands', name: 'Highlands' },
];

export interface Terrain {
  w: number;
  h: number;
  elev: Float32Array;
  depth: Float32Array; // water depth, 0 on land
  type: Uint8Array;
  moisture: Float32Array;
  waterDist: Uint16Array;
  waterDir: Int8Array; // dx, dy per cell toward the nearest water
  grassCap: Float32Array;
  /** Cells with berry bushes. */
  shrub: Uint8Array;
}

function lattice(ix: number, iy: number, seed: number): number {
  return mix32((Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + seed) >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

export function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const a = lattice(ix, iy, seed);
  const b = lattice(ix + 1, iy, seed);
  const c = lattice(ix, iy + 1, seed);
  const d = lattice(ix + 1, iy + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

export function fbm(x: number, y: number, seed: number, octaves = 5): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * f, y * f, (seed + Math.imul(o, 1013)) >>> 0);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

function percentile(a: Float32Array, p: number): number {
  const s = new Float32Array(a);
  s.sort();
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

export function generateTerrain(preset: Preset, seed: number, w: number, h: number): Terrain {
  const n = w * h;
  const elev = new Float32Array(n);
  const sc = 1 / 64;
  const forced = new Uint8Array(n); // cells forced to water (river channel)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const base = fbm(x * sc, y * sc, seed);
      let e = base;
      if (preset === 'valley') {
        const ry = h * 0.5 + h * 0.22 * (fbm(x / 110, 3.7, seed ^ 0x51ed) - 0.5) * 2 + 6 * sin(x / 23);
        const dist = Math.abs(y - ry) / h;
        e = 0.2 + 0.45 * base + 1.1 * dist;
        const width = 1.6 + 2.2 * fbm(x / 40, 9.1, seed ^ 0x77);
        if (Math.abs(y - ry) < width) forced[i] = 1;
      } else if (preset === 'islands') {
        const dx = (x - w / 2) / (w / 2);
        const dy = (y - h / 2) / (h / 2);
        const r = Math.sqrt(dx * dx + dy * dy);
        e = base * 0.75 + 0.55 * (1 - r) + 0.25 * fbm(x / 20, y / 20, seed ^ 0x99, 3);
      } else if (preset === 'plain') {
        e = 0.5 + 0.25 * (base - 0.5);
      } else if (preset === 'highlands') {
        const ridge = 1 - Math.abs(2 * fbm(x / 50, y / 50, seed ^ 0x3c, 4) - 1);
        e = 0.45 * base + 0.55 * ridge;
      }
      // keep the outer ring passable land except on islands
      if (preset !== 'islands') {
        const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
        if (edge < 3) e = Math.max(e, 0.6);
      }
      elev[i] = e;
    }
  }

  const waterShare = { valley: 0.05, lakes: 0.15, islands: 0.45, plain: 0.035, highlands: 0.07 }[preset];
  const rockShare = { valley: 0.97, lakes: 0.975, islands: 0.985, plain: 0.995, highlands: 0.84 }[preset];
  const level = percentile(elev, waterShare);
  const rockLevel = percentile(elev, rockShare);

  const depth = new Float32Array(n);
  const type = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (forced[i] || elev[i] < level) {
      type[i] = Cell.Water;
      depth[i] = forced[i] ? 0.5 : Math.min(1, (level - elev[i]) * 12 + 0.15);
    } else if (elev[i] > rockLevel) type[i] = Cell.Rock;
    else type[i] = Cell.Grass;
  }

  const { dist, dir } = waterField(type, w, h);
  const moisture = new Float32Array(n);
  const grassCap = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    moisture[i] = clamp(1 - dist[i] / 50, 0.3, 1);
    if (type[i] === Cell.Grass && dist[i] <= 1 && elev[i] < level + 0.035) type[i] = Cell.Sand;
    const t = type[i];
    grassCap[i] = t === Cell.Grass ? 0.35 + 0.65 * moisture[i] : t === Cell.Sand ? 0.12 : t === Cell.Marsh ? 0.8 : t === Cell.Rock ? 0.04 : 0;
  }

  const shrub = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if ((type[i] === Cell.Grass || type[i] === Cell.Sand) && fbm(x / 22, y / 22, seed ^ 0xbe11, 3) > 0.63) shrub[i] = 1;
    }
  }

  return { w, h, elev, depth, type, moisture, waterDist: dist, waterDir: dir, grassCap, shrub };
}

const NX = [1, -1, 0, 0, 1, 1, -1, -1];
const NY = [0, 0, 1, -1, 1, -1, 1, -1];

/** Multi-source BFS from water: distance in steps and the step toward water. */
/** Recompute the water-derived fields in place after the water changes (dams, drained ponds). */
export function refreshWater(t: Terrain): void {
  const { dist, dir } = waterField(t.type, t.w, t.h);
  t.waterDist.set(dist);
  t.waterDir.set(dir);
  for (let i = 0; i < t.w * t.h; i++) {
    t.moisture[i] = clamp(1 - dist[i] / 50, 0.3, 1);
    const ty = t.type[i];
    t.grassCap[i] = ty === Cell.Grass ? 0.35 + 0.65 * t.moisture[i] : ty === Cell.Sand ? 0.12 : ty === Cell.Marsh ? 0.8 : ty === Cell.Rock ? 0.04 : 0;
  }
}

export function waterField(type: Uint8Array, w: number, h: number): { dist: Uint16Array; dir: Int8Array } {
  const n = w * h;
  const dist = new Uint16Array(n).fill(65535);
  const dir = new Int8Array(n * 2);
  const queue = new Int32Array(n);
  let qh = 0;
  let qt = 0;
  for (let i = 0; i < n; i++) if (type[i] === Cell.Water) {
    dist[i] = 0;
    queue[qt++] = i;
  }
  while (qh < qt) {
    const i = queue[qh++];
    const x = i % w;
    const y = (i / w) | 0;
    for (let k = 0; k < 8; k++) {
      const nx = x + NX[k];
      const ny = y + NY[k];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (dist[j] !== 65535) continue;
      dist[j] = dist[i] + 1;
      dir[j * 2] = -NX[k];
      dir[j * 2 + 1] = -NY[k];
      queue[qt++] = j;
    }
  }
  return { dist, dir };
}
