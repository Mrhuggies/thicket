// Beavers re-engineer the map: dams flood the valley upstream into ponds, ponds attract
// frogs, fish and herons, and when a dam fails the pond drains to marsh, then meadow.

import { Cell, MAX_DAMS, Stage, Tree } from './constants';
import { refreshWater } from './terrain';
import { removeTree, rebuildCanopy } from './ecology';
import type { World } from './world';

/** Is this water cell part of a narrow channel (a stream worth damming)? */
export function isChannel(w: World, c: number): boolean {
  if (w.t.type[c] !== Cell.Water || w.pondOf[c] >= 0) return false;
  const x = c % w.w;
  const y = (c / w.w) | 0;
  let water = 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w.w || yy >= w.h) continue;
      if (w.t.type[yy * w.w + xx] === Cell.Water) water++;
    }
  }
  return water <= 13;
}

export function nearestDam(w: World, x: number, y: number, r: number): number {
  let best = -1;
  let bd = r * r;
  for (let k = 0; k < w.damCount; k++) {
    if (!w.damAlive[k]) continue;
    const d = (w.damX[k] - x) ** 2 + (w.damY[k] - y) ** 2;
    if (d < bd) {
      bd = d;
      best = k;
    }
  }
  return best;
}

/** Build a dam on a channel cell and flood the low ground upstream of it. */
export function buildDam(w: World, c: number): number {
  let k = -1;
  for (let q = 0; q < w.damCount; q++) if (!w.damAlive[q]) {
    k = q;
    break;
  }
  if (k < 0) {
    if (w.damCount >= MAX_DAMS) return -1;
    k = w.damCount++;
  }
  const t = w.t;
  w.damX[k] = (c % w.w) + 0.5;
  w.damY[k] = Math.floor(c / w.w) + 0.5;
  w.damHp[k] = 1;
  w.damAlive[k] = 1;
  // flood: cells within 9 of the dam whose ground lies barely above it
  const lip = t.elev[c] + 0.035;
  const x0 = c % w.w;
  const y0 = (c / w.w) | 0;
  const queue = [c];
  const seen = new Uint8Array(w.n);
  seen[c] = 1;
  let flooded = 0;
  let treesChanged = false;
  while (queue.length) {
    const cc = queue.shift()!;
    const x = cc % w.w;
    const y = (cc / w.w) | 0;
    for (let k2 = 0; k2 < 4; k2++) {
      const nx = x + (k2 === 0 ? 1 : k2 === 1 ? -1 : 0);
      const ny = y + (k2 === 2 ? 1 : k2 === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= w.w || ny >= w.h) continue;
      if ((nx - x0) ** 2 + (ny - y0) ** 2 > 81) continue;
      const nc = ny * w.w + nx;
      if (seen[nc]) continue;
      seen[nc] = 1;
      const ty = t.type[nc];
      if (ty === Cell.Rock || w.wall[nc] || t.elev[nc] > lip) continue;
      if (ty !== Cell.Water) {
        t.type[nc] = Cell.Water;
        t.depth[nc] = Math.max(0.2, Math.min(0.7, (lip - t.elev[nc]) * 14));
        w.pondOf[nc] = k;
        w.grass[nc] = 0;
        const tk = w.treeAt[nc];
        if (tk >= 0) {
          if (w.trKind[tk] === Tree.Oak && w.trStage[tk] === Stage.Mature) {
            w.trStage[tk] = Stage.Snag; // drowned oaks stand dead in the pond
            w.trAge[tk] = w.trLife[tk];
          } else removeTree(w, tk);
          treesChanged = true;
        }
        flooded++;
      }
      queue.push(nc);
    }
  }
  if (treesChanged) {
    rebuildCanopy(w);
    w.treeVersion++;
  }
  refreshWater(t);
  w.waterVersion++;
  w.events.push({ tick: w.tick, kind: 'dam', sp: -1, v: flooded });
  return k;
}

/** Remove a dam: its pond drains to marsh. */
export function breakDam(w: World, k: number): void {
  if (!w.damAlive[k]) return;
  w.damAlive[k] = 0;
  const t = w.t;
  let drained = 0;
  for (let c = 0; c < w.n; c++) {
    if (w.pondOf[c] !== k) continue;
    w.pondOf[c] = -1;
    t.type[c] = Cell.Marsh;
    t.depth[c] = 0;
    w.marshAge[c] = 1;
    drained++;
  }
  refreshWater(t);
  w.waterVersion++;
  w.events.push({ tick: w.tick, kind: 'dam-break', sp: -1, v: drained });
}

/** Once a day: dams decay (beavers repair them), spring floods take weak ones, marsh dries out. */
export function dailyDams(w: World): void {
  for (let k = 0; k < w.damCount; k++) {
    if (!w.damAlive[k]) continue;
    w.damHp[k] -= 0.012;
    if (w.damHp[k] <= 0 || (w.season === 0 && w.damHp[k] < 0.5 && w.rEnv.chance(0.08))) breakDam(w, k);
  }
  // marsh ages daily but dries out in weekly batches, so the map changes rarely
  const dryDay = Math.floor(w.tick / 24) % 7 === 0;
  let dried = false;
  for (let c = 0; c < w.n; c++) {
    if (!w.marshAge[c]) continue;
    if (++w.marshAge[c] > 70 && dryDay) {
      w.marshAge[c] = 0;
      if (w.t.type[c] === Cell.Marsh) {
        w.t.type[c] = Cell.Grass;
        dried = true;
      }
    }
  }
  if (dried) {
    refreshWater(w.t);
    w.waterVersion++;
  }
}

export function nearestWillow(w: World, x: number, y: number, r: number): number {
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
      if (k < 0 || w.trKind[k] !== Tree.Willow || w.trStage[k] === Stage.Seed || w.trStage[k] === Stage.Snag) continue;
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
  }
  return best;
}
