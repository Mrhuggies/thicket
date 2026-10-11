// Deterministic transcendental functions. IEEE 754 guarantees +, −, ×, ÷ and sqrt are
// identical on every engine; Math.sin/cos/exp/log/pow are not. Simulation code uses these.

const PI = 3.141592653589793;
const TWO_PI = 6.283185307179586;
const LN2 = 0.6931471805599453;

function sinCore(x: number): number {
  // x in [-PI/2, PI/2]; Taylor to x^13 is accurate to ~1e-12 here.
  const x2 = x * x;
  return x * (1 - x2 / 6 * (1 - x2 / 20 * (1 - x2 / 42 * (1 - x2 / 72 * (1 - x2 / 110 * (1 - x2 / 156))))));
}

export function sin(x: number): number {
  x = x - TWO_PI * Math.round(x / TWO_PI); // [-PI, PI]
  if (x > PI / 2) x = PI - x;
  else if (x < -PI / 2) x = -PI - x;
  return sinCore(x);
}

export function cos(x: number): number {
  return sin(x + PI / 2);
}

export function exp(x: number): number {
  if (x > 700) return Infinity;
  if (x < -700) return 0;
  const k = Math.round(x / LN2);
  const r = x - k * LN2; // |r| <= ln2/2
  let term = 1;
  let sum = 1;
  for (let i = 1; i < 16; i++) {
    term *= r / i;
    sum += term;
  }
  let scale = 1;
  if (k > 0) for (let i = 0; i < k; i++) scale *= 2;
  else for (let i = 0; i < -k; i++) scale /= 2;
  return sum * scale;
}

export function log(x: number): number {
  if (x <= 0) return -Infinity;
  let e = 0;
  while (x >= 2) {
    x /= 2;
    e++;
  }
  while (x < 1) {
    x *= 2;
    e--;
  }
  // log(m) = 2 atanh((m-1)/(m+1)), m in [1, 2)
  const t = (x - 1) / (x + 1);
  const t2 = t * t;
  let term = t;
  let sum = 0;
  for (let i = 1; i < 40; i += 2) {
    sum += term / i;
    term *= t2;
  }
  return 2 * sum + e * LN2;
}

export function pow(b: number, p: number): number {
  if (b === 0) return p === 0 ? 1 : 0;
  return exp(p * log(b));
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
