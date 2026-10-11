// Headless run: prints populations every week and the final state hash.
// usage: npm run sim -- [days] [seed] [preset] [instinct]
import { World } from '../src/sim/world';
import { SPECIES } from '../src/sim/species';
import { TICKS_PER_DAY, CAUSE_NAMES, N_CAUSES } from '../src/sim/constants';
import { loadInstinctNode } from './instinct-node';

const days = Number(process.argv[2] ?? 60);
const seed = Number(process.argv[3] ?? 1);
const preset = (process.argv[4] ?? 'valley') as any;
const instinct = (process.argv[5] ?? 'wild') as any;

const policy = (process.argv[6] ?? 'learned') as any;
const world = new World({ seed, preset, instinct, w: 384, h: 216, policy }, loadInstinctNode());
const live = SPECIES.filter((s) => world.counts[s.id] > 0);
console.log('day  ' + live.map((s) => s.name.slice(0, 6).padStart(7)).join('') + '   grass   ms/tick');
let t0 = performance.now();
const acts = new Float64Array(16 * 15);
for (let d = 1; d <= days; d++) {
  for (let k = 0; k < TICKS_PER_DAY; k++) {
    world.step();
    for (let q = 0; q < acts.length; q++) acts[q] += world.actionCounts[q];
  }
  if (d % 7 === 0 || d === days) {
    const ms = (performance.now() - t0) / (7 * TICKS_PER_DAY);
    t0 = performance.now();
    let g = 0;
    for (let c = 0; c < world.n; c++) g += world.grass[c];
    console.log(String(d).padStart(4) + ' ' + live.map((s) => String(world.counts[s.id]).padStart(7)).join('') + '   ' + (g / world.n).toFixed(3) + '   ' + ms.toFixed(2));
  }
}
const deaths: string[] = [];
for (const s of live) {
  const parts: string[] = [];
  for (let c = 0; c < N_CAUSES; c++) if (world.dayDeaths[s.id * N_CAUSES + c]) parts.push(`${CAUSE_NAMES[c]} ${world.dayDeaths[s.id * N_CAUSES + c]}`);
  deaths.push(`${s.name}: born ${world.dayBirths[s.id]} | ${parts.join(', ')}`);
}
console.log('deaths (all time):\n  ' + deaths.join('\n  '));
import('../src/sim/species').then(({ ACTION_NAMES }) => {
  for (const sp of live) {
    let tot = 0;
    for (let a = 0; a < 15; a++) tot += acts[sp.id * 15 + a];
    const parts = sp.actions.map((a) => `${ACTION_NAMES[a]} ${((100 * acts[sp.id * 15 + a]) / tot).toFixed(0)}%`);
    console.log(`  ${sp.name}: ${parts.join(' ')}`);
  }
});
for (const sp of live) {
  if (!world.huntTry[sp.id]) continue;
  const victims = live.filter((v) => world.killMatrix[sp.id * 16 + v.id] > 0).map((v) => `${v.name} ${world.killMatrix[sp.id * 16 + v.id]}`);
  console.log(`  ${sp.name} hunts: ${world.huntWin[sp.id]}/${world.huntTry[sp.id]} (${((100 * world.huntWin[sp.id]) / world.huntTry[sp.id]).toFixed(0)}%) → ${victims.join(', ')}`);
}
console.log('hash', world.hash(), 'tick', world.tick);
