// Ad-hoc probe: how do hunters spend their Hunt ticks?
import { World } from '../src/sim/world';
import { Act, SPECIES } from '../src/sim/species';
import { loadInstinctNode } from './instinct-node';
const policy = (process.argv[2] ?? 'rules') as any;
const w = new World({ seed: 7, preset: 'valley', instinct: 'expert', w: 384, h: 216, policy }, loadInstinctNode());
const stat: Record<string, number[]> = {};
for (let t = 0; t < 24 * 21; t++) {
  w.step();
  for (let i = 0; i < w.hw; i++) {
    if (!w.alive[i]) continue;
    const def = SPECIES[w.sp[i]];
    if (def.encoding === 'prey' || def.encoding === 'scavenger') continue;
    const k = def.name;
    stat[k] ??= [0, 0, 0, 0, 0];
    stat[k][0]++;
    if (w.act[i] === Act.Hunt) {
      stat[k][1]++;
      if (w.tgt[i] >= 0) stat[k][2]++;
      if (w.isDay) stat[k][3]++;
    }
    stat[k][4] += w.energy[i];
  }
}
for (const [k, v] of Object.entries(stat)) console.log(k, 'hunt share', (v[1] / v[0]).toFixed(2), 'with target', (v[2] / Math.max(1, v[1])).toFixed(2), 'by day', (v[3] / Math.max(1, v[1])).toFixed(2), 'mean energy', (v[4] / v[0]).toFixed(2), 'tries', w.huntTry[SPECIES.find((s) => s.name === k)!.id]);
