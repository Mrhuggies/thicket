// Balance search: hill-climbs the TUNE knobs (global and per-species) so that as many species
// as possible survive two sim years across seeds, without runaway prey booms.
// Runs against a frozen copy of the engine so development can continue meanwhile:
//   cp -R src/sim /tmp/simcopy && SIM_DIR=/tmp/simcopy npx tsx scripts/tune.ts 60 9 224
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';

const SIM = resolve(process.env.SIM_DIR ?? 'src/sim');

interface Job { seed: number; days: number; tune: Record<string, unknown>; preset: string; sim: string }
interface Res { surv: number[]; peak: number[]; present: boolean[]; peakTotal: number }

async function run(job: Job): Promise<Res> {
  const { World } = await import(pathToFileURL(job.sim + '/world.ts').href);
  const { SPECIES, TUNE } = await import(pathToFileURL(job.sim + '/species.ts').href);
  Object.assign(TUNE, job.tune);
  const W = Number(process.env.TUNE_W ?? 256);
  const w = new World({ seed: job.seed, preset: job.preset, instinct: 'wild', w: W, h: Math.round((W * 9) / 16) });
  const present: boolean[] = SPECIES.map((s: { id: number }) => w.counts[s.id] > 0);
  const surv = SPECIES.map(() => job.days);
  const peak = SPECIES.map(() => 0);
  let peakTotal = 0;
  for (let d = 0; d < job.days; d++) {
    for (let k = 0; k < 24; k++) w.step();
    const tot = w.totalAlive();
    peakTotal = Math.max(peakTotal, tot);
    for (let s = 0; s < 16; s++) {
      peak[s] = Math.max(peak[s], w.counts[s]);
      if (present[s] && w.counts[s] === 0 && surv[s] === job.days) surv[s] = d;
    }
    if (tot > 6000 * ((Number(process.env.TUNE_W ?? 256) / 256) ** 2)) {
      for (let s = 0; s < 16; s++) if (surv[s] === job.days) surv[s] = d; // runaway: score as failure
      break;
    }
  }
  return { surv, peak, present, peakTotal };
}

if (!isMainThread) {
  run(workerData as Job).then((r) => parentPort!.postMessage(r));
} else {
  const gens = Number(process.argv[2] ?? 40);
  const seeds = Number(process.argv[3] ?? 9);
  const days = Number(process.argv[4] ?? 224);
  const presets = ['valley', 'lakes', 'plain'];
  const self = fileURLToPath(import.meta.url);
  const { SPECIES, TUNE } = await import(pathToFileURL(SIM + '/species.ts').href);
  const enabled: number[] = SPECIES.filter((s: { enabled: boolean }) => s.enabled).map((s: { id: number }) => s.id);
  const prey = new Set<number>(SPECIES.filter((s: { encoding: string }) => s.encoding === 'prey').map((s: { id: number }) => s.id));

  type Range = [number, number, 'log' | 'lin'];
  const ranges: Record<string, Range> = {
    grassRate: [0.0008, 0.003, 'log'],
    winterGrow: [0.25, 0.75, 'lin'],
    litterFoodLo: [0, 0.2, 'lin'],
    litterFoodSpan: [0.1, 0.5, 'lin'],
    crowdMul: [0.4, 3, 'log'],
    huntMul: [0.5, 1.6, 'log'],
    predMetabMul: [0.35, 1.2, 'log'],
    preyLitterMul: [0.6, 1.8, 'log'],
    pppScale: [0.3, 6, 'log'],
  };
  for (const s of enabled) {
    ranges[`L${s}`] = [0.35, 3, 'log'];
    ranges[`M${s}`] = [0.6, 1.6, 'log'];
  }
  const basePPP: number[] = (TUNE.preyPerPred as number[]).slice();

  type Cand = Record<string, number>;
  const toTune = (c: Cand) => {
    const litterMul = new Array(16).fill(1);
    const metabMul = new Array(16).fill(1);
    for (const s of enabled) {
      litterMul[s] = c[`L${s}`];
      metabMul[s] = c[`M${s}`];
    }
    return {
      grassRate: c.grassRate, winterGrow: c.winterGrow, litterFoodLo: c.litterFoodLo, litterFoodSpan: c.litterFoodSpan,
      crowdMul: c.crowdMul, huntMul: c.huntMul, predMetabMul: c.predMetabMul, preyLitterMul: c.preyLitterMul,
      preyPerPred: basePPP.map((v) => v * c.pppScale), litterMul, metabMul,
    };
  };

  let active = 0;
  const waiting: (() => void)[] = [];
  const pool = async <T,>(fn: () => Promise<T>): Promise<T> => {
    if (active >= 14) await new Promise<void>((r) => waiting.push(r));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };

  const evalCand = async (c: Cand): Promise<{ score: number; detail: string }> => {
    const jobs: Job[] = [];
    for (let k = 0; k < seeds; k++) jobs.push({ seed: 500 + k, days, tune: toTune(c), preset: presets[k % presets.length], sim: SIM });
    const res = await Promise.all(jobs.map((job) => pool(() => new Promise<Res>((ok, bad) => {
      const wk = new Worker(new URL('./worker-boot.mjs', import.meta.url), { workerData: { ...job, __entry: self } });
      wk.once('message', (m) => {
        void wk.terminate();
        ok(m);
      });
      wk.once('error', bad);
    }))));
    let score = 0;
    let n = 0;
    const perSp = new Array(16).fill(0);
    for (const r of res) {
      for (const s of enabled) {
        if (!r.present[s]) continue;
        const f = r.surv[s] / days;
        score += f + (f >= 1 ? 0.5 : 0);
        perSp[s] += f;
        n++;
        if (prey.has(s) && r.peak[s] > 2500 * ((Number(process.env.TUNE_W ?? 256) / 256) ** 2)) score -= 0.15; // booms look bad and cost time
      }
      if (r.peakTotal > 5000 * ((Number(process.env.TUNE_W ?? 256) / 256) ** 2)) score -= 1;
    }
    score /= n;
    const detail = enabled.map((s) => `${SPECIES[s].name.slice(0, 4)} ${(perSp[s] / seeds).toFixed(2)}`).join(' ');
    return { score, detail };
  };

  const clampTo = (k: string, v: number) => Math.max(ranges[k][0], Math.min(ranges[k][1], v));
  const best0: Cand = {
    grassRate: TUNE.grassRate, winterGrow: TUNE.winterGrow, litterFoodLo: TUNE.litterFoodLo, litterFoodSpan: TUNE.litterFoodSpan,
    crowdMul: TUNE.crowdMul, huntMul: TUNE.huntMul, predMetabMul: TUNE.predMetabMul, preyLitterMul: TUNE.preyLitterMul, pppScale: 1,
  };
  for (const s of enabled) {
    best0[`L${s}`] = TUNE.litterMul[s];
    best0[`M${s}`] = TUNE.metabMul[s];
  }
  let best = best0;
  let bestEval = await evalCand(best);
  console.log(`start  ${bestEval.score.toFixed(3)} | ${bestEval.detail}`);
  let sigma = 0.3;
  let seedRand = 98765;
  const rand = () => {
    seedRand = (Math.imul(seedRand, 1103515245) + 12345) >>> 0;
    return seedRand / 4294967296;
  };
  const gauss = () => {
    let s = 0;
    for (let i = 0; i < 6; i++) s += rand();
    return (s - 3) / 0.7071;
  };
  const keys = Object.keys(ranges);
  for (let g = 0; g < gens; g++) {
    const cands: Cand[] = [];
    for (let k = 0; k < 4; k++) {
      const c: Cand = { ...best };
      // perturb a random handful of knobs
      const nPerturb = 3 + Math.floor(rand() * 6);
      for (let q = 0; q < nPerturb; q++) {
        const key = keys[Math.floor(rand() * keys.length)];
        const [lo, hi, kind] = ranges[key];
        c[key] = kind === 'log' ? clampTo(key, c[key] * Math.exp(gauss() * sigma)) : clampTo(key, c[key] + gauss() * sigma * (hi - lo) * 0.5);
      }
      cands.push(c);
    }
    const evals = await Promise.all(cands.map(evalCand));
    let improved = false;
    evals.forEach((e, k) => {
      if (e.score > bestEval.score) {
        best = cands[k];
        bestEval = e;
        improved = true;
      }
    });
    sigma = improved ? Math.min(0.6, sigma * 1.1) : Math.max(0.08, sigma * 0.92);
    console.log(`gen ${g + 1}  ${bestEval.score.toFixed(3)}${improved ? ' *' : '  '} σ ${sigma.toFixed(2)} | ${bestEval.detail}`);
    writeFileSync('scripts/tune-best.json', JSON.stringify({ score: bestEval.score, detail: bestEval.detail, best, tune: toTune(best) }, null, 2));
  }
}
