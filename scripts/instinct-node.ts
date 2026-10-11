import { existsSync, readFileSync } from 'node:fs';
import { SPECIES } from '../src/sim/species';
import { parseInstinct } from '../src/sim/instinct';

/** Load shipped instinct tables from public/brains, if they exist. */
export function loadInstinctNode(dir = 'public/brains') {
  const file = `${dir}/instinct.bin`;
  if (!existsSync(file)) return undefined;
  const buf = readFileSync(file);
  return parseInstinct(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), SPECIES.length);
}
