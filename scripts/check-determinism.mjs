// Lint for the deterministic engine: bans sources of cross-machine drift inside src/sim.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const banned = [
  [/Math\.random\s*\(/, 'Math.random — use an Rng stream'],
  [/Math\.(sin|cos|tan|exp|log|log2|log10|pow|atan|atan2|asin|acos|hypot|cbrt)\s*\(/, 'transcendental Math — use detmath'],
  [/\bDate\b/, 'Date — simulation time is the tick'],
  [/performance\.now/, 'performance.now — wall-clock time'],
  [/for\s*\(\s*(const|let|var)\s+\w+\s+in\s/, 'for…in — key order is not simulation state'],
];
const dir = 'src/sim';
let bad = 0;
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.ts') || f === 'worker.ts' || f === 'detmath.ts') continue;
  const lines = readFileSync(join(dir, f), 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (line.trim().startsWith('//')) return;
    for (const [re, why] of banned) if (re.test(line)) {
      console.log(`${dir}/${f}:${i + 1}  ${why}\n    ${line.trim()}`);
      bad++;
    }
  });
}
if (bad) {
  console.log(`\n${bad} determinism violation(s)`);
  process.exit(1);
}
console.log('determinism lint: clean');
