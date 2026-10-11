// Balance harness: runs seeds in parallel worker threads and reports, per species,
// survival, population range, per-capita birth/death rates and time to extinction.
// usage: npm run balance -- [seeds] [days] [policy] [preset] [species csv]
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { World } from '../src/sim/world';
import { SPECIES } from '../src/sim/species';
import { CAUSE_NAMES, N_CAUSES, TICKS_PER_DAY } from '../src/sim/constants';
import { loadInstinctNode } from './instinct-node';

interface Job { seed: number; days: number; policy: 'learned' | 'rules'; preset: string; species?: number[]; instinct: string }
interface Result { seed: number; pops: number[][]; births: number[]; deaths: number[]; extinctDay: number[]; ms: number }

function runJob(job: Job): Result {
  const w = new World({ seed: job.seed, preset: job.preset as any, instinct: job.instinct as any, w: 384, h: 216, policy: job.policy, species: job.species }, loadInstinctNode());
  const pops: number[][] = [];
  const extinctDay = new Array(16).fill(-1);
  const present = SPECIES.map((s) => w.counts[s.id] > 0);
  const t0 = performance.now();
  for (let d = 0; d < job.days; d++) {
    for (let k = 0; k < TICKS_PER_DAY; k++) w.step();
    pops.push(Array.from(w.counts));
    for (let s = 0; s < 16; s++) if (present[s] && w.counts[s] === 0 && extinctDay[s] < 0) extinctDay[s] = d + 1;
  }
  return { seed: job.seed, pops, births: Array.from(w.dayBirths), deaths: Array.from(w.dayDeaths), extinctDay, ms: performance.now() - t0 };
}

if (!isMainThread) {
  parentPort!.postMessage(runJob(workerData as Job));
} else {
  const seeds = Number(process.argv[2] ?? 6);
  const days = Number(process.argv[3] ?? 224);
  const policy = (process.argv[4] ?? 'learned') as 'learned' | 'rules';
  const preset = process.argv[5] ?? 'valley';
  const species = process.argv[6] ? process.argv[6].split(',').map(Number) : undefined;
  const instinct = process.argv[7] ?? 'expert';
  const self = fileURLToPath(import.meta.url);
  const jobs: Job[] = Array.from({ length: seeds }, (_, k) => ({ seed: 100 + k, days, policy, preset, species, instinct }));
  const results = await Promise.all(jobs.map((job) => new Promise<Result>((res, rej) => {
    const wk = new Worker(new URL('./worker-boot.mjs', import.meta.url), { workerData: { ...job, __entry: self } });
    wk.once('message', res);
    wk.once('error', rej);
  })));
  const live = SPECIES.filter((s) => results[0].pops[0][s.id] > 0 || results.some((r) => r.births[s.id] > 0));
  for (const r of results) {
    const ext = SPECIES.filter((s) => r.extinctDay[s.id] > 0).sort((a, b) => r.extinctDay[a.id] - r.extinctDay[b.id]).map((s) => `${s.name} d${r.extinctDay[s.id]}`);
    console.log(`seed ${r.seed}: ${ext.length ? ext.join(', ') : 'no extinctions'}`);
  }
  console.log(`${seeds} seeds × ${days} days, ${policy}, ${preset}, instinct ${instinct}  (avg ${(results.reduce((a, r) => a + r.ms, 0) / results.length / 1000).toFixed(1)}s/run)`);
  console.log('species    alive@end  min..max(mean)        births/cap/day  deaths/cap/day by cause            extinct day (median)');
  for (const s of live) {
    const alive = results.filter((r) => r.pops[r.pops.length - 1][s.id] > 0).length;
    let mn = Infinity, mx = 0, sum = 0, n = 0;
    for (const r of results) for (const p of r.pops) { mn = Math.min(mn, p[s.id]); mx = Math.max(mx, p[s.id]); sum += p[s.id]; n++; }
    const mean = sum / n;
    const capDays = sum / results.length; // animal-days per run
    const births = results.reduce((a, r) => a + r.births[s.id], 0) / results.length;
    const causes: string[] = [];
    for (let c = 0; c < N_CAUSES; c++) {
      const v = results.reduce((a, r) => a + r.deaths[s.id * N_CAUSES + c], 0) / results.length;
      if (v > 0) causes.push(`${CAUSE_NAMES[c].slice(0, 5)} ${(v / capDays).toFixed(3)}`);
    }
    const ext = results.map((r) => r.extinctDay[s.id]).filter((d) => d > 0).sort((a, b) => a - b);
    const med = ext.length ? ext[Math.floor(ext.length / 2)] : '-';
    console.log(`${s.name.padEnd(10)} ${String(alive + '/' + seeds).padEnd(10)} ${`${mn}..${mx} (${mean.toFixed(0)})`.padEnd(22)}${(births / capDays).toFixed(3).padEnd(16)}${causes.join(', ').padEnd(35)} ${ext.length ? `${ext.length} died out, median day ${med}` : ''}`);
  }
}
