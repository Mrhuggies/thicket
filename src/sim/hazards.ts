// Weather, fire, disease and toxins. Deterministic: everything rolls on the world's streams.

import { Cause, Cell, Stage, TICKS_PER_DAY } from './constants';
import { Sp, SPECIES } from './species';
import { removeTree, rebuildCanopy } from './ecology';
import type { World } from './world';

export const enum Weather {
  Clear = 0,
  Rain = 1,
  Storm = 2,
  Heat = 3,
  Cold = 4,
}
export const WEATHER_NAMES = ['Clear', 'Rain', 'Storm', 'Heatwave', 'Cold snap'];

/** Pathogens and their hosts. */
export const PATHOGENS = [
  { name: 'none', hosts: [] as number[] },
  { name: 'rabbit plague', hosts: [Sp.Rabbit] },
  { name: 'mange', hosts: [Sp.Fox, Sp.Wolf, Sp.Cat] },
  { name: 'bird flu', hosts: [Sp.Hawk, Sp.Owl, Sp.Heron] },
];
export const HOST = new Uint8Array(PATHOGENS.length * 16);
PATHOGENS.forEach((p, k) => p.hosts.forEach((s) => (HOST[k * 16 + s] = 1)));

// ---------------------------------------------------------------------------
// weather
// ---------------------------------------------------------------------------

/** Once a day: step the weather chain and the wind. */
export function dailyWeather(w: World): void {
  const r = w.rEnv;
  const season = w.season;
  const drought = w.tick < w.droughtUntil;
  // probabilities of tomorrow's weather by season (spring, summer, autumn, winter)
  const pRain = drought ? 0.03 : [0.3, 0.18, 0.32, 0.22][season];
  const pStorm = drought ? 0.02 : [0.06, 0.1, 0.08, 0.04][season];
  const pHeat = (drought ? 0.35 : 0) + [0.02, 0.14, 0.02, 0][season];
  const pCold = [0.04, 0, 0.06, 0.22][season];
  const stay = w.weather === Weather.Clear ? 0 : 0.45;
  if (!r.chance(stay)) {
    const x = r.float();
    if (x < pRain) w.weather = Weather.Rain;
    else if (x < pRain + pStorm) w.weather = Weather.Storm;
    else if (x < pRain + pStorm + pHeat) w.weather = Weather.Heat;
    else if (x < pRain + pStorm + pHeat + pCold) w.weather = Weather.Cold;
    else w.weather = Weather.Clear;
  }
  // wind drifts; storms blow hard
  w.windX += (r.float() - 0.5) * 0.6;
  w.windY += (r.float() - 0.5) * 0.6;
  const l = Math.sqrt(w.windX * w.windX + w.windY * w.windY) || 1;
  w.windX /= l;
  w.windY /= l;
  w.windStrength = w.weather === Weather.Storm ? 1 : 0.25 + 0.35 * r.float();
  // summer storms can start fires
  if (w.weather === Weather.Storm && season === 1 && r.chance(0.25)) {
    for (let tries = 0; tries < 30; tries++) {
      const c = r.int(w.n);
      if (w.t.type[c] === Cell.Grass && w.grass[c] > 0.35) {
        ignite(w, c, true);
        break;
      }
    }
  }
}

export function weatherGrowMul(w: World): number {
  return w.weather === Weather.Rain || w.weather === Weather.Storm ? 1.35 : w.weather === Weather.Heat ? 0.65 : 1;
}

export function weatherThirstMul(w: World): number {
  return w.weather === Weather.Heat ? 1.6 : w.weather === Weather.Rain || w.weather === Weather.Storm ? 0.7 : 1;
}

export function weatherMetabMul(w: World): number {
  return w.weather === Weather.Cold ? 1.15 : 1;
}

// ---------------------------------------------------------------------------
// fire
// ---------------------------------------------------------------------------

function fuelAt(w: World, c: number): number {
  const ty = w.t.type[c];
  if (ty === Cell.Water || w.wall[c]) return 0;
  let f = w.grass[c];
  const k = w.treeAt[c];
  if (k >= 0) f += w.trStage[k] === Stage.Mature ? 1.4 : w.trStage[k] === Stage.Snag ? 0.8 : 0.3;
  return f;
}

export function ignite(w: World, c: number, natural: boolean): boolean {
  if (w.fire[c] || fuelAt(w, c) < 0.15) return false;
  w.fire[c] = 6 + Math.min(18, Math.round(fuelAt(w, c) * 8));
  w.fireCells.push(c);
  w.fireCells.sort((a, b) => a - b);
  if (natural) w.events.push({ tick: w.tick, kind: 'fire', sp: -1, v: c });
  return true;
}

/** Rebuild the burning-cell list from the fire field (after a restore). */
export function reindexFire(w: World): void {
  w.fireCells = [];
  for (let c = 0; c < w.n; c++) if (w.fire[c]) w.fireCells.push(c);
}

const NX = [1, -1, 0, 0, 1, 1, -1, -1];
const NY = [0, 0, 1, -1, 1, -1, 1, -1];

/** Every tick: fire burns down its fuel and spreads, pushed by the wind, damped by rain. */
export function stepFire(w: World): void {
  if (!w.fireCells.length) return;
  const wet = w.weather === Weather.Rain ? 0.75 : w.weather === Weather.Storm ? 0.15 : w.weather === Weather.Heat ? -0.3 : 0;
  const cells = w.fireCells;
  const next: number[] = [];
  let treesChanged = false;
  for (let q = 0; q < cells.length; q++) {
    const c = cells[q];
    if (!w.fire[c]) continue;
    const x = c % w.w;
    const y = (c / w.w) | 0;
    // spread
    for (let k = 0; k < 8; k++) {
      const nx = x + NX[k];
      const ny = y + NY[k];
      if (nx < 0 || ny < 0 || nx >= w.w || ny >= w.h) continue;
      const nc = ny * w.w + nx;
      if (w.fire[nc] || w.scar[nc] > 0) continue;
      const fuel = fuelAt(w, nc);
      if (fuel < 0.12) continue; // grazed-down ground is a firebreak
      const along = (NX[k] * w.windX + NY[k] * w.windY) / (k < 4 ? 1 : 1.414);
      let p = 0.15 * fuel * (1 + 1.6 * w.windStrength * along) * (1 - wet);
      if (k >= 4) p *= 0.7;
      if (p > 0 && w.rEnv.float() < p) {
        w.fire[nc] = 6 + Math.min(18, Math.round(fuel * 8));
        next.push(nc);
      }
    }
    // embers jump downwind from burning trees
    const tk = w.treeAt[c];
    if (tk >= 0 && w.trStage[tk] === Stage.Mature && w.rEnv.chance(0.04 * (1 + w.windStrength))) {
      const d = 2 + w.rEnv.int(2);
      const ex = Math.round(x + w.windX * d);
      const ey = Math.round(y + w.windY * d);
      if (ex >= 0 && ey >= 0 && ex < w.w && ey < w.h) {
        const ec = ey * w.w + ex;
        if (!w.fire[ec] && fuelAt(w, ec) > 0.2) {
          w.fire[ec] = 10;
          next.push(ec);
        }
      }
    }
    // burn down
    w.grass[c] *= 0.7;
    w.fire[c]--;
    if (wet > 0.5 && w.rEnv.chance(0.25)) w.fire[c] = 0;
    if (w.fire[c] === 0) {
      w.grass[c] = 0;
      w.scar[c] = 60; // days of post-fire flush
      w.acorn[c] = 0;
      if (tk >= 0) {
        if (w.trStage[tk] === Stage.Mature) {
          w.trStage[tk] = Stage.Snag;
          w.trAge[tk] = Math.max(w.trAge[tk], w.trLife[tk]);
        } else removeTree(w, tk);
        treesChanged = true;
      }
    } else next.push(c);
    // heat scares everything nearby
    w.scare(x + 0.5, y + 0.5, 4, 0.35);
  }
  // ascending cell order, so a restored run burns exactly like an uninterrupted one
  w.fireCells = Array.from(new Set(next)).sort((a, b) => a - b);
  if (treesChanged) {
    rebuildCanopy(w);
    w.treeVersion++;
  }
}

/** Animals standing in fire may burn. Called from upkeep. */
export function fireDanger(w: World, i: number): boolean {
  const c = (w.y[i] | 0) * w.w + (w.x[i] | 0);
  if (!w.fire[c]) return false;
  const def = SPECIES[w.sp[i]];
  if (def.flying || w.shel[i] === 1) return false;
  return w.rLife.chance(0.35);
}

// ---------------------------------------------------------------------------
// disease
// ---------------------------------------------------------------------------

export function infect(w: World, i: number, p: number): boolean {
  if (!w.alive[i] || w.sick[i] || !HOST[p * 16 + w.sp[i]]) return false;
  if (w.immune[i] & (1 << p)) return false;
  w.sick[i] = 1;
  w.path[i] = p;
  w.note(i, 13);
  return true;
}

/** Called in think for sick animals: spread to nearby hosts. */
export function spread(w: World, i: number): void {
  const p = w.path[i];
  w.forEachNear(w.x[i], w.y[i], 1.5, (j) => {
    if (j !== i && HOST[p * 16 + w.sp[j]] && !w.sick[j] && w.rRes.chance(0.003)) infect(w, j, p);
  });
}

/** Once a day: emergent outbreaks where hosts are crowded and carrion lies about. */
export function dailyDisease(w: World): void {
  let carrion = 0;
  for (let k = 0; k < w.cTop; k++) carrion += w.cmass[k];
  for (let p = 1; p < PATHOGENS.length; p++) {
    let hosts = 0;
    let best = -1;
    let bestCrowd = -1;
    for (let i = 0; i < w.hw; i++) {
      if (!w.alive[i] || w.dormant[i] || !HOST[p * 16 + w.sp[i]]) continue;
      hosts++;
      if (w.crowdN[i] > bestCrowd && !w.sick[i]) {
        bestCrowd = w.crowdN[i];
        best = i;
      }
    }
    if (!hosts || best < 0) continue;
    const pr = 0.0015 * Math.min(4, hosts / 300) * (1 + carrion / 400) * (1 + bestCrowd / 6);
    if (w.rEnv.chance(pr)) {
      infect(w, best, p);
      w.events.push({ tick: w.tick, kind: 'outbreak', sp: w.sp[best], v: p });
    }
  }
}

// ---------------------------------------------------------------------------
// toxins
// ---------------------------------------------------------------------------

/** Every 6 ticks: poison spreads through connected water and slowly breaks down. */
export function stepToxin(w: World): void {
  if (!w.toxinActive) return;
  let any = false;
  const t = w.toxin;
  for (let c = 0; c < w.n; c++) {
    const v = t[c];
    if (v <= 0) continue;
    any = true;
    if (w.t.type[c] === Cell.Water) {
      const x = c % w.w;
      const y = (c / w.w) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = x + NX[k];
        const ny = y + NY[k];
        if (nx < 0 || ny < 0 || nx >= w.w || ny >= w.h) continue;
        const nc = ny * w.w + nx;
        if (w.t.type[nc] === Cell.Water && t[nc] < v * 0.8) t[nc] = Math.max(t[nc], v * 0.8);
      }
      t[c] = v * 0.985;
    } else t[c] = v * 0.97;
    if (t[c] < 0.01) t[c] = 0;
  }
  w.toxinActive = any;
}

export function scarDaily(w: World): void {
  for (let c = 0; c < w.n; c++) if (w.scar[c] > 0) w.scar[c]--;
}

export { TICKS_PER_DAY, Cause };
