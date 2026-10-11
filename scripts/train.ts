// Instinct trainer with validation.
// 1. Train several worlds in parallel from the rules prior (learning on, no top-ups).
// 2. Average the leading bloodline's Q-table per species across worlds.
// 3. Validate trained tables against the plain prior on fresh seeds; only ship them if they
//    keep species alive at least as well.
// usage: npx tsx scripts/train.ts [worlds] [days] [validationSeeds] [validationDays]
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
import { World } from '../src/sim/world';
import { SPECIES } from '../src/sim/species';
import { MAX_LINEAGES, TICKS_PER_DAY } from '../src/sim/constants';
import { InstinctSet, packInstinct } from '../src/sim/instinct';

type Job =
  | { kind: 'train'; seed: number; preset: string; days: number }
  | { kind: 'eval'; seed: number; preset: string; days: number; tables: [number, number[]][] | null };

function trainJob(job: Extract<Job, { kind: 'train' }>) {
  const w = new World({ seed: job.seed, preset: job.preset as any, instinct: 'wild', w: 384, h: 216 });
  for (let t = 0; t < job.days * TICKS_PER_DAY; t++) w.step();
  const out: [number, number[]][] = [];
  for (const s of SPECIES) {
    let best = -1;
    let bestM = 0;
    for (let l = 0; l < MAX_LINEAGES; l++) {
      const m = w.brains.members[s.id * MAX_LINEAGES + l];
      if (w.brains.lin[s.id][l] && m > bestM) {
        bestM = m;
        best = l;
      }
    }
    if (best >= 0 && bestM >= 3) out.push([s.id, Array.from(w.brains.lin[s.id][best]!.q)]);
  }
  return out;
}

function evalJob(job: Extract<Job, { kind: 'eval' }>) {
  const inst: InstinctSet | undefined = job.tables
    ? new Map(job.tables.map(([s, q]) => [s, { wild: new Float32Array(q), expert: new Float32Array(q) }]))
    : undefined;
  const w = new World({ seed: job.seed, preset: job.preset as any, instinct: 'wild', w: 256, h: 144 }, inst);
  const present = SPECIES.map((s) => w.counts[s.id] > 0);
  const surv = SPECIES.map(() => job.days);
  for (let d = 0; d < job.days; d++) {
    for (let t = 0; t < TICKS_PER_DAY; t++) w.step();
    for (let s = 0; s < 16; s++) if (present[s] && w.counts[s] === 0 && surv[s] === job.days) surv[s] = d;
  }
  let score = 0;
  let n = 0;
  for (let s = 0; s < 16; s++) if (present[s]) {
    score += surv[s] / job.days;
    n++;
  }
  return score / n;
}

if (!isMainThread) {
  const job = workerData as Job;
  parentPort!.postMessage(job.kind === 'train' ? trainJob(job) : evalJob(job));
} else {
  const worlds = Number(process.argv[2] ?? 12);
  const days = Number(process.argv[3] ?? 224);
  const vSeeds = Number(process.argv[4] ?? 8);
  const vDays = Number(process.argv[5] ?? 224);
  const presets = ['valley', 'lakes', 'islands', 'plain', 'highlands'];
  const self = fileURLToPath(import.meta.url);
  let active = 0;
  const waiting: (() => void)[] = [];
  const run = async <T,>(job: Job): Promise<T> => {
    if (active >= 14) await new Promise<void>((r) => waiting.push(r));
    active++;
    try {
      return await new Promise<T>((ok, bad) => {
        const wk = new Worker(new URL('./worker-boot.mjs', import.meta.url), { workerData: { ...job, __entry: self } });
        wk.once('message', (m) => {
          void wk.terminate();
          ok(m as T);
        });
        wk.once('error', bad);
      });
    } finally {
      active--;
      waiting.shift()?.();
    }
  };

  const t0 = performance.now();
  const trained = await Promise.all(Array.from({ length: worlds }, (_, k) => run<[number, number[]][]>({ kind: 'train', seed: 2000 + k, preset: presets[k % presets.length], days })));
  console.log(`trained ${worlds} worlds × ${days} days in ${((performance.now() - t0) / 1000).toFixed(0)}s`);

  // average each species' table over the worlds where it had a leading bloodline
  const sums = new Map<number, { q: Float64Array; n: number }>();
  for (const res of trained) for (const [s, q] of res) {
    const e = sums.get(s) ?? { q: new Float64Array(q.length), n: 0 };
    for (let i = 0; i < q.length; i++) e.q[i] += q[i];
    e.n++;
    sums.set(s, e);
  }
  const tables: [number, number[]][] = [];
  for (const [s, e] of sums) tables.push([s, Array.from(e.q, (v) => v / e.n)]);
  console.log(`averaged tables for ${tables.length} species`);

  const evalSet = async (t: [number, number[]][] | null) => {
    const scores = await Promise.all(Array.from({ length: vSeeds }, (_, k) => run<number>({ kind: 'eval', seed: 7000 + k, preset: presets[k % 3], days: vDays, tables: t })));
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  };
  const [prior, candidate] = await Promise.all([evalSet(null), evalSet(tables)]);
  console.log(`validation (${vSeeds} seeds × ${vDays} days): prior ${prior.toFixed(3)}, trained ${candidate.toFixed(3)}`);
  if (candidate + 0.005 >= prior) {
    const set: InstinctSet = new Map(tables.map(([s, q]) => [s, { wild: new Float32Array(q), expert: new Float32Array(q) }]));
    mkdirSync('public/brains', { recursive: true });
    writeFileSync('public/brains/instinct.bin', Buffer.from(packInstinct(set)));
    console.log('shipped: wrote public/brains/instinct.bin');
  } else {
    console.log('not shipped: the trained tables did worse than the rules prior');
  }
}
