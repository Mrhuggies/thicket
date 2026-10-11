// Simulation worker: runs the world live, owns the action log, checkpoints, rewind,
// daily stats, scrub keyframes and inspect data. Wall-clock time is used only for pacing.

import { World, LogEvent } from './world';
import { CHECKPOINT_TICKS, ENGINE_VERSION, MAX_LINEAGES, N_CAUSES, N_TRAITS, TICKS_PER_DAY } from './constants';
import { ACTION_NAMES, N_ACTIONS, N_SPECIES, SPECIES } from './species';
import { describeState } from './brain';
import { InstinctSet, parseInstinct } from './instinct';
import { animalName } from './names';
import type { FromWorker, InspectInfo, NewWorld, StatsRow, ToWorker } from './protocol';
import { Bit, F_STRIDE, U_STRIDE } from './protocol';

const post = (m: FromWorker, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

let world: World | null = null;
let spec: NewWorld | null = null;
let instinct: InstinctSet | undefined;
let log: LogEvent[] = [];
let checkpoints = new Map<number, Promise<Uint8Array>>();
let keyframes = new Map<number, { n: number; f: Float32Array; u: Uint32Array }>();
let rows: StatsRow[] = [];
let marks: { tick: number; kind: string; sp: number }[] = [];
let head = 0;
let speed = 24;
let busy = false;
let selected = 0;
let lastInspect: InspectInfo | null = null;
let fearLayer = false;
let lastGrassPost = 0;
let sentTrees = -1;
let sentWater = 0;
let acc = 0;
let lastLoop = 0;
let measured = { tps: 0, ms: 0 };
let pendingEvents: { tick: number; kind: any; sp: number; v?: number }[] = [];

async function loadInstinct(): Promise<void> {
  try {
    const r = await fetch('/brains/instinct.bin');
    if (r.ok) instinct = parseInstinct(await r.arrayBuffer(), N_SPECIES);
  } catch {
    instinct = undefined;
  }
}

async function gzip(buf: ArrayBuffer): Promise<Uint8Array> {
  const stream = new Blob([buf]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(u8: Uint8Array): Promise<ArrayBuffer> {
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

function checkpoint(): void {
  const w = world!;
  if (checkpoints.has(w.tick)) return;
  checkpoints.set(w.tick, gzip(w.snapshot()));
  // thin old checkpoints: after the first year keep one per 4 weeks
  if (checkpoints.size > 40) {
    for (const t of [...checkpoints.keys()]) {
      if (t !== 0 && w.tick - t > 112 * TICKS_PER_DAY && t % (CHECKPOINT_TICKS * 4) !== 0) checkpoints.delete(t);
    }
  }
}

function eventsAt(tick: number): LogEvent[] | undefined {
  let out: LogEvent[] | undefined;
  for (const e of log) if (e.tick === tick) (out ??= []).push(e);
  return out;
}

function stepOnce(): void {
  const w = world!;
  w.step(eventsAt(w.tick));
  for (const e of w.events) {
    pendingEvents.push(e);
    if (w.tick > head && (e.kind === 'extinct' || e.kind === 'ceiling' || e.kind === 'fire' || e.kind === 'outbreak')) marks.push({ tick: e.tick, kind: e.kind, sp: e.sp });
  }
  if (w.tick > head) head = w.tick;
  if (w.tick % TICKS_PER_DAY === 0) {
    const day = w.tick / TICKS_PER_DAY;
    if (!rows[day]) statsRow(day);
    if (!keyframes.has(day)) keyframes.set(day, packAgents());
  }
  if (w.tick % CHECKPOINT_TICKS === 0) checkpoint();
  if (spec?.verify && w.tick === spec.verify.tick) {
    const got = w.hash();
    post({ type: 'verify', ok: got === spec.verify.hash, tick: w.tick, expected: spec.verify.hash, got });
  }
}

function statsRow(day: number): void {
  const w = world!;
  let g = 0;
  for (let c = 0; c < w.n; c++) g += w.grass[c];
  const cumB = Array.from(w.dayBirths);
  const cumD = Array.from(w.dayDeaths);
  const prev = rows[day - 1] as (StatsRow & { cumB: number[]; cumD: number[] }) | undefined;
  const linMembers: number[] = [];
  const linReward: number[] = [];
  const linHue: number[] = [];
  for (let sp = 0; sp < N_SPECIES; sp++) {
    for (let l = 0; l < MAX_LINEAGES; l++) {
      const k = sp * MAX_LINEAGES + l;
      const live = !!w.brains.lin[sp][l];
      linMembers.push(live ? w.brains.members[k] : 0);
      linReward.push(live && w.brains.rewardN[k] > 0 ? w.brains.rewardSum[k] / w.brains.rewardN[k] : 0);
      linHue.push(live ? w.brains.hue[k] : -1);
    }
  }
  const traits = new Array(N_SPECIES * N_TRAITS).fill(0);
  const tc = new Array(N_SPECIES).fill(0);
  for (let i = 0; i < w.hw; i++) {
    if (!w.alive[i]) continue;
    const sp = w.sp[i];
    tc[sp]++;
    for (let t = 0; t < N_TRAITS; t++) traits[sp * N_TRAITS + t] += w.traits[i * N_TRAITS + t];
  }
  for (let sp = 0; sp < N_SPECIES; sp++) for (let t = 0; t < N_TRAITS; t++) traits[sp * N_TRAITS + t] = tc[sp] ? traits[sp * N_TRAITS + t] / tc[sp] : NaN;
  const row = {
    day,
    linMembers,
    linReward,
    linHue,
    traits,
    counts: Array.from(w.counts),
    births: cumB.map((v, k) => v - (prev ? prev.cumB[k] : 0)),
    deaths: cumD.map((v, k) => v - (prev ? prev.cumD[k] : 0)),
    grass: g / w.n,
    cumB,
    cumD,
  };
  rows[day] = row;
  post({ type: 'stats', rows: [row], reset: false });
}

function packAgents(): { n: number; f: Float32Array; u: Uint32Array } {
  const w = world!;
  let n = 0;
  for (let i = 0; i < w.hw; i++) if (w.alive[i] && w.dormant[i] !== 2) n++;
  const f = new Float32Array(n * F_STRIDE);
  const u = new Uint32Array(n * U_STRIDE);
  let k = 0;
  for (let i = 0; i < w.hw; i++) {
    if (!w.alive[i] || w.dormant[i] === 2) continue; // migrants are off the map
    const s = w.sp[i];
    f[k * F_STRIDE] = w.x[i];
    f[k * F_STRIDE + 1] = w.y[i];
    f[k * F_STRIDE + 2] = w.hx[i];
    f[k * F_STRIDE + 3] = w.hy[i];
    u[k * U_STRIDE] = w.aid[i];
    let bits = s | (w.act[i] << 5) | (w.lin[i] << 12);
    if (w.shel[i] === 1 || w.dormant[i] === 1) bits |= Bit.Shel; // underground, or sleeping out the winter
    if (w.sick[i]) bits |= Bit.Sick;
    if (w.explored[i]) bits |= Bit.Explored;
    if (w.sex[i]) bits |= Bit.Female;
    if (w.age[i] < SPECIES[s].maturityDays * TICKS_PER_DAY) bits |= Bit.Juvenile;
    if (w.stam[i] < 0.25) bits |= Bit.Winded;
    u[k * U_STRIDE + 1] = bits;
    k++;
  }
  return { n, f, u };
}

function postFrame(): void {
  const w = world!;
  const { n, f, u } = packAgents();
  const carc: number[] = [];
  for (let k = 0; k < w.cTop; k++) if (w.cmass[k] > 0.05) carc.push(w.cx[k], w.cy[k], w.cmass[k], w.csp[k]);
  const war: number[] = [];
  for (let k = 0; k < w.wCount; k++) if (w.wAlive[k]) war.push(w.wx[k], w.wy[k], w.wSp[k]);
  const lineages: { sp: number; slot: number; members: number; hue: number; reward: number; founded: number }[] = [];
  for (let s = 0; s < N_SPECIES; s++) {
    for (let l = 0; l < MAX_LINEAGES; l++) {
      if (!w.brains.lin[s][l]) continue;
      const k = s * MAX_LINEAGES + l;
      const rn = w.brains.rewardN[k];
      lineages.push({ sp: s, slot: l, members: w.brains.members[k], hue: w.brains.hue[k], reward: rn > 0 ? w.brains.rewardSum[k] / rn : 0, founded: w.brains.founded[k] });
    }
  }
  const carcasses = new Float32Array(carc);
  const warrens = new Float32Array(war);
  const fire = Int32Array.from(w.fireCells);
  let oaks = 0;
  for (let k = 0; k < w.trCount; k++) if (w.trAlive[k] && w.trStage[k] === 2 && w.trKind[k] === 0) oaks++;
  const sick = new Array(N_SPECIES).fill(0);
  for (let i = 0; i < w.hw; i++) if (w.alive[i] && w.sick[i]) sick[w.sp[i]]++;
  const damList: number[] = [];
  for (let k = 0; k < w.damCount; k++) if (w.damAlive[k]) damList.push(w.damX[k], w.damY[k], w.damHp[k]);
  const dams = new Float32Array(damList);
  if (w.waterVersion !== sentWater) {
    sentWater = w.waterVersion;
    const tt = new Uint8Array(w.t.type);
    const dd = new Float32Array(w.t.depth);
    post({ type: 'terrain', ttype: tt, depth: dd }, [tt.buffer, dd.buffer]);
  }
  let trees: Float32Array | undefined;
  if (w.treeVersion !== sentTrees) {
    sentTrees = w.treeVersion;
    const tr: number[] = [];
    for (let k = 0; k < w.trCount; k++) if (w.trAlive[k] && w.trStage[k] > 0) tr.push(w.trX[k], w.trY[k], w.trKind[k], w.trStage[k]);
    trees = new Float32Array(tr);
  }
  post(
    {
      type: 'frame', tick: w.tick, head, n, f, u,
      counts: Array.from(w.counts), actions: Array.from(w.actionCounts),
      carcasses, warrens, trees, fire, dams, oaks, sick, weather: w.weather, wind: [w.windX, w.windY, w.windStrength], tps: measured.tps, msPerTick: measured.ms, ceiling: w.ceilingHit, lineages,
    },
    trees ? [f.buffer, u.buffer, carcasses.buffer, warrens.buffer, fire.buffer, trees.buffer] : [f.buffer, u.buffer, carcasses.buffer, warrens.buffer, fire.buffer],
  );
  if (pendingEvents.length) {
    post({ type: 'events', events: pendingEvents });
    pendingEvents = [];
  }
  const now = performance.now();
  if (now - lastGrassPost > 250) {
    lastGrassPost = now;
    const g = new Uint8Array(w.n);
    for (let c = 0; c < w.n; c++) g[c] = Math.min(255, w.grass[c] * 255);
    let fear: Uint8Array | undefined;
    if (fearLayer) {
      fear = new Uint8Array(w.n);
      for (let c = 0; c < w.n; c++) fear[c] = Math.min(255, w.fear[c] * 255);
    }
    const scar = new Uint8Array(w.n);
    const wall = new Uint8Array(w.n);
    for (let c = 0; c < w.n; c++) {
      scar[c] = Math.min(255, w.scar[c] * 4);
      wall[c] = w.wall[c];
    }
    let toxin: Uint8Array | null = null;
    if (w.toxinActive) {
      toxin = new Uint8Array(w.n);
      for (let c = 0; c < w.n; c++) toxin[c] = Math.min(255, w.toxin[c] * 255);
    }
    const tr: Transferable[] = [g.buffer, scar.buffer, wall.buffer];
    if (fear) tr.push(fear.buffer);
    if (toxin) tr.push(toxin.buffer);
    post({ type: 'grass', data: g, fear, scar, wall, toxin }, tr);
  }
  if (selected) postInspect();
}

function why(def: (typeof SPECIES)[number], state: string[], q: number[], chosen: number, explored: boolean): string {
  const name = ACTION_NAMES[def.actions[chosen]];
  const boring = new Set(['fed', 'watered', 'safe', 'space', 'not ready to breed', 'no carrion', 'no prey', 'ready to hunt', 'little food', 'no vultures circling']);
  const salient = state.filter((s) => !boring.has(s)).slice(0, 3);
  const ctx = salient.length ? salient.join(', ') : 'nothing pressing';
  if (explored) return `${name}, trying something at random (exploring). Felt: ${ctx}.`;
  let second = -1;
  for (let a = 0; a < q.length; a++) if (a !== chosen && (second < 0 || q[a] > q[second])) second = a;
  const alt = second >= 0 ? ` ${name} ${q[chosen].toFixed(2)} beat ${ACTION_NAMES[def.actions[second]]} ${q[second].toFixed(2)}.` : '';
  return `${name}: ${ctx}.${alt}`;
}

function postInspect(): void {
  const w = world!;
  let i = -1;
  for (let k = 0; k < w.hw; k++) if (w.alive[k] && w.aid[k] === selected) {
    i = k;
    break;
  }
  if (i < 0) {
    if (lastInspect && lastInspect.alive) {
      lastInspect = { ...lastInspect, alive: false, diedTick: w.tick };
    }
    post({ type: 'inspect', info: lastInspect });
    return;
  }
  const s = w.sp[i];
  const def = SPECIES[s];
  const lin = w.brains.lin[s][w.lin[i]];
  const nA = def.actions.length;
  const q: number[] = [];
  for (let a = 0; a < nA; a++) q.push(lin ? lin.q[w.st[i] * nA + a] : 0);
  const state = describeState(def.encoding, w.st[i]);
  const chosen = def.actions.indexOf(w.act[i] as never);
  const traits = Array.from(w.traits.subarray(i * N_TRAITS, i * N_TRAITS + N_TRAITS));
  const means = new Array(N_TRAITS).fill(0);
  let cnt = 0;
  for (let k = 0; k < w.hw; k++) if (w.alive[k] && w.sp[k] === s) {
    for (let t = 0; t < N_TRAITS; t++) means[t] += w.traits[k * N_TRAITS + t];
    cnt++;
  }
  for (let t = 0; t < N_TRAITS; t++) means[t] /= Math.max(1, cnt);
  const entries: { tick: number; code: number }[] = [];
  for (let k = 0; k < 8; k++) {
    const idx = (w.logHead[i] + 7 - k) % 8;
    const code = w.logE[i * 8 + idx];
    if (code) entries.push({ tick: w.logT[i * 8 + idx], code });
  }
  lastInspect = {
    id: selected, alive: true, sp: s, name: animalName(selected), age: w.age[i] / TICKS_PER_DAY, sex: w.sex[i],
    lineage: w.lin[i], hue: w.brains.hue[s * MAX_LINEAGES + w.lin[i]], mother: w.mother[i],
    energy: w.energy[i], hydration: w.hyd[i], health: w.health[i], stamina: w.stam[i],
    action: w.act[i], explored: !!w.explored[i], state, q, actions: def.actions.slice(),
    why: why(def, state, q, chosen, !!w.explored[i]), traits, traitMeans: means, log: entries,
    kills: w.kills[i], x: w.x[i], y: w.y[i],
    sickWith: w.sick[i] ? ['', 'rabbit plague', 'mange', 'bird flu'][w.path[i]] ?? 'illness' : '',
    dormant: w.dormant[i],
  };
  post({ type: 'inspect', info: lastInspect });
}

function branchHere(): void {
  const w = world!;
  if (w.tick >= head) return;
  log = log.filter((e) => e.tick < w.tick);
  for (const t of [...checkpoints.keys()]) if (t > w.tick) checkpoints.delete(t);
  const day = Math.floor(w.tick / TICKS_PER_DAY);
  for (const d of [...keyframes.keys()]) if (d > day) keyframes.delete(d);
  rows.length = day + 1;
  marks = marks.filter((m) => m.tick <= w.tick);
  head = w.tick;
  post({ type: 'stats', rows: rows.filter(Boolean), reset: true });
  post({ type: 'marks', marks });
}

async function seek(tick: number): Promise<void> {
  if (!world) return;
  busy = true;
  const target = Math.max(0, Math.min(head, Math.round(tick)));
  post({ type: 'seeking', busy: true, tick: target });
  let best = 0;
  for (const t of checkpoints.keys()) if (t <= target && t > best) best = t;
  if (!(world.tick <= target && world.tick >= best)) {
    const buf = await gunzip(await checkpoints.get(best)!);
    world.restore(buf);
  }
  while (world.tick < target) stepOnce();
  pendingEvents = [];
  busy = false;
  post({ type: 'seeking', busy: false, tick: world.tick });
  sentTrees = -1;
  sentWater = -1;
  postFrame();
}

async function newWorld(nw: NewWorld): Promise<void> {
  busy = true;
  if (instinct === undefined) await loadInstinct();
  spec = nw;
  world = new World({ seed: nw.seed, preset: nw.preset, instinct: nw.instinct, w: 384, h: 216 }, instinct);
  log = nw.log ? nw.log.slice().sort((a, b) => a.tick - b.tick) : [];
  checkpoints = new Map();
  keyframes = new Map();
  rows = [];
  marks = log.map((e) => ({ tick: e.tick, kind: e.tool, sp: e.a[0] ?? -1 }));
  head = 0;
  selected = 0;
  lastInspect = null;
  pendingEvents = [];
  checkpoint();
  statsRow(0);
  keyframes.set(0, packAgents());
  busy = false;
  post({ type: 'ready', w: world.w, h: world.h, seed: nw.seed, preset: nw.preset, instinct: nw.instinct });
  post({ type: 'stats', rows: rows.filter(Boolean), reset: true });
  post({ type: 'marks', marks });
  lastGrassPost = 0;
  sentTrees = -1;
  sentWater = 0;
  postFrame();
}

function loop(): void {
  const now = performance.now();
  const dt = Math.min(0.25, (now - lastLoop) / 1000);
  lastLoop = now;
  if (world && !busy) {
    let due = 0;
    if (speed < 0) due = 1e9;
    else if (speed > 0) {
      acc += dt * speed;
      due = Math.floor(acc);
      acc -= due;
    }
    const t0 = performance.now();
    let ran = 0;
    while (ran < due && performance.now() - t0 < 14) {
      stepOnce();
      ran++;
    }
    if (ran < due && speed > 0) acc = 0; // drop backlog rather than spiral
    if (ran > 0) {
      const el = performance.now() - t0;
      measured.ms = measured.ms * 0.9 + (el / ran) * 0.1;
      measured.tps = measured.tps * 0.8 + (ran / Math.max(dt, 0.001)) * 0.2;
      postFrame();
    }
  }
  setTimeout(loop, speed < 0 ? 0 : 6);
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  switch (m.type) {
    case 'new':
      void newWorld(m.world);
      break;
    case 'speed':
      speed = m.tps;
      acc = 0;
      break;
    case 'step':
      if (world && !busy) {
        for (let k = 0; k < m.ticks; k++) stepOnce();
        postFrame();
      }
      break;
    case 'act': {
      if (!world || busy) break;
      branchHere();
      const e: LogEvent = { tick: world.tick, tool: m.tool, a: m.a.map((v) => Math.round(v)) };
      log.push(e);
      marks.push({ tick: e.tick, kind: e.tool, sp: e.a[0] });
      post({ type: 'marks', marks });
      if (speed === 0) {
        stepOnce();
        postFrame();
      }
      break;
    }
    case 'seek':
      void seek(m.tick);
      break;
    case 'preview': {
      const k = keyframes.get(m.day);
      if (k) post({ type: 'preview', day: m.day, n: k.n, f: k.f.slice(), u: k.u.slice() });
      break;
    }
    case 'select':
      selected = m.id;
      lastInspect = null;
      if (world && selected) postInspect();
      else post({ type: 'inspect', info: null });
      break;
    case 'layers':
      fearLayer = m.fear;
      lastGrassPost = 0;
      break;
    case 'share':
      if (world && spec) {
        post({ type: 'share', purpose: m.purpose, payload: { v: ENGINE_VERSION, preset: spec.preset, seed: spec.seed, instinct: spec.instinct, log: log.filter((e) => e.tick < world!.tick), tick: world.tick, hash: world.hash() } });
      }
      break;
  }
};

lastLoop = performance.now();
loop();

export {};
void N_ACTIONS;
void N_CAUSES;
