import { World } from '../src/sim/world';
import { Act, SPECIES, Sp } from '../src/sim/species';
import { loadInstinctNode } from './instinct-node';
const w = new World({ seed: 7, preset: 'valley', instinct: 'expert', w: 384, h: 216, policy: 'rules' }, loadInstinctNode());
const hist: Record<string, number> = {};
for (let t = 0; t < 24 * 6; t++) {
  w.step();
  for (let i = 0; i < w.hw; i++) {
    if (!w.alive[i] || w.sp[i] !== Sp.Hawk) continue;
    const a = w.act[i];
    let key = 'act ' + a + (w.isDay ? ' day' : ' night');
    if (a === Act.Hunt && w.tgt[i] >= 0) {
      const j = w.tgt[i];
      const d = Math.hypot(w.x[j] - w.x[i], w.y[j] - w.y[i]);
      key += ` tgt ${SPECIES[w.sp[j]].name} d${d < 2 ? '<2' : d < 6 ? '<6' : '6+'} shel${w.shel[j]} hcool${w.hcool[i] > 0 ? 1 : 0}`;
    }
    hist[key] = (hist[key] ?? 0) + 1;
  }
}
console.log(Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${v}\t${k}`).join('\n'));
console.log('tries', w.huntTry[Sp.Hawk], 'wins', w.huntWin[Sp.Hawk]);
