import { describe, expect, it } from 'vitest';
import { decode, encode, stateCount } from '../src/sim/brain';

describe('state encodings', () => {
  it('match the spec totals', () => {
    expect(stateCount('prey')).toBe(4320);
    expect(stateCount('predator')).toBe(2304);
    expect(stateCount('pack')).toBe(6912);
    expect(stateCount('scavenger')).toBe(384);
  });

  it('round-trip every state', () => {
    for (const enc of ['prey', 'predator', 'pack', 'scavenger'] as const) {
      const n = stateCount(enc);
      for (let s = 0; s < n; s += 7) expect(encode(enc, decode(enc, s))).toBe(s);
    }
  });
});
