// Replays a share link headless in Node and compares the state hash with the link's.
// usage: npx tsx scripts/verify-link.ts '<url or #fragment>'
import { decodeShare } from '../src/ui/share';
import { World } from '../src/sim/world';
import { loadInstinctNode } from './instinct-node';

const arg = process.argv[2] ?? '';
const frag = arg.slice(arg.indexOf('#'));
const p = await decodeShare(frag);
if (!p) throw new Error('not a share link');
const w = new World({ seed: p.seed, preset: p.preset, instinct: p.instinct, w: 384, h: 216 }, loadInstinctNode());
while (w.tick < p.tick) w.step(p.log.filter((e) => e.tick === w.tick));
const got = w.hash();
console.log(`${got === p.hash ? 'MATCH' : 'MISMATCH'}  node ${got}  link ${p.hash}  (day ${p.tick / 24}, ${p.log.length} actions)`);
process.exit(got === p.hash ? 0 : 1);
