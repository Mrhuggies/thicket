// Tabular Q-learning with per-species bloodlines. Every encoding lists its bins and the
// state count is their product, so the numbers in the spec are checked by tests, not trusted.

import { MAX_LINEAGES, GAMMA } from './constants';
import { Encoding, N_SPECIES, SPECIES } from './species';

export type Feature = [name: string, bins: number];

export const ENCODINGS: Record<Encoding, Feature[]> = {
  prey: [['hunger', 4], ['thirst', 3], ['threat', 5], ['food', 3], ['shelter', 3], ['light', 2], ['breed', 2], ['crowd', 2]],
  predator: [['hunger', 4], ['thirst', 3], ['prey', 4], ['huntReady', 2], ['threat', 3], ['light', 2], ['breed', 2], ['carrion', 2]],
  pack: [['hunger', 4], ['thirst', 3], ['prey', 4], ['huntReady', 2], ['threat', 3], ['light', 2], ['breed', 2], ['carrion', 2], ['pack', 3]],
  scavenger: [['hunger', 4], ['thirst', 3], ['carrion', 4], ['circling', 2], ['light', 2], ['breed', 2]],
};

export const BIN_LABELS: Record<string, string[]> = {
  hunger: ['fed', 'peckish', 'hungry', 'starving'],
  thirst: ['watered', 'thirsty', 'parched'],
  threat: ['safe', 'ground threat near', 'ground threat close', 'air threat near', 'air threat close'],
  food: ['little food', 'some food', 'good food'],
  shelter: ['in shelter', 'shelter near', 'shelter far'],
  light: ['night', 'day'],
  breed: ['not ready to breed', 'ready to breed'],
  crowd: ['space', 'crowded'],
  prey: ['no prey', 'prey far', 'prey near', 'prey in reach'],
  huntReady: ['resting from a chase', 'ready to hunt'],
  carrion: ['no carrion', 'carrion seen'],
  pack: ['alone', 'small pack', 'big pack'],
  circling: ['no vultures circling', 'vultures circling'],
};
BIN_LABELS['threat3'] = ['safe', 'danger near', 'danger close'];
BIN_LABELS['carrion4'] = ['no carrion', 'carrion far', 'carrion near', 'carrion here'];

export function stateCount(enc: Encoding): number {
  return ENCODINGS[enc].reduce((p, [, b]) => p * b, 1);
}

/** Place value of each feature in the mixed-radix state number. */
const RADIX: Record<Encoding, Int32Array> = {} as Record<Encoding, Int32Array>;
for (const enc of Object.keys(ENCODINGS) as Encoding[]) {
  const f = ENCODINGS[enc];
  const r = new Int32Array(f.length);
  let m = 1;
  for (let i = f.length - 1; i >= 0; i--) {
    r[i] = m;
    m *= f[i][1];
  }
  RADIX[enc] = r;
}

/** Mixed-radix encode; values must already be within their bins. */
export function encode(enc: Encoding, v: ArrayLike<number>): number {
  const r = RADIX[enc];
  let s = 0;
  for (let i = 0; i < r.length; i++) s += r[i] * v[i];
  return s;
}

export function decode(enc: Encoding, s: number): number[] {
  const f = ENCODINGS[enc];
  const out = new Array<number>(f.length);
  for (let i = f.length - 1; i >= 0; i--) {
    out[i] = s % f[i][1];
    s = Math.floor(s / f[i][1]);
  }
  return out;
}

export function describeState(enc: Encoding, s: number): string[] {
  const f = ENCODINGS[enc];
  const v = decode(enc, s);
  return f.map(([name], i) => {
    let key = name;
    if (name === 'threat' && f[i][1] === 3) key = 'threat3';
    if (name === 'carrion' && f[i][1] === 4) key = 'carrion4';
    return BIN_LABELS[key][v[i]];
  });
}

export type Instinct = 'newborn' | 'wild' | 'expert';

/** One bloodline: a Q-table shared and updated by all its members. */
export interface Lineage {
  q: Float32Array; // states × allowed actions
  visits: Uint16Array; // per state-action, saturating
  stateVisits: Uint16Array; // per state, saturating
}

export class Brains {
  /** lineages[species][slot] */
  lin: (Lineage | null)[][] = [];
  members = new Int32Array(N_SPECIES * MAX_LINEAGES);
  founded = new Uint32Array(N_SPECIES * MAX_LINEAGES);
  rewardSum = new Float64Array(N_SPECIES * MAX_LINEAGES); // decayed reward, for the learning curve
  rewardN = new Float64Array(N_SPECIES * MAX_LINEAGES);
  hue = new Uint16Array(N_SPECIES * MAX_LINEAGES);
  nStates: number[] = [];
  nActs: number[] = [];

  constructor() {
    for (const sp of SPECIES) {
      this.lin.push(new Array(MAX_LINEAGES).fill(null));
      this.nStates.push(stateCount(sp.encoding));
      this.nActs.push(sp.actions.length);
    }
  }

  static initValue(sp: number): number {
    return SPECIES[sp].encoding === 'prey' ? 2.5 : 3;
  }

  blank(sp: number): Lineage {
    const n = this.nStates[sp] * this.nActs[sp];
    const q = new Float32Array(n).fill(Brains.initValue(sp));
    return { q, visits: new Uint16Array(n), stateVisits: new Uint16Array(this.nStates[sp]) };
  }

  /** A blank table nudged toward a reflex policy: the reflex action starts `bonus` ahead. */
  prior(sp: number, reflex: (state: number[]) => number, bonus = 1.5): Lineage {
    const l = this.blank(sp);
    const nA = this.nActs[sp];
    const enc = SPECIES[sp].encoding;
    for (let st = 0; st < this.nStates[sp]; st++) {
      const a = reflex(decode(enc, st));
      if (a >= 0) l.q[st * nA + a] += bonus;
    }
    return l;
  }

  /** First free bloodline slot, or -1. */
  freeSlot(sp: number): number {
    const row = this.lin[sp];
    for (let i = 0; i < MAX_LINEAGES; i++) if (!row[i]) return i;
    return -1;
  }

  found(sp: number, slot: number, from: Lineage, tick: number, hue: number, noise: (() => number) | null): void {
    const l: Lineage = { q: new Float32Array(from.q), visits: new Uint16Array(from.visits), stateVisits: new Uint16Array(from.stateVisits) };
    if (noise) for (let i = 0; i < l.q.length; i++) l.q[i] += noise();
    // A new bloodline is a fresh start: it keeps the values but learns quickly again.
    for (let i = 0; i < l.visits.length; i++) l.visits[i] = Math.min(l.visits[i], 40);
    this.lin[sp][slot] = l;
    const k = sp * MAX_LINEAGES + slot;
    this.members[k] = 0;
    this.founded[k] = tick;
    this.rewardSum[k] = 0;
    this.rewardN[k] = 0;
    this.hue[k] = hue;
  }

  retire(sp: number, slot: number): void {
    this.lin[sp][slot] = null;
  }

  epsilon(l: Lineage, s: number, newborn: boolean): number {
    const sv = l.stateVisits[s];
    const start = newborn ? 0.3 : 0.12;
    return Math.max(0.03, (start * 25) / (25 + sv));
  }

  update(l: Lineage, s: number, a: number, nA: number, target: number): void {
    const k = s * nA + a;
    const n = l.visits[k];
    const alpha = Math.max(0.02, (0.16 * 30) / (30 + n));
    l.q[k] += alpha * (target - l.q[k]);
    if (n < 65535) l.visits[k] = n + 1;
  }

  maxQ(l: Lineage, s: number, nA: number): number {
    let m = -Infinity;
    const base = s * nA;
    for (let a = 0; a < nA; a++) if (l.q[base + a] > m) m = l.q[base + a];
    return m;
  }

  argmax(l: Lineage, s: number, nA: number): number {
    let m = -Infinity;
    let best = 0;
    const base = s * nA;
    for (let a = 0; a < nA; a++) {
      const v = l.q[base + a];
      if (v > m) {
        m = v;
        best = a;
      }
    }
    return best;
  }
}

export { GAMMA };
