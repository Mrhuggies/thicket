// Plants and slow fields: trees (oak, willow) through their life stages, acorns and buried
// caches, insects, berries and algae. All deterministic, driven by the world's env stream.

import { Cell, MAX_TREES, Stage, Tree } from './constants';
import { fbm } from './terrain';
import type { World } from './world';

const NX = [1, -1, 0, 0, 1, 1, -1, -1];
const NY = [0, 0, 1, -1, 1, -1, 1, -1];

export function addTree(w: World, cell: number, kind: number, stage: number, age: number): number {
  if (w.treeAt[cell] >= 0) return -1;
  // lowest free slot: independent of removal order, so restored runs stay identical
  let k = -1;
  for (let q = w.trHint; q < w.trCount; q++) if (!w.trAlive[q]) {
    k = q;
    break;
  }
  if (k < 0) {
    if (w.trCount >= MAX_TREES) return -1;
    k = w.trCount++;
  }
  w.trHint = k + 1;
  w.trX[k] = (cell % w.w) + 0.5;
  w.trY[k] = Math.floor(cell / w.w) + 0.5;
  w.trKind[k] = kind;
  w.trStage[k] = stage;
  w.trAge[k] = age;
  const base = kind === Tree.Oak ? 520 : 320;
  w.trLife[k] = base + w.rEnv.int(kind === Tree.Oak ? 420 : 200);
  w.trAlive[k] = 1;
  w.treeAt[cell] = k;
  w.treeVersion++;
  return k;
}

export function removeTree(w: World, k: number): void {
  if (!w.trAlive[k]) return;
  w.trAlive[k] = 0;
  const cell = Math.floor(w.trY[k]) * w.w + Math.floor(w.trX[k]);
  if (w.treeAt[cell] === k) w.treeAt[cell] = -1;
  if (k < w.trHint) w.trHint = k;
  w.treeVersion++;
}

/** Rebuild derived tree indexes (after a restore). */
export function reindexTrees(w: World): void {
  w.treeAt.fill(-1);
  w.trHint = w.trCount;
  for (let k = 0; k < w.trCount; k++) {
    if (w.trAlive[k]) w.treeAt[Math.floor(w.trY[k]) * w.w + Math.floor(w.trX[k])] = k;
    else if (k < w.trHint) w.trHint = k;
  }
  rebuildCanopy(w);
  w.treeVersion++;
}

export function plantInitialTrees(w: World): void {
  const t = w.t;
  for (let y = 0; y < w.h; y++) {
    for (let x = 0; x < w.w; x++) {
      const c = y * w.w + x;
      const ty = t.type[c];
      if (ty !== Cell.Grass && ty !== Cell.Sand) continue;
      const wd = t.waterDist[c];
      const forest = fbm(x / 45, y / 45, w.cfg.seed ^ 0x7ee5, 4);
      if (wd >= 1 && wd <= 3 && w.rEnv.chance(0.12)) {
        const age = w.rEnv.int(380);
        addTree(w, c, Tree.Willow, age >= 112 ? Stage.Mature : Stage.Sapling, age);
      } else if (ty === Cell.Grass && wd > 2 && (forest > 0.62 ? w.rEnv.chance(0.3) : w.rEnv.chance(0.003))) {
        const age = w.rEnv.int(700);
        addTree(w, c, Tree.Oak, age >= 130 ? Stage.Mature : Stage.Sapling, age);
      }
    }
  }
  rebuildCanopy(w);
}

/** Canopy count per cell: a mature tree shades its cell and the four around it. */
export function rebuildCanopy(w: World): void {
  w.canopy.fill(0);
  for (let k = 0; k < w.trCount; k++) {
    if (!w.trAlive[k] || w.trStage[k] !== Stage.Mature) continue;
    const x = Math.floor(w.trX[k]);
    const y = Math.floor(w.trY[k]);
    for (let q = -1; q < 4; q++) {
      const xx = q < 0 ? x : x + NX[q];
      const yy = q < 0 ? y : y + NY[q];
      if (xx < 0 || yy < 0 || xx >= w.w || yy >= w.h) continue;
      const c = yy * w.w + xx;
      if (w.canopy[c] < 255) w.canopy[c]++;
    }
  }
}

/** Nearest tree at or above a stage within r cells (scans cells), or -1. */
export function nearestTree(w: World, x: number, y: number, r: number, minStage: number, kind = -1): number {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  let best = -1;
  let bd = Infinity;
  for (let dy = -r; dy <= r; dy++) {
    const yy = cy + dy;
    if (yy < 0 || yy >= w.h) continue;
    for (let dx = -r; dx <= r; dx++) {
      const xx = cx + dx;
      if (xx < 0 || xx >= w.w) continue;
      const k = w.treeAt[yy * w.w + xx];
      if (k < 0 || w.trStage[k] < minStage || w.trStage[k] === Stage.Snag || (kind >= 0 && w.trKind[k] !== kind)) continue;
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
  }
  return best;
}

/** Once a day: trees age, seed, drop acorns, die; buried caches sprout in spring. */
export function dailyTrees(w: World): void {
  const season = w.season;
  let changed = false;
  for (let k = 0; k < w.trCount; k++) {
    if (!w.trAlive[k]) continue;
    const age = ++w.trAge[k];
    const st = w.trStage[k];
    const x = Math.floor(w.trX[k]);
    const y = Math.floor(w.trY[k]);
    const c = y * w.w + x;
    if (st === Stage.Seed) {
      if (season <= 1 && age >= 14) {
        w.trStage[k] = Stage.Sapling;
        w.treeVersion++;
      } else if (age > 150) removeTree(w, k);
    } else if (st === Stage.Sapling) {
      // saplings under a closed canopy struggle
      if (w.canopy[c] > 0 && w.rEnv.chance(0.006)) removeTree(w, k);
      else if (age >= 130 && season <= 1) {
        w.trStage[k] = Stage.Mature;
        changed = true;
      }
    } else if (st === Stage.Mature) {
      if (age > w.trLife[k]) {
        w.trStage[k] = Stage.Snag;
        changed = true;
      } else if (w.trKind[k] === Tree.Oak && season === 2) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w.w || yy >= w.h) continue;
            const cc = yy * w.w + xx;
            w.acorn[cc] = Math.min(1, w.acorn[cc] + 0.025);
          }
        }
      } else if (w.trKind[k] === Tree.Willow && season === 0 && w.rEnv.chance(0.04)) {
        const nx = x + w.rEnv.int(7) - 3;
        const ny = y + w.rEnv.int(7) - 3;
        if (nx >= 0 && ny >= 0 && nx < w.w && ny < w.h) {
          const cc = ny * w.w + nx;
          const ty = w.t.type[cc];
          if ((ty === Cell.Grass || ty === Cell.Sand || ty === Cell.Marsh) && w.t.waterDist[cc] <= 3) addTree(w, cc, Tree.Willow, Stage.Seed, 0);
        }
      }
    } else if (st === Stage.Snag && age > w.trLife[k] + 220) removeTree(w, k);
  }
  if (changed) {
    rebuildCanopy(w);
    w.treeVersion++;
  }

  // acorns rot; in spring, acorns on open ground and (much more often) buried caches sprout
  const spring = season === 0;
  for (let c = 0; c < w.n; c++) {
    const a = w.acorn[c];
    const ch = w.cache[c];
    if (a <= 0 && ch <= 0) continue;
    if (a > 0) w.acorn[c] = a < 0.005 ? 0 : a * 0.985;
    if (ch > 0) w.cache[c] = ch < 0.005 ? 0 : ch * 0.997;
    if (spring && w.treeAt[c] < 0 && w.t.type[c] === Cell.Grass && w.canopy[c] === 0) {
      const p = 0.0015 * a + 0.04 * Math.min(1, ch * 4);
      if (p > 0 && w.rEnv.float() < p) {
        if (addTree(w, c, Tree.Oak, Stage.Seed, 0) >= 0) w.cache[c] = 0;
      }
    }
  }
}

/** Every 6 ticks: insects, berries, algae follow warmth, grass, carrion and water. */
export function slowFields(w: World): void {
  const warm = Math.max(0, Math.min(1, (w.warmth + 0.6) / 1.2));
  const t = w.t;
  const ins = w.insects;
  const ber = w.berry;
  const alg = w.algae;
  const berryGrow = w.season === 1 || w.season === 2 ? 0.02 : 0;
  for (let c = 0; c < w.n; c++) {
    const ty = t.type[c];
    if (ty === Cell.Water) {
      const target = 0.1 + warm * (0.15 + 0.3 * Math.min(1, t.depth[c]));
      if (alg[c] < target) alg[c] += 0.012 * (target - alg[c]);
      else alg[c] += 0.06 * (target - alg[c]);
      const ti = warm * 0.35;
      ins[c] += 0.08 * (ti - ins[c]);
      continue;
    }
    if (ty === Cell.Rock) continue;
    const ti = warm * (0.15 + 0.85 * w.grass[c]) * (1 - w.toxin[c]);
    ins[c] += 0.08 * (ti - ins[c]);
    if (t.shrub[c]) {
      if (berryGrow > 0) ber[c] = Math.min(1, ber[c] + berryGrow * ins[c]);
      else ber[c] *= 0.92;
    }
  }
}
