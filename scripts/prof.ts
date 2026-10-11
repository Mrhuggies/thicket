import { World } from '../src/sim/world';
const w = new World({ seed: 639691, preset: 'valley', instinct: 'wild', w: 384, h: 216 });
for (let t = 0; t < 24 * 28; t++) w.step();
console.log('animals', w.totalAlive());
const t0 = performance.now();
for (let t = 0; t < 48; t++) w.step();
console.log('ms/tick', ((performance.now() - t0) / 48).toFixed(2));
