// Instinct tables: per species, a "wild" (part-trained) and an "expert" Q-table.
// File format: u32 count, then per entry: u32 species, u32 length, f32[length] wild, f32[length] expert.

export type InstinctSet = Map<number, { wild: Float32Array; expert: Float32Array }>;

export function parseInstinct(buf: ArrayBuffer, _nSpecies: number): InstinctSet {
  const dv = new DataView(buf);
  const out: InstinctSet = new Map();
  let off = 0;
  const n = dv.getUint32(off, true);
  off += 4;
  for (let k = 0; k < n; k++) {
    const sp = dv.getUint32(off, true);
    const len = dv.getUint32(off + 4, true);
    off += 8;
    const wild = new Float32Array(buf.slice(off, off + len * 4));
    off += len * 4;
    const expert = new Float32Array(buf.slice(off, off + len * 4));
    off += len * 4;
    out.set(sp, { wild, expert });
  }
  return out;
}

export function packInstinct(set: InstinctSet): ArrayBuffer {
  let size = 4;
  for (const [, v] of set) size += 8 + v.wild.byteLength + v.expert.byteLength;
  const buf = new ArrayBuffer(size);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let off = 0;
  dv.setUint32(off, set.size, true);
  off += 4;
  for (const [sp, v] of set) {
    dv.setUint32(off, sp, true);
    dv.setUint32(off + 4, v.wild.length, true);
    off += 8;
    u8.set(new Uint8Array(v.wild.buffer, v.wild.byteOffset, v.wild.byteLength), off);
    off += v.wild.byteLength;
    u8.set(new Uint8Array(v.expert.buffer, v.expert.byteOffset, v.expert.byteLength), off);
    off += v.expert.byteLength;
  }
  return buf;
}
