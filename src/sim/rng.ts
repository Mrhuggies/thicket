// Seeded PRNG (xoshiro128**). Every subsystem owns its own stream, seeded from
// hash(world seed, subsystem name), so adding a system never shifts the dice of another.

const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;

export function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mix32(x: number): number {
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

export class Rng {
  s = new Uint32Array(4);

  constructor(seed: number) {
    let x = seed >>> 0;
    for (let i = 0; i < 4; i++) {
      x = (x + 0x9e3779b9) >>> 0;
      this.s[i] = mix32(x);
    }
    if ((this.s[0] | this.s[1] | this.s[2] | this.s[3]) === 0) this.s[0] = 1;
  }

  static stream(worldSeed: number, name: string): Rng {
    return new Rng(mix32((worldSeed >>> 0) ^ hashString(name)));
  }

  u32(): number {
    const s = this.s;
    const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
    const t = (s[1] << 9) >>> 0;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 11);
    return result;
  }

  /** Uniform in [0, 1). */
  float(): number {
    return this.u32() / 4294967296;
  }

  int(n: number): number {
    return Math.floor(this.float() * n);
  }

  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.float();
  }

  chance(p: number): boolean {
    return this.float() < p;
  }

  /** Approximately N(0,1) via Irwin–Hall (sum of 12 uniforms − 6): no transcendental maths needed. */
  normal(): number {
    let s = 0;
    for (let i = 0; i < 12; i++) s += this.float();
    return s - 6;
  }

  /** Random unit vector by rejection sampling (no trig). */
  unit(out: { x: number; y: number }): void {
    for (;;) {
      const x = this.float() * 2 - 1;
      const y = this.float() * 2 - 1;
      const d = x * x + y * y;
      if (d > 0.01 && d <= 1) {
        const l = Math.sqrt(d);
        out.x = x / l;
        out.y = y / l;
        return;
      }
    }
  }

  getState(): number[] {
    return Array.from(this.s);
  }

  setState(st: number[]): void {
    for (let i = 0; i < 4; i++) this.s[i] = st[i] >>> 0;
  }
}
