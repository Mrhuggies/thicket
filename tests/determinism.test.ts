import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { cos, exp, log, sin } from '../src/sim/detmath';

const cfg = { seed: 42, preset: 'valley' as const, instinct: 'wild' as const, w: 192, h: 108 };

describe('determinism', () => {
  it('same seed, same world', () => {
    const a = new World(cfg);
    const b = new World(cfg);
    for (let t = 0; t < 300; t++) {
      a.step();
      b.step();
    }
    expect(a.hash()).toBe(b.hash());
  });

  it('different seeds differ', () => {
    const a = new World(cfg);
    const b = new World({ ...cfg, seed: 43 });
    expect(a.hash()).not.toBe(b.hash());
  });

  it('snapshot → restore → continue matches an uninterrupted run', () => {
    const a = new World(cfg);
    for (let t = 0; t < 200; t++) a.step();
    const snap = a.snapshot();
    for (let t = 0; t < 150; t++) a.step();

    const b = new World(cfg);
    b.restore(snap);
    for (let t = 0; t < 150; t++) b.step();
    expect(b.hash()).toBe(a.hash());
  });

  it('fire, poison, outbreaks and tools survive snapshot → restore', () => {
    const ev = [
      { tick: 30, tool: 'ignite', a: [60, 30] },
      { tick: 31, tool: 'ignite', a: [120, 70] },
      { tick: 32, tool: 'poison', a: [96, 54] },
      { tick: 33, tool: 'outbreak', a: [1, 80, 50] },
      { tick: 34, tool: 'wall', a: [20, 20, 60, 40] },
      { tick: 35, tool: 'plant', a: [0, 100, 30] },
      { tick: 36, tool: 'pesticide', a: [50, 60, 10] },
      { tick: 37, tool: 'food', a: [1, 70, 70] },
      { tick: 38, tool: 'dam', a: [96, 54] },
      { tick: 39, tool: 'release', a: [8, 90, 50, 4] },
      { tick: 200, tool: 'breach', a: [96, 54] },
      { tick: 210, tool: 'rain', a: [60, 30, 20] },
    ];
    const at = (w: World) => ev.filter((e) => e.tick === w.tick);
    const a = new World(cfg);
    for (let t = 0; t < 60; t++) a.step(at(a));
    const snap = a.snapshot();
    for (let t = 0; t < 400; t++) a.step(at(a));
    const b = new World(cfg);
    b.restore(snap);
    for (let t = 0; t < 400; t++) b.step(at(b));
    expect(b.hash()).toBe(a.hash());
  });

  it('logged actions replay exactly', () => {
    const ev = [{ tick: 50, tool: 'release', a: [7, 90, 50, 5] }, { tick: 120, tool: 'cull', a: [0, 60, 40, 12] }];
    const run = () => {
      const w = new World(cfg);
      for (let t = 0; t < 250; t++) w.step(ev.filter((e) => e.tick === w.tick));
      return w.hash();
    };
    expect(run()).toBe(run());
  });
});

describe('detmath', () => {
  it('tracks Math closely', () => {
    for (let x = -20; x <= 20; x += 0.37) {
      expect(Math.abs(sin(x) - Math.sin(x))).toBeLessThan(1e-9);
      expect(Math.abs(cos(x) - Math.cos(x))).toBeLessThan(1e-9);
      expect(Math.abs(exp(x / 4) - Math.exp(x / 4)) / Math.exp(x / 4)).toBeLessThan(1e-12);
    }
    for (let x = 0.01; x < 1000; x *= 1.7) expect(Math.abs(log(x) - Math.log(x))).toBeLessThan(1e-12);
  });
});
