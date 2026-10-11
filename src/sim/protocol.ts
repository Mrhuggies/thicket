// Messages between the UI thread and the simulation worker.

import type { LogEvent, SimEvent } from './world';
import type { Instinct } from './brain';
import type { Preset } from './terrain';

export interface NewWorld {
  seed: number;
  preset: Preset;
  instinct: Instinct;
  log?: LogEvent[];
  /** Expected state hash at a tick, from a share link. */
  verify?: { tick: number; hash: string };
}

export type ToWorker =
  | { type: 'new'; world: NewWorld }
  | { type: 'speed'; tps: number } // ticks per second; 0 = paused, -1 = max
  | { type: 'step'; ticks: number }
  | { type: 'act'; tool: string; a: number[] }
  | { type: 'seek'; tick: number }
  | { type: 'preview'; day: number }
  | { type: 'select'; id: number }
  | { type: 'layers'; fear: boolean }
  | { type: 'share'; purpose?: 'twin' };

/** Per-animal render record. f32: x, y, hx, hy. u32: id, packed bits. */
export const F_STRIDE = 4;
export const U_STRIDE = 2;
// packed bits: species 0-4, action 5-8, sheltered 9, sick 10, explored 11, lineage 12-14, sex 15, juvenile 16, winded 17
export const enum Bit {
  Shel = 1 << 9,
  Sick = 1 << 10,
  Explored = 1 << 11,
  Female = 1 << 15,
  Juvenile = 1 << 16,
  Winded = 1 << 17,
}

export interface Frame {
  type: 'frame';
  tick: number;
  head: number; // furthest tick simulated on this branch
  n: number;
  f: Float32Array;
  u: Uint32Array;
  counts: number[];
  actions: number[]; // species × action counts this tick
  carcasses: Float32Array; // x, y, mass, species
  warrens: Float32Array; // x, y, species
  trees?: Float32Array; // x, y, kind, stage — only when the trees changed
  fire: Int32Array; // burning cells
  dams: Float32Array; // x, y, hp
  oaks: number; // mature oaks
  sick: number[]; // sick animals per species
  weather: number;
  wind: [number, number, number];
  tps: number; // measured ticks per second
  msPerTick: number;
  ceiling: boolean;
  lineages: { sp: number; slot: number; members: number; hue: number; reward: number; founded: number }[];
}

export interface StatsRow {
  day: number;
  counts: number[];
  births: number[];
  deaths: number[]; // species × cause
  grass: number;
  /** species × 6 bloodline slots: members, average reward per hour, hue (−1 when empty) */
  linMembers: number[];
  linReward: number[];
  linHue: number[];
  /** species × 7 trait means */
  traits: number[];
}

export interface InspectInfo {
  id: number;
  alive: boolean;
  sp: number;
  name: string;
  age: number; // days
  sex: number;
  lineage: number;
  hue: number;
  mother: number;
  energy: number;
  hydration: number;
  health: number;
  stamina: number;
  action: number;
  explored: boolean;
  state: string[];
  q: number[]; // per allowed action
  actions: number[];
  why: string;
  traits: number[];
  traitMeans: number[];
  log: { tick: number; code: number }[];
  kills: number;
  sickWith: string;
  dormant: number;
  x: number;
  y: number;
  diedTick?: number;
}

export type FromWorker =
  | Frame
  | { type: 'ready'; w: number; h: number; seed: number; preset: Preset; instinct: Instinct }
  | { type: 'terrain'; ttype: Uint8Array; depth: Float32Array }
  | { type: 'grass'; data: Uint8Array; fear?: Uint8Array; scar: Uint8Array; wall: Uint8Array; toxin: Uint8Array | null }
  | { type: 'stats'; rows: StatsRow[]; reset: boolean }
  | { type: 'events'; events: SimEvent[] }
  | { type: 'inspect'; info: InspectInfo | null }
  | { type: 'preview'; day: number; n: number; f: Float32Array; u: Uint32Array }
  | { type: 'seeking'; busy: boolean; tick?: number }
  | { type: 'share'; payload: SharePayload; purpose?: 'twin' }
  | { type: 'verify'; ok: boolean; tick: number; expected: string; got: string }
  | { type: 'marks'; marks: { tick: number; kind: string; sp: number }[] };

export interface SharePayload {
  v: number;
  preset: Preset;
  seed: number;
  instinct: Instinct;
  log: LogEvent[];
  tick: number;
  hash: string;
}
