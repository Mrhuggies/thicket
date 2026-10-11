// Share links: the whole world in the URL fragment (never sent to a server).
// #v1.<preset>.<seed>.<instinct>.<tick>.<hash>.<log>
// log = base64url(deflate-raw(varints: tickDelta, tool, nParams, zigzag params…))

import type { SharePayload } from '../sim/protocol';
import type { LogEvent } from '../sim/world';
import type { Preset } from '../sim/terrain';
import type { Instinct } from '../sim/brain';

const TOOLS = ['', 'release', 'cull', 'ignite', 'rain', 'drought', 'poison', 'pesticide', 'plant', 'dam', 'breach', 'outbreak', 'wall', 'food'];

function pushVar(out: number[], v: number): void {
  v >>>= 0;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v);
}

function zig(v: number): number {
  return ((v << 1) ^ (v >> 31)) >>> 0;
}
function unzig(v: number): number {
  return (v >>> 1) ^ -(v & 1);
}

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const s = new Blob([data]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(s).arrayBuffer());
}

function b64url(u8: Uint8Array): string {
  let s = '';
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u;
}

export async function encodeShare(p: SharePayload): Promise<string> {
  let logPart = '';
  if (p.log.length) {
    const out: number[] = [];
    let last = 0;
    for (const e of p.log) {
      pushVar(out, e.tick - last);
      last = e.tick;
      pushVar(out, Math.max(0, TOOLS.indexOf(e.tool)));
      pushVar(out, e.a.length);
      for (const v of e.a) pushVar(out, zig(v));
    }
    logPart = b64url(await pipe(new Uint8Array(out), new CompressionStream('deflate-raw')));
  }
  return `#v${p.v}.${p.preset}.${p.seed}.${p.instinct}.${p.tick}.${p.hash}.${logPart}`;
}

export async function decodeShare(hash: string): Promise<SharePayload | null> {
  const m = /^#v(\d+)\.(\w+)\.(\d+)\.(\w+)\.(\d+)\.([0-9a-f]+)\.([A-Za-z0-9_-]*)$/.exec(hash);
  if (!m) return null;
  const log: LogEvent[] = [];
  if (m[7]) {
    const u = await pipe(unb64url(m[7]), new DecompressionStream('deflate-raw'));
    let i = 0;
    const read = () => {
      let v = 0;
      let shift = 0;
      for (;;) {
        const b = u[i++];
        v |= (b & 0x7f) << shift;
        if (b < 0x80) break;
        shift += 7;
      }
      return v >>> 0;
    };
    let tick = 0;
    while (i < u.length) {
      tick += read();
      const tool = TOOLS[read()] ?? '';
      const n = read();
      const a: number[] = [];
      for (let k = 0; k < n; k++) a.push(unzig(read()));
      log.push({ tick, tool, a });
    }
  }
  return { v: Number(m[1]), preset: m[2] as Preset, seed: Number(m[3]), instinct: m[4] as Instinct, tick: Number(m[5]), hash: m[6], log };
}
