// The deterministic engine. One tick = one hour. Order inside a tick is fixed:
// events → environment → fields → spatial hash → think (all) → move (all) →
// resolve (seeded shuffle) → upkeep, deaths, births → daily bookkeeping.

import {
  BUCKET, CAPACITY, Cause, Cell, MAX_DAMS, MAX_TREES, Stage, DAYS_PER_SEASON, DAYS_PER_YEAR, GAMMA, LOG_LEN, MAX_CARCASSES,
  MAX_LINEAGES, MAX_WARRENS, N_CAUSES, N_STEP, N_TRAITS, PERF_CEILING, TICKS_PER_DAY, TRAIT_RANGES, Trait,
} from './constants';
import { Rng } from './rng';
import { clamp, sin } from './detmath';
import { Act, ACTION_SLOT, CROWD_K, Food, HUNTS, N_ACTIONS, N_SPECIES, SPECIES, SPRINT, Sp, SpeciesDef, TUNE } from './species';
import { Brains, encode, Instinct, Lineage } from './brain';
import { generateTerrain, Preset, Terrain } from './terrain';
import { buildDam, dailyDams, isChannel, nearestDam, nearestWillow } from './beavers';
import { addTree, dailyTrees, nearestTree, plantInitialTrees, reindexTrees, removeTree, slowFields } from './ecology';
import { dailyDisease, dailyWeather, fireDanger, ignite, infect, reindexFire, scarDaily, spread, stepFire, stepToxin, weatherGrowMul, weatherMetabMul, weatherThirstMul, Weather, PATHOGENS, HOST } from './hazards';

export interface WorldConfig {
  seed: number;
  preset: Preset;
  instinct: Instinct;
  w: number;
  h: number;
  /** Species placed at the start; defaults to every enabled species. */
  species?: number[];
  /** 'rules' swaps learned brains for a fixed hand-written policy (a control for tests). */
  policy?: 'learned' | 'rules';
}

export interface LogEvent {
  tick: number;
  tool: string;
  a: number[];
}

/** Things worth narrating, emitted by the engine as they happen. */
export interface SimEvent {
  tick: number;
  kind: 'extinct' | 'birth-first' | 'outbreak' | 'fire' | 'lineage' | 'ceiling' | 'dam' | 'dam-break';
  sp: number;
  v?: number;
}

export const enum LogCode {
  Born = 1, Ate, Drank, Fled, Escaped, Killed, Mated, GaveBirth, Dug, Called, Sheltered, Scavenged, Sick,
}
export const LOG_NAMES = ['', 'born', 'ate well', 'drank', 'fled', 'escaped an attack', 'made a kill', 'mated', 'gave birth', 'dug a warren', 'raised the alarm', 'took shelter', 'scavenged', 'fell sick'];

type TA = Float32Array | Float64Array | Uint8Array | Int8Array | Uint16Array | Int16Array | Uint32Array | Int32Array;

const C = CAPACITY;
const NS = N_SPECIES;
const IS_HUNTER = new Uint8Array(N_SPECIES);
const ECTOTHERM = new Uint8Array(N_SPECIES);
ECTOTHERM[Sp.Frog] = ECTOTHERM[Sp.Fish] = ECTOTHERM[Sp.Snake] = 1;
for (const d of SPECIES) IS_HUNTER[d.id] = d.encoding === 'predator' || d.encoding === 'pack' ? 1 : 0;

/** Hand-written reflexes from the encoded state alone. Used as the control policy in tests
 *  and as the instinct prior that learning starts from. */
export function rulesFromState(def: SpeciesDef, v: ArrayLike<number>): Act {
  const hunger = v[0];
  const thirst = v[1];
  if (def.encoding === 'prey') {
    const threat = v[2];
    const shelterNear = (def.burrows || def.swims || def.id === Sp.Squirrel) && v[4] <= 1;
    if (threat === 2 || threat === 4) return shelterNear ? Act.Shelter : threat === 4 ? Act.Freeze : Act.Flee;
    if (threat === 1 || threat === 3) return hunger >= 2 ? Act.Forage : shelterNear ? Act.Shelter : threat === 3 ? Act.Freeze : Act.Forage;
    if (thirst === 2) return Act.Drink;
    if (hunger >= 1) return Act.Forage;
    if (thirst === 1) return Act.Drink;
    if (v[6]) return Act.Mate;
    if (def.burrows && v[4] === 2) return Act.Dig;
    if (def.actions.includes(Act.Cache) && v[3] === 2) return Act.Cache;
    if (def.actions.includes(Act.Build) && hunger === 0) return Act.Build;
    return v[5] === 0 && def.active === 'day' ? Act.Rest : Act.Forage;
  }
  if (def.encoding === 'scavenger') {
    if (thirst === 2) return Act.Drink;
    if (v[2] > 0 && hunger >= 1) return Act.Scavenge;
    if (thirst === 1) return Act.Drink;
    if (v[5]) return Act.Mate;
    return v[2] > 0 ? Act.Scavenge : v[4] ? Act.Explore : Act.Rest;
  }
  if (v[4] === 2) return Act.Flee;
  if (thirst === 2) return Act.Drink;
  const day = v[5] === 1;
  const offShift = (def.active === 'day' && !day) || (def.active === 'night' && day);
  if (offShift && hunger < 3) return Act.Rest;
  if (hunger >= 1) {
    if (v[7] && v[2] < 2 && def.actions.includes(Act.Scavenge)) return Act.Scavenge;
    if (def.actions.includes(Act.Forage) && (v[2] < 3 || hunger < 2)) return Act.Forage;
    if (def.actions.includes(Act.Ambush) && v[2] < 3) return Act.Ambush;
    return Act.Hunt;
  }
  if (thirst === 1) return Act.Drink;
  if (v[6]) return Act.Mate;
  return Act.Rest;
}

export class World {
  readonly cfg: WorldConfig;
  readonly w: number;
  readonly h: number;
  readonly n: number;
  readonly t: Terrain;
  readonly gw: number;
  readonly gh: number;

  tick = 0;
  nextId = 1;
  nextPack = 1;
  hw = 0; // high-water slot
  freeTop = 0;

  rThink: Rng;
  rMove: Rng;
  rRes: Rng;
  rLife: Rng;
  rBrain: Rng;
  rEnv: Rng;

  brains = new Brains();
  events: SimEvent[] = [];

  // environment (derived each tick)
  isDay = true;
  dayLen = 12;
  season = 0;
  doy = 0;
  warmth = 0; // -1 deep winter … 1 high summer
  growMul = 1;
  metabMul = 1;

  private agentArrays: { name: string; arr: TA; stride: number }[] = [];
  private fullArrays: { name: string; arr: TA }[] = [];

  private A<T extends TA>(name: string, arr: T, stride = 1): T {
    this.agentArrays.push({ name, arr, stride });
    return arr;
  }
  private F<T extends TA>(name: string, arr: T): T {
    this.fullArrays.push({ name, arr });
    return arr;
  }

  // ---- agents (structure of arrays) ----
  alive = this.A('alive', new Uint8Array(C));
  sp = this.A('sp', new Uint8Array(C));
  aid = this.A('aid', new Uint32Array(C));
  x = this.A('x', new Float32Array(C));
  y = this.A('y', new Float32Array(C));
  hx = this.A('hx', new Float32Array(C));
  hy = this.A('hy', new Float32Array(C));
  energy = this.A('energy', new Float32Array(C));
  hyd = this.A('hyd', new Float32Array(C));
  health = this.A('health', new Float32Array(C));
  age = this.A('age', new Uint32Array(C));
  sex = this.A('sex', new Uint8Array(C));
  lin = this.A('lin', new Uint8Array(C));
  act = this.A('act', new Uint8Array(C));
  st = this.A('st', new Uint32Array(C));
  explored = this.A('explored', new Uint8Array(C));
  tgt = this.A('tgt', new Int32Array(C));
  tgtId = this.A('tgtId', new Uint32Array(C));
  mate = this.A('mate', new Int32Array(C));
  gx = this.A('gx', new Float32Array(C));
  gy = this.A('gy', new Float32Array(C));
  gtimer = this.A('gtimer', new Uint16Array(C));
  home = this.A('home', new Int32Array(C));
  shel = this.A('shel', new Uint8Array(C));
  cool = this.A('cool', new Uint16Array(C)); // breeding cooldown
  hcool = this.A('hcool', new Uint16Array(C)); // recovery after a chase
  gest = this.A('gest', new Uint16Array(C));
  alarm = this.A('alarm', new Uint8Array(C));
  alarmAir = this.A('alarmAir', new Uint8Array(C));
  sick = this.A('sick', new Uint16Array(C));
  rew = this.A('rew', new Float32Array(C));
  traits = this.A('traits', new Float32Array(C * N_TRAITS), N_TRAITS);
  ftraits = this.A('ftraits', new Float32Array(C * N_TRAITS), N_TRAITS);
  mother = this.A('mother', new Uint32Array(C));
  kills = this.A('kills', new Uint16Array(C));
  born = this.A('born', new Uint32Array(C));
  histS = this.A('histS', new Uint32Array(C * N_STEP), N_STEP);
  histA = this.A('histA', new Uint8Array(C * N_STEP), N_STEP);
  histR = this.A('histR', new Float32Array(C * N_STEP), N_STEP);
  histLen = this.A('histLen', new Uint8Array(C));
  hasPrev = this.A('hasPrev', new Uint8Array(C));
  logE = this.A('logE', new Uint8Array(C * LOG_LEN), LOG_LEN);
  logT = this.A('logT', new Uint32Array(C * LOG_LEN), LOG_LEN);
  logHead = this.A('logHead', new Uint8Array(C));
  thrX = this.A('thrX', new Float32Array(C));
  thrY = this.A('thrY', new Float32Array(C));
  thrD = this.A('thrD', new Float32Array(C));
  thrKind = this.A('thrKind', new Uint8Array(C)); // 0 none, 1 ground, 2 air
  thrClose = this.A('thrClose', new Uint8Array(C));
  preyN = this.A('preyN', new Uint16Array(C));
  crowdN = this.A('crowdN', new Uint16Array(C));
  pack = this.A('pack', new Uint16Array(C));
  carc = this.A('carc', new Int32Array(C));
  moved = this.A('moved', new Float32Array(C));
  stam = this.A('stam', new Float32Array(C));
  dormant = this.A('dormant', new Uint8Array(C)); // 1 hibernating in place, 2 migrated off the map
  carry = this.A('carry', new Uint8Array(C)); // beavers: lengths of willow carried
  path = this.A('path', new Uint8Array(C)); // pathogen while sick
  immune = this.A('immune', new Uint8Array(C)); // bit per pathogen survived
  freeList = this.A('freeList', new Int32Array(C));

  // ---- fields ----
  grass: Float32Array;
  fear: Float32Array;
  dayBirths = this.F('dayBirths', new Int32Array(NS));
  dayDeaths = this.F('dayDeaths', new Int32Array(NS * N_CAUSES));
  everSeen = this.F('everSeen', new Uint8Array(NS));
  counts = new Int32Array(NS); // derived

  // ---- warrens ----
  wx = this.F('wx', new Float32Array(MAX_WARRENS));
  wy = this.F('wy', new Float32Array(MAX_WARRENS));
  wAlive = this.F('wAlive', new Uint8Array(MAX_WARRENS));
  wSp = this.F('wSp', new Uint8Array(MAX_WARRENS));
  wIdle = this.F('wIdle', new Uint16Array(MAX_WARRENS));
  wCount = 0;
  private wDirty = true;
  private wbStart: Int32Array;
  private wbItems = new Int32Array(MAX_WARRENS);
  private ready = new Uint8Array(C);
  private wOcc = new Uint16Array(MAX_WARRENS);

  // ---- trees ----
  trX = this.F('trX', new Float32Array(MAX_TREES));
  trY = this.F('trY', new Float32Array(MAX_TREES));
  trKind = this.F('trKind', new Uint8Array(MAX_TREES));
  trStage = this.F('trStage', new Uint8Array(MAX_TREES));
  trAge = this.F('trAge', new Uint16Array(MAX_TREES));
  trLife = this.F('trLife', new Uint16Array(MAX_TREES));
  trAlive = this.F('trAlive', new Uint8Array(MAX_TREES));
  trCount = 0;
  trHint = 0;
  treeVersion = 0;
  treeAt!: Int32Array; // derived: tree index per cell
  canopy!: Uint8Array; // derived: mature canopy cover per cell

  // ---- plant and slow fields ----
  acorn!: Float32Array;
  cache!: Float32Array;
  insects!: Float32Array;
  berry!: Float32Array;
  algae!: Float32Array;
  toxin!: Float32Array;
  fire!: Uint8Array;
  scar!: Uint16Array;
  wall!: Uint8Array;
  fireCells: number[] = [];
  toxinActive = false;

  // ---- weather ----
  weather = 0;
  windX = 1;
  windY = 0;
  windStrength = 0.3;
  droughtUntil = 0;

  // ---- dams ----
  damX = this.F('damX', new Float32Array(MAX_DAMS));
  damY = this.F('damY', new Float32Array(MAX_DAMS));
  damHp = this.F('damHp', new Float32Array(MAX_DAMS));
  damAlive = this.F('damAlive', new Uint8Array(MAX_DAMS));
  damCount = 0;
  waterVersion = 0;
  pondOf!: Int16Array;
  marshAge!: Uint16Array;

  // ---- carcasses ----
  cx = this.F('cx', new Float32Array(MAX_CARCASSES));
  cy = this.F('cy', new Float32Array(MAX_CARCASSES));
  cmass = this.F('cmass', new Float32Array(MAX_CARCASSES));
  csp = this.F('csp', new Uint8Array(MAX_CARCASSES));
  cInf = this.F('cInf', new Uint8Array(MAX_CARCASSES));
  cTop = 0;

  // ---- transient ----
  private bStart: Int32Array;
  private bItems = new Int32Array(C);
  private hStart: Int32Array; // hunters only
  private hItems = new Int32Array(C);
  private cbStart: Int32Array; // carcasses
  private cbItems = new Int32Array(MAX_CARCASSES);
  private order = new Int32Array(C);
  private huntersOn = new Uint16Array(C);
  private scratch = { x: 0, y: 0 };
  private births: number[] = [];
  ceilingHit = false;
  poisoned = false;
  actionCounts = new Int32Array(NS * N_ACTIONS);
  /** Cumulative diagnostics (not part of the state hash). */
  huntTry = new Float64Array(NS);
  huntWin = new Float64Array(NS);
  killMatrix = new Float64Array(NS * NS);

  constructor(cfg: WorldConfig, instinct?: Map<number, { wild: Float32Array; expert: Float32Array }>) {
    this.cfg = cfg;
    this.w = cfg.w;
    this.h = cfg.h;
    this.n = cfg.w * cfg.h;
    this.t = generateTerrain(cfg.preset, cfg.seed, cfg.w, cfg.h);
    this.gw = Math.ceil(this.w / BUCKET);
    this.gh = Math.ceil(this.h / BUCKET);
    this.bStart = new Int32Array(this.gw * this.gh + 1);
    this.wbStart = new Int32Array(this.gw * this.gh + 1);
    this.hStart = new Int32Array(this.gw * this.gh + 1);
    this.cbStart = new Int32Array(this.gw * this.gh + 1);
    this.grass = this.F('grass', new Float32Array(this.n));
    this.fear = this.F('fear', new Float32Array(this.n));
    this.F('depth', this.t.depth);
    this.acorn = this.F('acorn', new Float32Array(this.n));
    this.cache = this.F('cache', new Float32Array(this.n));
    this.insects = this.F('insects', new Float32Array(this.n));
    this.berry = this.F('berry', new Float32Array(this.n));
    this.algae = this.F('algae', new Float32Array(this.n));
    this.toxin = this.F('toxin', new Float32Array(this.n));
    this.fire = this.F('fire', new Uint8Array(this.n));
    this.scar = this.F('scar', new Uint16Array(this.n));
    this.wall = this.F('wall', new Uint8Array(this.n));
    this.pondOf = this.F('pondOf', new Int16Array(this.n).fill(-1));
    this.marshAge = this.F('marshAge', new Uint16Array(this.n));
    // terrain that beavers can change
    this.F('type', this.t.type);
    this.F('moisture', this.t.moisture);
    this.F('grassCap', this.t.grassCap);
    this.F('waterDist', this.t.waterDist);
    this.F('waterDir', this.t.waterDir);
    this.treeAt = new Int32Array(this.n).fill(-1);
    this.canopy = new Uint8Array(this.n);

    this.rThink = Rng.stream(cfg.seed, 'think');
    this.rMove = Rng.stream(cfg.seed, 'move');
    this.rRes = Rng.stream(cfg.seed, 'resolve');
    this.rLife = Rng.stream(cfg.seed, 'life');
    this.rBrain = Rng.stream(cfg.seed, 'brain');
    this.rEnv = Rng.stream(cfg.seed, 'env');

    for (let i = 0; i < this.n; i++) {
      this.grass[i] = this.t.grassCap[i] * 0.85;
      this.insects[i] = this.t.type[i] === Cell.Rock ? 0 : 0.3;
      this.algae[i] = this.t.type[i] === Cell.Water ? 0.3 : 0;
    }
    this.tgt.fill(-1);
    this.mate.fill(-1);
    this.home.fill(-1);
    this.carc.fill(-1);
    this.updateEnv();
    plantInitialTrees(this);
    this.populate(instinct);
  }

  // =====================================================================
  // setup
  // =====================================================================

  private populate(instinct?: Map<number, { wild: Float32Array; expert: Float32Array }>): void {
    const list = this.cfg.species ?? SPECIES.filter((s) => s.enabled).map((s) => s.id);
    const scale = this.populationScale();
    for (const s of list) {
      const def = SPECIES[s];
      // three starting bloodlines per species
      const nLin = 3;
      let src: Lineage = this.brains.blank(s);
      const inst = instinct?.get(s);
      if (this.cfg.instinct === 'newborn') {
        // faint instincts only: clumsy, exploring animals that improve visibly
        src = this.brains.prior(s, (st) => ACTION_SLOT[s * N_ACTIONS + rulesFromState(def, st)], 0.4);
      } else {
        const q = inst ? (this.cfg.instinct === 'expert' ? inst.expert : inst.wild) : null;
        if (q && q.length === src.q.length) src.q.set(q);
        else src = this.brains.prior(s, (st) => ACTION_SLOT[s * N_ACTIONS + rulesFromState(def, st)]);
        const v = this.cfg.instinct === 'expert' ? 200 : 60;
        src.visits.fill(v);
        src.stateVisits.fill(v);
      }
      for (let l = 0; l < nLin; l++) {
        this.brains.found(s, l, src, 0, this.rBrain.int(360), () => this.rBrain.normal() * 0.05);
        if (this.cfg.instinct === 'newborn') this.brains.lin[s][l]!.visits.fill(0);
      }
      if (def.burrows) {
        const nw = Math.max(4, Math.round((def.start * scale) / (s === Sp.Mouse ? 12 : 7)));
        for (let k = 0; k < nw; k++) {
          const p = this.randomCell((c) => this.t.type[c] === Cell.Grass);
          if (p >= 0) this.addWarren((p % this.w) + 0.5, Math.floor(p / this.w) + 0.5, s);
        }
      }
      let count = Math.round(def.start * scale);
      if (def.aquatic) {
        // fish scale with the water there is, so they can find each other to spawn
        let water = 0;
        for (let c = 0; c < this.n; c++) if (this.t.type[c] === Cell.Water) water++;
        count = Math.round(clamp(water * 0.12, 60, 1200));
      }
      let packLeft = 0;
      let packId = 0;
      let packX = 0;
      let packY = 0;
      for (let k = 0; k < count; k++) {
        let px: number;
        let py: number;
        if (def.encoding === 'pack') {
          if (packLeft === 0) {
            packId = this.nextPack++;
            packLeft = 6;
            const p = this.randomCell((c) => this.passableCell(c, def));
            packX = (p % this.w) + 0.5;
            packY = Math.floor(p / this.w) + 0.5;
          }
          packLeft--;
          px = clamp(packX + this.rLife.range(-3, 3), 1, this.w - 1);
          py = clamp(packY + this.rLife.range(-3, 3), 1, this.h - 1);
          if (!this.passable(px, py, def)) {
            px = packX;
            py = packY;
          }
        } else {
          const nearWater = (def.swims && !def.aquatic) || s === Sp.Heron;
          const p = this.randomCell((c) => this.passableCell(c, def) && (!nearWater || this.t.waterDist[c] <= 3));
          px = (p % this.w) + 0.5;
          py = Math.floor(p / this.w) + 0.5;
        }
        const i = this.spawn(s, px, py, this.rLife.int(3), 0);
        if (i < 0) break;
        this.age[i] = this.rLife.int(Math.floor(def.lifeDays * TICKS_PER_DAY * 0.6));
        this.energy[i] = this.rLife.range(0.6, 0.9);
        this.hyd[i] = this.rLife.range(0.6, 0.95);
        for (let tr = 0; tr < N_TRAITS; tr++) this.traits[i * N_TRAITS + tr] = this.baseTrait(tr) + this.rLife.normal() * 0.04;
        this.clampTraits(i);
        if (def.encoding === 'pack') this.pack[i] = packId;
        if (def.burrows) this.home[i] = this.nearestWarren(px, py, s, 40);
      }
    }
  }

  populationScale(): number {
    const base = { valley: 1, lakes: 0.95, islands: 0.7, plain: 1.15, highlands: 0.8 }[this.cfg.preset];
    return base * (this.n / (384 * 216));
  }

  baseTrait(tr: number): number {
    return tr === Trait.Boldness || tr === Trait.Night ? 0.5 : tr === Trait.Coat ? 0.35 : 1;
  }

  clampTraits(i: number): void {
    for (let tr = 0; tr < N_TRAITS; tr++) {
      const k = i * N_TRAITS + tr;
      this.traits[k] = clamp(this.traits[k], TRAIT_RANGES[tr][0], TRAIT_RANGES[tr][1]);
    }
  }

  private randomCell(ok: (c: number) => boolean): number {
    for (let tries = 0; tries < 5000; tries++) {
      const c = this.rLife.int(this.n);
      if (ok(c)) return c;
    }
    return -1;
  }

  passableCell(c: number, def: SpeciesDef): boolean {
    const ty = this.t.type[c];
    if (def.flying) return true;
    if (this.wall[c]) return false;
    if (def.aquatic) return ty === Cell.Water;
    if (ty === Cell.Water) return def.swims;
    return true;
  }

  passable(x: number, y: number, def: SpeciesDef): boolean {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    return this.passableCell((y | 0) * this.w + (x | 0), def);
  }

  spawn(s: number, x: number, y: number, lineage: number, motherId: number): number {
    let i: number;
    if (this.freeTop > 0) i = this.freeList[--this.freeTop];
    else if (this.hw < C) i = this.hw++;
    else return -1;
    this.alive[i] = 1;
    this.sp[i] = s;
    this.aid[i] = this.nextId++;
    this.x[i] = x;
    this.y[i] = y;
    this.rLife.unit(this.scratch);
    this.hx[i] = this.scratch.x;
    this.hy[i] = this.scratch.y;
    this.energy[i] = 0.7;
    this.hyd[i] = 0.8;
    this.health[i] = 1;
    this.age[i] = 0;
    this.sex[i] = this.rLife.int(2);
    this.lin[i] = lineage;
    this.act[i] = 0;
    this.st[i] = 0;
    this.explored[i] = 0;
    this.tgt[i] = -1;
    this.tgtId[i] = 0;
    this.mate[i] = -1;
    this.gtimer[i] = 0;
    this.home[i] = -1;
    this.shel[i] = 0;
    this.cool[i] = 0;
    this.hcool[i] = 0;
    this.gest[i] = 0;
    this.alarm[i] = 0;
    this.alarmAir[i] = 0;
    this.sick[i] = 0;
    this.rew[i] = 0;
    this.mother[i] = motherId;
    this.kills[i] = 0;
    this.born[i] = this.tick;
    this.histLen[i] = 0;
    this.hasPrev[i] = 0;
    this.logHead[i] = 0;
    this.logE.fill(0, i * LOG_LEN, i * LOG_LEN + LOG_LEN);
    this.thrKind[i] = 0;
    this.thrClose[i] = 0;
    this.preyN[i] = 0;
    this.crowdN[i] = 0;
    this.pack[i] = 0;
    this.carc[i] = -1;
    this.moved[i] = 0;
    this.stam[i] = 1;
    this.dormant[i] = 0;
    this.carry[i] = 0;
    this.path[i] = 0;
    this.immune[i] = 0;
    this.counts[s]++;
    this.everSeen[s] = 1;
    this.brains.members[s * MAX_LINEAGES + lineage]++;
    this.note(i, LogCode.Born);
    return i;
  }

  addWarren(x: number, y: number, s: number): number {
    let k = -1;
    for (let j = 0; j < this.wCount; j++) if (!this.wAlive[j]) {
      k = j;
      break;
    }
    if (k < 0) {
      if (this.wCount >= MAX_WARRENS) return -1;
      k = this.wCount++;
    }
    this.wx[k] = x;
    this.wy[k] = y;
    this.wAlive[k] = 1;
    this.wSp[k] = s;
    this.wIdle[k] = 0;
    this.wDirty = true;
    return k;
  }

  /** Live warrens per species, recounted only when warrens change. */
  private wPerSp = new Int32Array(NS);
  private wPerSpDirty = true;
  warrensOf(s: number): number {
    if (this.wPerSpDirty || this.wDirty) {
      this.wPerSp.fill(0);
      for (let k = 0; k < this.wCount; k++) if (this.wAlive[k]) this.wPerSp[this.wSp[k]]++;
      this.wPerSpDirty = false;
    }
    return this.wPerSp[s];
  }

  private buildWarrenGrid(): void {
    this.wPerSpDirty = true;
    const bs = this.wbStart;
    bs.fill(0);
    const nb = this.gw * this.gh;
    for (let k = 0; k < this.wCount; k++) {
      if (!this.wAlive[k]) continue;
      bs[((this.wy[k] / BUCKET) | 0) * this.gw + ((this.wx[k] / BUCKET) | 0) + 1]++;
    }
    for (let b = 0; b < nb; b++) bs[b + 1] += bs[b];
    const cur = bs.slice(0, nb);
    for (let k = 0; k < this.wCount; k++) {
      if (!this.wAlive[k]) continue;
      this.wbItems[cur[((this.wy[k] / BUCKET) | 0) * this.gw + ((this.wx[k] / BUCKET) | 0)]++] = k;
    }
    this.wDirty = false;
  }

  nearestWarren(x: number, y: number, s: number, maxD: number): number {
    if (this.wDirty) this.buildWarrenGrid();
    let best = -1;
    let bd = maxD * maxD;
    const bx0 = Math.max(0, ((x - maxD) / BUCKET) | 0);
    const bx1 = Math.min(this.gw - 1, ((x + maxD) / BUCKET) | 0);
    const by0 = Math.max(0, ((y - maxD) / BUCKET) | 0);
    const by1 = Math.min(this.gh - 1, ((y + maxD) / BUCKET) | 0);
    for (let by = by0; by <= by1; by++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const b = by * this.gw + bx;
        for (let q = this.wbStart[b]; q < this.wbStart[b + 1]; q++) {
          const k = this.wbItems[q];
          if (!this.wAlive[k] || this.wSp[k] !== s) continue;
          const dx = this.wx[k] - x;
          const dy = this.wy[k] - y;
          const d = dx * dx + dy * dy;
          if (d < bd || (d === bd && k < best)) {
            bd = d;
            best = k;
          }
        }
      }
    }
    return best;
  }

  addCarcass(x: number, y: number, mass: number, s: number, infected: number): number {
    let k = -1;
    for (let j = 0; j < this.cTop; j++) if (this.cmass[j] <= 0) {
      k = j;
      break;
    }
    if (k < 0) {
      if (this.cTop >= MAX_CARCASSES) return -1;
      k = this.cTop++;
    }
    this.cx[k] = x;
    this.cy[k] = y;
    this.cmass[k] = mass;
    this.csp[k] = s;
    this.cInf[k] = infected;
    return k;
  }

  note(i: number, code: number): void {
    const h = this.logHead[i];
    this.logE[i * LOG_LEN + h] = code;
    this.logT[i * LOG_LEN + h] = this.tick;
    this.logHead[i] = (h + 1) % LOG_LEN;
  }

  // =====================================================================
  // the tick
  // =====================================================================

  step(events?: LogEvent[]): void {
    this.events.length = 0;
    if (events) for (const e of events) this.applyEvent(e);
    this.updateEnv();
    this.updateFields();
    stepFire(this);
    this.buildHash();
    this.actionCounts.fill(0);

    const hw = this.hw;
    for (let i = 0; i < hw; i++) this.ready[i] = this.alive[i] && !this.dormant[i] && this.canBreed(i) ? 1 : 0;
    for (let i = 0; i < hw; i++) if (this.alive[i] && !this.dormant[i]) this.think(i);
    this.huntersOn.fill(0, 0, hw);
    // everything else moves first; hunters then close on where their prey actually went
    for (let i = 0; i < hw; i++) if (this.alive[i] && !this.dormant[i] && this.act[i] !== Act.Hunt) this.move(i);
    for (let i = 0; i < hw; i++) if (this.alive[i] && !this.dormant[i] && this.act[i] === Act.Hunt) this.move(i);

    // resolve in a seeded shuffle so no slot is favoured in contests
    let m = 0;
    for (let i = 0; i < hw; i++) if (this.alive[i] && !this.dormant[i]) this.order[m++] = i;
    for (let k = m - 1; k > 0; k--) {
      const j = this.rRes.int(k + 1);
      const tmp = this.order[k];
      this.order[k] = this.order[j];
      this.order[j] = tmp;
    }
    for (let k = 0; k < m; k++) {
      const i = this.order[k];
      if (this.alive[i]) this.resolve(i);
    }

    this.births.length = 0;
    for (let i = 0; i < hw; i++) if (this.alive[i]) this.upkeep(i);
    for (let k = 0; k < this.births.length; k++) this.giveBirth(this.births[k]);

    this.tick++;
    if (this.tick % TICKS_PER_DAY === 0) this.daily();
  }

  /** Once a day: empty warrens fall in after 10 days. */
  private daily(): void {
    dailyTrees(this);
    dailyDams(this);
    dailyWeather(this);
    dailyDisease(this);
    scarDaily(this);
    this.wOcc.fill(0);
    for (let i = 0; i < this.hw; i++) if (this.alive[i] && this.home[i] >= 0) this.wOcc[this.home[i]]++;
    for (let k = 0; k < this.wCount; k++) {
      if (!this.wAlive[k]) continue;
      if (this.wOcc[k] > 0) this.wIdle[k] = 0;
      else if (++this.wIdle[k] > 10) {
        this.wAlive[k] = 0;
        this.wDirty = true;
      }
    }
  }

  updateEnv(): void {
    const day = Math.floor(this.tick / TICKS_PER_DAY);
    const hour = this.tick % TICKS_PER_DAY;
    this.doy = day % DAYS_PER_YEAR;
    this.season = Math.floor(this.doy / DAYS_PER_SEASON);
    // warmth peaks mid-summer (day 42) and bottoms out mid-winter (day 98)
    this.warmth = sin((2 * Math.PI * (this.doy - 14)) / DAYS_PER_YEAR);
    this.dayLen = 12 + 4 * this.warmth;
    this.isDay = hour >= 12 - this.dayLen / 2 && hour < 12 + this.dayLen / 2;
    this.growMul = clamp(0.7 + 0.45 * this.warmth, TUNE.winterGrow, 1.1);
    this.metabMul = 1 + 0.12 * Math.max(0, -this.warmth);
  }

  isTwilight(): boolean {
    const hour = this.tick % TICKS_PER_DAY;
    const dawn = 12 - this.dayLen / 2;
    const dusk = 12 + this.dayLen / 2;
    return Math.abs(hour - dawn) <= 1.5 || Math.abs(hour - dusk) <= 1.5;
  }

  private updateFields(): void {
    const g = this.grass;
    const cap = this.t.grassCap;
    const moist = this.t.moisture;
    // regrowth is fastest on grazed ground and slows as the sward fills in
    const rate = TUNE.grassRate * this.growMul * weatherGrowMul(this);
    const scar = this.scar;
    for (let c = 0; c < this.n; c++) {
      const k = cap[c];
      if (k <= 0) continue;
      const v = g[c];
      if (v < k) g[c] = v + rate * (scar[c] > 0 ? 2.2 : 1) * (0.4 + 0.6 * moist[c]) * (k - v); // burnt ground flushes green
    }
    const fear = this.fear;
    for (let c = 0; c < this.n; c++) if (fear[c] > 0) fear[c] = fear[c] < 0.01 ? 0 : fear[c] * 0.95;
    if (this.tick % 6 === 0) {
      slowFields(this);
      stepToxin(this);
    }
    const decay = this.warmth < -0.3 ? 0.9875 : 0.975;
    for (let k = 0; k < this.cTop; k++) {
      if (this.cmass[k] <= 0) continue;
      this.cmass[k] *= decay;
      if (this.cmass[k] < 0.02) this.cmass[k] = 0;
      const cc = (this.cy[k] | 0) * this.w + (this.cx[k] | 0);
      this.insects[cc] = Math.min(1, this.insects[cc] + 0.01);
    }
  }

  private buildHash(): void {
    const nb = this.gw * this.gh;
    const bs = this.bStart;
    const hs = this.hStart;
    bs.fill(0);
    hs.fill(0);
    const hw = this.hw;
    const gw = this.gw;
    for (let i = 0; i < hw; i++) {
      if (!this.alive[i] || this.dormant[i]) continue;
      const b = ((this.y[i] / BUCKET) | 0) * gw + ((this.x[i] / BUCKET) | 0);
      bs[b + 1]++;
      if (IS_HUNTER[this.sp[i]]) hs[b + 1]++;
    }
    for (let b = 0; b < nb; b++) {
      bs[b + 1] += bs[b];
      hs[b + 1] += hs[b];
    }
    const fill = this.order; // reuse as cursors
    fill.set(bs.subarray(0, nb));
    const hfill = this.huntersOn; // free until move()
    for (let b = 0; b < nb; b++) hfill[b] = hs[b];
    for (let i = 0; i < hw; i++) {
      if (!this.alive[i] || this.dormant[i]) continue;
      const b = ((this.y[i] / BUCKET) | 0) * gw + ((this.x[i] / BUCKET) | 0);
      this.bItems[fill[b]++] = i;
      if (IS_HUNTER[this.sp[i]]) this.hItems[hfill[b]++] = i;
    }
    const cs = this.cbStart;
    cs.fill(0);
    for (let k = 0; k < this.cTop; k++) {
      if (this.cmass[k] <= 0.05) continue;
      cs[((this.cy[k] / BUCKET) | 0) * gw + ((this.cx[k] / BUCKET) | 0) + 1]++;
    }
    for (let b = 0; b < nb; b++) cs[b + 1] += cs[b];
    for (let b = 0; b < nb; b++) hfill[b] = cs[b];
    for (let k = 0; k < this.cTop; k++) {
      if (this.cmass[k] <= 0.05) continue;
      this.cbItems[hfill[((this.cy[k] / BUCKET) | 0) * gw + ((this.cx[k] / BUCKET) | 0)]++] = k;
    }
  }

  /** Nearest carcass with meat on it within r (ties → lower index), and how many are in range. */
  private carrionScan(x: number, y: number, r: number): { best: number; d2: number; count: number } {
    const res = this.carrionRes;
    res.best = -1;
    res.d2 = r * r;
    res.count = 0;
    const r2 = r * r;
    const bx0 = Math.max(0, ((x - r) / BUCKET) | 0);
    const bx1 = Math.min(this.gw - 1, ((x + r) / BUCKET) | 0);
    const by0 = Math.max(0, ((y - r) / BUCKET) | 0);
    const by1 = Math.min(this.gh - 1, ((y + r) / BUCKET) | 0);
    for (let by = by0; by <= by1; by++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const b = by * this.gw + bx;
        for (let q = this.cbStart[b]; q < this.cbStart[b + 1]; q++) {
          const k = this.cbItems[q];
          if (this.cmass[k] <= 0.05) continue;
          const dx = this.cx[k] - x;
          const dy = this.cy[k] - y;
          const d2 = dx * dx + dy * dy;
          if (d2 >= r2) continue;
          res.count++;
          if (d2 < res.d2 || (d2 === res.d2 && k < res.best)) {
            res.d2 = d2;
            res.best = k;
          }
        }
      }
    }
    return res;
  }
  private carrionRes = { best: -1, d2: 0, count: 0 };

  /** Plant food available to a species in a cell, in food units (acorns and berries are rich). */
  plantAt(c: number, def: SpeciesDef): number {
    const f = def.foods;
    let v = 0;
    if (f & (Food.Grass | Food.Shrub)) v += this.grass[c];
    if (f & Food.Acorn) v += 3 * (this.acorn[c] + (def.id === Sp.Squirrel ? this.cache[c] : 0));
    if (f & Food.Insect) v += this.insects[c] * 0.6;
    if (f & Food.Berry) v += 3 * this.berry[c];
    if (f & Food.Algae) v += this.algae[c];
    return v;
  }

  /** Eat up to `want` food units from a cell, richest layer first. Returns units eaten. */
  consume(c: number, def: SpeciesDef, want: number): number {
    const f = def.foods;
    let left = want;
    let u: number;
    if (f & Food.Berry && left > 0 && this.berry[c] > 0) {
      u = Math.min(this.berry[c] * 3, left);
      this.berry[c] -= u / 3;
      left -= u;
    }
    if (f & Food.Acorn && left > 0) {
      if (this.acorn[c] > 0) {
        u = Math.min(this.acorn[c] * 3, left);
        this.acorn[c] -= u / 3;
        left -= u;
      }
      if (def.id === Sp.Squirrel && left > 0 && this.cache[c] > 0) {
        u = Math.min(this.cache[c] * 3, left);
        this.cache[c] -= u / 3;
        left -= u;
      }
    }
    if (f & Food.Insect && left > 0 && this.insects[c] > 0.02) {
      u = Math.min((this.insects[c] - 0.02) * 0.6, left);
      this.insects[c] -= u / 0.6;
      left -= u;
    }
    if (f & Food.Algae && left > 0 && this.algae[c] > 0.02) {
      u = Math.min(this.algae[c] - 0.02, left);
      this.algae[c] -= u;
      left -= u;
    }
    if (f & (Food.Grass | Food.Shrub) && left > 0 && this.grass[c] > 0.04) {
      u = Math.min(this.grass[c] - 0.04, left); // the last stubble is left
      this.grass[c] -= u;
      left -= u;
    }
    return want - left;
  }

  canBreed(i: number): boolean {
    const s = this.sp[i];
    const def = SPECIES[s];
    if (this.age[i] < def.maturityDays * TICKS_PER_DAY) return false;
    if (this.cool[i] > 0 || this.gest[i] > 0) return false;
    if (this.energy[i] < (def.encoding === 'prey' ? 0.5 : 0.55)) return false;
    if (def.breeds === 'spring' && this.season !== 0) return false;
    if (s === Sp.Frog && this.t.waterDist[(this.y[i] | 0) * this.w + (this.x[i] | 0)] > 2) return false;
    if (def.breeds === 'warm' && this.season === 3) return false;
    return true;
  }

  senseRange(i: number, def: SpeciesDef): number {
    const night = this.traits[i * N_TRAITS + Trait.Night];
    let r = def.sense * this.traits[i * N_TRAITS + Trait.Sense];
    if (this.isDay) {
      if (def.active === 'night') r *= 0.8;
      r *= 1 - 0.2 * (night - 0.5);
    } else {
      if (def.active === 'day') r *= 0.5;
      else if (def.active !== 'night') r *= 0.85;
      r *= 1 + 0.4 * (night - 0.5);
    }
    return r;
  }

  private groundTone(c: number): number {
    const ty = this.t.type[c];
    return ty === Cell.Sand ? 0.75 : ty === Cell.Rock ? 0.55 : ty === Cell.Water ? 0.4 : 0.25 + 0.2 * (1 - this.grass[c]);
  }

  // ---------------------------------------------------------------------
  // think: perceive → encode → learn → choose
  // ---------------------------------------------------------------------

  private stateVals = new Int32Array(10);

  private think(i: number): void {
    const s = this.sp[i];
    const def = SPECIES[s];
    const enc = def.encoding;
    const x = this.x[i];
    const y = this.y[i];
    const r = this.senseRange(i, def);
    const r2 = r * r;
    const tb = i * N_TRAITS;

    let thrBest = Infinity;
    let thrJ = -1;
    let preyBest = Infinity;
    let preyCost = Infinity;
    let preyJ = -1;
    let mateBest = Infinity;
    let mateJ = -1;
    let crowd = 0;
    let preyCount = 0;
    let packCount = 0;
    let packX = 0;
    let packY = 0;
    let circling = 0;
    let circCarc = -1;
    const wantMate = this.ready[i] === 1;
    const myPack = this.pack[i];

    if (enc === 'prey') {
      // predators only, across the full sense range
      const bx0 = Math.max(0, ((x - r) / BUCKET) | 0);
      const bx1 = Math.min(this.gw - 1, ((x + r) / BUCKET) | 0);
      const by0 = Math.max(0, ((y - r) / BUCKET) | 0);
      const by1 = Math.min(this.gh - 1, ((y + r) / BUCKET) | 0);
      for (let by = by0; by <= by1; by++) {
        for (let bx = bx0; bx <= bx1; bx++) {
          const b = by * this.gw + bx;
          for (let k = this.hStart[b]; k < this.hStart[b + 1]; k++) {
            const j = this.hItems[k];
            if (!this.alive[j] || HUNTS[this.sp[j] * NS + s] <= 0) continue;
            const dx = this.x[j] - x;
            const dy = this.y[j] - y;
            const d2 = dx * dx + dy * dy;
            if (this.act[j] === Act.Ambush && d2 > 6) continue; // a still snake or heron goes unseen
            if (d2 <= r2 && d2 < thrBest) {
              thrBest = d2;
              thrJ = j;
            }
          }
        }
      }
    }
    // everyone else nearby; prey only look at their own kind within 8 cells, every 4th tick
    const preyRefresh = enc !== 'prey' || ((i + this.tick) & 3) === 0;
    const rs = enc === 'prey' ? (preyRefresh ? Math.min(r, 10) : -1) : r;
    const rs2 = rs * rs;
    const bx0 = rs < 0 ? 1 : Math.max(0, ((x - rs) / BUCKET) | 0);
    const bx1 = rs < 0 ? 0 : Math.min(this.gw - 1, ((x + rs) / BUCKET) | 0);
    const by0 = Math.max(0, ((y - rs) / BUCKET) | 0);
    const by1 = Math.min(this.gh - 1, ((y + rs) / BUCKET) | 0);
    for (let by = by0; by <= by1; by++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const b = by * this.gw + bx;
        for (let k = this.bStart[b]; k < this.bStart[b + 1]; k++) {
          const j = this.bItems[k];
          if (j === i || !this.alive[j]) continue;
          const dx = this.x[j] - x;
          const dy = this.y[j] - y;
          const d2 = dx * dx + dy * dy;
          if (d2 > rs2) continue;
          const sj = this.sp[j];
          if (sj === s) {
            if (d2 < 16 || enc !== 'prey') crowd++;
            if (wantMate && this.ready[j] && this.sex[j] !== this.sex[i] && d2 < mateBest) {
              mateBest = d2;
              mateJ = j;
            }
            if (enc === 'pack' && this.pack[j] === myPack && d2 < 900) {
              packCount++;
              packX += this.x[j];
              packY += this.y[j];
            }
            if (enc === 'scavenger' && this.act[j] === Act.Scavenge && this.carc[j] >= 0) {
              circling = 1;
              if (circCarc < 0) circCarc = this.carc[j];
            }
            continue;
          }
          if (enc === 'prey') continue;
          // does j hunt me?
          if (HUNTS[sj * NS + s] > 0) {
            if (d2 < thrBest) {
              thrBest = d2;
              thrJ = j;
            }
          }
          // do I hunt j?
          const catchable = HUNTS[s * NS + sj];
          if (catchable > 0) {
            preyCount++;
            if (this.hiddenFrom(s, j)) continue;
            const d = Math.sqrt(d2);
            // rank targets by food value against distance, not distance alone
            const value = Math.min(SPECIES[sj].mass, def.foodCap) * catchable;
            const cost = (d + 2) / Math.sqrt(Math.sqrt(value));
            if (cost < preyCost) {
              // detection: frozen prey and coats that match the ground are harder to spot
              let pd = 1;
              if (d > 3) {
                const c = (this.y[j] | 0) * this.w + (this.x[j] | 0);
                const mismatch = Math.abs(this.traits[j * N_TRAITS + Trait.Coat] - this.groundTone(c));
                pd = (0.55 + 0.45 * mismatch) * (this.act[j] === Act.Freeze ? 0.35 : 1) * this.traits[j * N_TRAITS + Trait.Body];
              }
              if (pd >= 1 || this.rThink.float() < pd) {
                preyBest = d2;
                preyCost = cost;
                preyJ = j;
              }
            }
          }
        }
      }
    }

    // keep a locked chase going a little beyond normal sense range
    if (enc !== 'prey' && enc !== 'scavenger' && this.tgt[i] >= 0) {
      const j = this.tgt[i];
      if (this.alive[j] && this.aid[j] === this.tgtId[i] && !this.hiddenFrom(s, j)) {
        const dx = this.x[j] - x;
        const dy = this.y[j] - y;
        const d2 = dx * dx + dy * dy;
        if (d2 < r2 * 2.25 && (preyJ < 0 || d2 <= preyBest * 1.5)) {
          preyJ = j;
          preyBest = d2;
        }
      }
    }

    if (preyRefresh) {
      this.crowdN[i] = crowd;
      this.mate[i] = mateJ;
    } else {
      crowd = this.crowdN[i];
      const mj = this.mate[i];
      if (mj >= 0 && !(wantMate && this.alive[mj] && this.ready[mj])) this.mate[i] = -1;
    }
    if (enc !== 'scavenger') this.preyN[i] = preyCount;

    // threat bookkeeping (prey use it for state and reward; predators for fleeing)
    if (thrJ >= 0) {
      const d = Math.sqrt(thrBest);
      const bold = this.traits[tb + Trait.Boldness];
      const closeR = Math.max(3, r * (0.42 - 0.24 * bold));
      this.thrX[i] = this.x[thrJ];
      this.thrY[i] = this.y[thrJ];
      this.thrD[i] = d;
      this.thrKind[i] = SPECIES[this.sp[thrJ]].flying ? 2 : 1;
      this.thrClose[i] = d < closeR ? 1 : 0;
    } else {
      this.thrKind[i] = 0;
      this.thrClose[i] = 0;
    }

    const v = this.stateVals;
    const e = this.energy[i];
    v[0] = e >= 0.75 ? 0 : e >= 0.5 ? 1 : e >= 0.25 ? 2 : 3;
    const hy = this.hyd[i];
    v[1] = def.aquatic ? 0 : hy >= 0.6 ? 0 : hy >= 0.3 ? 1 : 2;
    const c = (y | 0) * this.w + (x | 0);

    if (enc === 'prey') {
      let threat = 0;
      if (thrJ >= 0) threat = 1 + this.thrClose[i] + (this.thrKind[i] === 2 ? 2 : 0);
      else if (this.alarm[i] > 0) threat = this.alarmAir[i] ? 3 : 1;
      else if (this.fear[c] > 0.5) threat = 1;
      v[2] = threat;
      const food = this.plantAt(c, def);
      v[3] = food < 0.15 ? 0 : food < 0.45 ? 1 : 2;
      let shelterBin = 2;
      if (this.shel[i]) shelterBin = 0;
      else if (def.swims && !def.aquatic) {
        const wd = this.t.waterDist[c];
        shelterBin = wd === 0 ? 0 : wd <= 6 ? 1 : 2;
      } else if (!def.burrows && !def.aquatic) {
        // for tree-dwellers "home" is the nearest climbable tree, refreshed every 4th tick
        let tk = this.home[i];
        if (preyRefresh || (tk >= 0 && (!this.trAlive[tk] || this.trStage[tk] !== Stage.Mature))) {
          tk = nearestTree(this, x, y, 6, Stage.Mature);
          this.home[i] = tk;
        }
        if (tk >= 0 && (this.trX[tk] - x) ** 2 + (this.trY[tk] - y) ** 2 <= 49) shelterBin = 1;
      } else if (def.burrows) {
        let hm = this.home[i];
        if (hm < 0 || !this.wAlive[hm]) {
          hm = this.nearestWarren(x, y, s, 30);
          this.home[i] = hm;
        }
        if (hm >= 0) {
          const dx = this.wx[hm] - x;
          const dy = this.wy[hm] - y;
          if (dx * dx + dy * dy < 36) shelterBin = 1;
        }
      }
      v[4] = shelterBin;
      v[5] = this.isDay ? 1 : 0;
      v[6] = wantMate ? 1 : 0;
      v[7] = crowd >= 5 ? 1 : 0;
    } else if (enc === 'scavenger') {
      // nearest carcass, or follow other vultures to theirs
      const cr = this.carrionScan(x, y, r);
      let best = cr.best;
      let bd = cr.d2;
      if (best < 0 && circCarc >= 0 && this.cmass[circCarc] > 0.05) {
        best = circCarc;
        const dx = this.cx[best] - x;
        const dy = this.cy[best] - y;
        bd = dx * dx + dy * dy;
      }
      this.carc[i] = best;
      const carrion = cr.count;
      this.preyN[i] = carrion; // a scavenger's "prey" is carrion in range
      const d = Math.sqrt(bd);
      v[2] = best < 0 ? 0 : d > 20 ? 1 : d > 2 ? 2 : 3;
      v[3] = circling;
      v[4] = this.isDay ? 1 : 0;
      v[5] = wantMate ? 1 : 0;
    } else {
      // predator / pack
      if (preyJ >= 0) {
        this.tgt[i] = preyJ;
        this.tgtId[i] = this.aid[preyJ];
      } else this.tgt[i] = -1;
      const d = Math.sqrt(preyBest);
      v[2] = preyJ < 0 ? 0 : d > r * 0.5 ? 1 : d > def.strike * 3 ? 2 : 3;
      v[3] = this.hcool[i] === 0 ? 1 : 0;
      v[4] = thrJ < 0 ? 0 : this.thrD[i] < 8 ? 2 : 1;
      v[5] = this.isDay ? 1 : 0;
      v[6] = wantMate ? 1 : 0;
      const best = this.carrionScan(x, y, r).best;
      this.carc[i] = best;
      v[7] = best >= 0 ? 1 : 0;
      if (enc === 'pack') {
        v[8] = packCount === 0 ? 0 : packCount <= 3 ? 1 : 2;
        if (packCount > 0) {
          this.gx[i] = packX / packCount;
          this.gy[i] = packY / packCount;
        } else {
          this.gx[i] = x;
          this.gy[i] = y;
        }
      }
    }

    if (this.sick[i]) spread(this, i);
    const state = encode(enc, v);
    this.learn(i, state);
    this.choose(i, state);
  }

  /** Push last tick's (s, a, r) and run the n-step update once the window is full. */
  private learn(i: number, state: number): void {
    const s = this.sp[i];
    const l = this.brains.lin[s][this.lin[i]];
    if (!l) return;
    const nA = this.brains.nActs[s];
    if (this.hasPrev[i]) {
      this.pushHist(i, this.st[i], ACTION_SLOT[s * N_ACTIONS + this.act[i]], this.rew[i]);
      this.trackReward(i, this.rew[i]);
      this.rew[i] = 0;
      if (this.histLen[i] === N_STEP) {
        const base = i * N_STEP;
        let G = 0;
        let g = 1;
        for (let k = 0; k < N_STEP; k++) {
          G += g * this.histR[base + k];
          g *= GAMMA;
        }
        G += g * this.brains.maxQ(l, state, nA);
        this.brains.update(l, this.histS[base], this.histA[base], nA, G);
        this.shiftHist(i);
      }
    }
  }

  private pushHist(i: number, s: number, a: number, r: number): void {
    const base = i * N_STEP;
    const n = this.histLen[i];
    this.histS[base + n] = s;
    this.histA[base + n] = a;
    this.histR[base + n] = r;
    this.histLen[i] = n + 1;
  }

  private shiftHist(i: number): void {
    const base = i * N_STEP;
    const n = this.histLen[i];
    for (let k = 1; k < n; k++) {
      this.histS[base + k - 1] = this.histS[base + k];
      this.histA[base + k - 1] = this.histA[base + k];
      this.histR[base + k - 1] = this.histR[base + k];
    }
    this.histLen[i] = n - 1;
  }

  private trackReward(i: number, r: number): void {
    const k = this.sp[i] * MAX_LINEAGES + this.lin[i];
    this.brains.rewardSum[k] = this.brains.rewardSum[k] * 0.9995 + r;
    this.brains.rewardN[k] = this.brains.rewardN[k] * 0.9995 + 1;
  }

  /** Terminal flush on death: no bootstrap. */
  private flush(i: number): void {
    const s = this.sp[i];
    const l = this.brains.lin[s][this.lin[i]];
    if (!l) return;
    const nA = this.brains.nActs[s];
    if (this.hasPrev[i]) {
      this.pushHist(i, this.st[i], ACTION_SLOT[s * N_ACTIONS + this.act[i]], this.rew[i]);
      this.trackReward(i, this.rew[i]);
    }
    const base = i * N_STEP;
    while (this.histLen[i] > 0) {
      const n = this.histLen[i];
      let G = 0;
      let g = 1;
      for (let k = 0; k < n; k++) {
        G += g * this.histR[base + k];
        g *= GAMMA;
      }
      this.brains.update(l, this.histS[base], this.histA[base], nA, G);
      this.shiftHist(i);
    }
    this.hasPrev[i] = 0;
  }

  private choose(i: number, state: number): void {
    const s = this.sp[i];
    const def = SPECIES[s];
    const l = this.brains.lin[s][this.lin[i]]!;
    const nA = this.brains.nActs[s];
    const sv = l.stateVisits[state];
    if (sv < 65535) l.stateVisits[state] = sv + 1;
    const eps = this.brains.epsilon(l, state, this.cfg.instinct === 'newborn');
    let a: number;
    if (this.cfg.policy === 'rules') {
      const want = this.rulesAction(i);
      const slot = ACTION_SLOT[s * N_ACTIONS + want];
      a = slot >= 0 ? slot : 0;
      this.explored[i] = 0;
    } else if (this.rThink.float() < eps) {
      a = this.rThink.int(nA);
      this.explored[i] = 1;
    } else {
      a = this.brains.argmax(l, state, nA);
      this.explored[i] = 0;
    }
    this.st[i] = state;
    this.act[i] = def.actions[a];
    this.hasPrev[i] = 1;
    this.actionCounts[s * N_ACTIONS + this.act[i]]++;
  }

  private rulesAction(i: number): Act {
    return rulesFromState(SPECIES[this.sp[i]], this.stateVals);
  }

  // ---------------------------------------------------------------------
  // move: motor control for the chosen action
  // ---------------------------------------------------------------------

  private move(i: number): void {
    const s = this.sp[i];
    const def = SPECIES[s];
    const x = this.x[i];
    const y = this.y[i];
    const a = this.act[i];
    let dx = 0;
    let dy = 0;
    let pace = 0;
    const c = (y | 0) * this.w + (x | 0);

    switch (a) {
      case Act.Forage: {
        const g = this.plantAt(c, def);
        if (def.foods & Food.Willow && g < 0.3) {
          // beavers head for willow
          const tk = nearestWillow(this, x, y, Math.ceil(this.senseRange(i, def)));
          if (tk >= 0) {
            dx = this.trX[tk] - x;
            dy = this.trY[tk] - y;
            if (dx * dx + dy * dy > 1.4) pace = 0.7;
            break;
          }
        }
        if (this.gtimer[i] > 0) {
          this.gtimer[i]--;
          dx = this.gx[i] - x;
          dy = this.gy[i] - y;
          if (dx * dx + dy * dy < 1) this.gtimer[i] = 0;
          pace = 0.6;
        } else if (g >= 0.2) {
          pace = 0.12;
          dx = this.hx[i];
          dy = this.hy[i];
        } else {
          const r = this.senseRange(i, def);
          let best = -1;
          let bx = x;
          let by = y;
          for (let k = 0; k < 8; k++) {
            this.rMove.unit(this.scratch);
            const dist = this.rMove.float() * r;
            const px = x + this.scratch.x * dist;
            const py = y + this.scratch.y * dist;
            if (!this.passable(px, py, def)) continue;
            const pc = (py | 0) * this.w + (px | 0);
            const score = this.plantAt(pc, def) - 0.004 * dist - 0.3 * this.fear[pc];
            if (score > best) {
              best = score;
              bx = px;
              by = py;
            }
          }
          this.gx[i] = bx;
          this.gy[i] = by;
          this.gtimer[i] = 10;
          dx = bx - x;
          dy = by - y;
          pace = 0.6;
        }
        break;
      }
      case Act.Drink: {
        if (this.t.waterDist[c] > 2) {
          dx = this.t.waterDir[c * 2];
          dy = this.t.waterDir[c * 2 + 1];
          pace = 0.8;
        }
        break;
      }
      case Act.Shelter: {
        if (def.aquatic) {
          let best = this.t.depth[c];
          for (let k = 0; k < 8; k++) {
            this.rMove.unit(this.scratch);
            const px = x + this.scratch.x * 3;
            const py = y + this.scratch.y * 3;
            if (!this.passable(px, py, def)) continue;
            const d = this.t.depth[(py | 0) * this.w + (px | 0)];
            if (d > best) {
              best = d;
              dx = this.scratch.x;
              dy = this.scratch.y;
            }
          }
          pace = dx || dy ? 1 : 0;
        } else if (def.swims && !def.burrows && this.t.type[c] !== Cell.Water && this.t.waterDist[c] < 8) {
          // swimmers dive into the nearest water
          dx = this.t.waterDir[c * 2];
          dy = this.t.waterDir[c * 2 + 1];
          pace = 1;
        } else if (!def.burrows && this.home[i] >= 0 && this.trAlive[this.home[i]]) {
          const tk = this.home[i];
          dx = this.trX[tk] - x;
          dy = this.trY[tk] - y;
          if (dx * dx + dy * dy < 0.6) dx = dy = 0;
          else pace = 1;
        } else if (def.burrows) {
          const hm = this.home[i];
          if (hm >= 0 && this.wAlive[hm]) {
            dx = this.wx[hm] - x;
            dy = this.wy[hm] - y;
            const d2 = dx * dx + dy * dy;
            if (d2 < 0.8) {
              this.x[i] = this.wx[hm];
              this.y[i] = this.wy[hm];
              dx = dy = 0;
            } else pace = 1;
          }
        }
        break;
      }
      case Act.Flee: {
        if (this.thrKind[i]) {
          dx = x - this.thrX[i];
          dy = y - this.thrY[i];
          const l = Math.sqrt(dx * dx + dy * dy) || 1;
          dx /= l;
          dy /= l;
          const hm = this.home[i];
          if (def.burrows && hm >= 0 && this.wAlive[hm]) {
            let hx = this.wx[hm] - x;
            let hy = this.wy[hm] - y;
            const hl = Math.sqrt(hx * hx + hy * hy) || 1;
            hx /= hl;
            hy /= hl;
            if (hx * dx + hy * dy > -0.2) {
              dx = dx * 0.5 + hx;
              dy = dy * 0.5 + hy;
            }
          }
        } else {
          // no hunter in sight: run down the gradient of fear (fire, kill sites)
          const xi = Math.min(this.w - 2, Math.max(1, x | 0));
          const yi = Math.min(this.h - 2, Math.max(1, y | 0));
          const gx = this.fear[yi * this.w + xi + 1] - this.fear[yi * this.w + xi - 1];
          const gy = this.fear[(yi + 1) * this.w + xi] - this.fear[(yi - 1) * this.w + xi];
          if (gx * gx + gy * gy > 1e-6) {
            dx = -gx;
            dy = -gy;
          } else {
            dx = this.hx[i];
            dy = this.hy[i];
          }
        }
        pace = 1;
        break;
      }
      case Act.Explore: {
        this.rMove.unit(this.scratch);
        dx = this.hx[i] + this.scratch.x * 0.35;
        dy = this.hy[i] + this.scratch.y * 0.35;
        if (def.encoding === 'pack') {
          const px = this.gx[i] - x;
          const py = this.gy[i] - y;
          const pl = Math.sqrt(px * px + py * py);
          if (pl > 5) {
            dx += (px / pl) * 0.6;
            dy += (py / pl) * 0.6;
          }
        }
        pace = 0.7;
        break;
      }
      case Act.Build: {
        if (this.carry[i] > 0) {
          const dk = nearestDam(this, x, y, 14);
          if (dk >= 0) {
            dx = this.damX[dk] - x;
            dy = this.damY[dk] - y;
            if (dx * dx + dy * dy > 1.5) pace = 0.8;
          } else if (this.t.waterDist[c] > 1) {
            dx = this.t.waterDir[c * 2];
            dy = this.t.waterDir[c * 2 + 1];
            pace = 0.8;
          }
        }
        break;
      }
      case Act.Mate: {
        const j = this.mate[i];
        if (j >= 0 && this.alive[j]) {
          dx = this.x[j] - x;
          dy = this.y[j] - y;
          if (dx * dx + dy * dy > 1.5) pace = 0.75;
        } else {
          dx = this.hx[i];
          dy = this.hy[i];
          pace = 0.5;
        }
        break;
      }
      case Act.Hunt: {
        const j = this.tgt[i];
        if (j >= 0 && this.alive[j] && this.aid[j] === this.tgtId[i]) {
          dx = this.x[j] - x;
          dy = this.y[j] - y;
          pace = 1;
          this.huntersOn[j]++;
        } else {
          this.rMove.unit(this.scratch);
          dx = this.hx[i] + this.scratch.x * 0.3;
          dy = this.hy[i] + this.scratch.y * 0.3;
          pace = 0.6;
        }
        break;
      }
      case Act.Scavenge: {
        const k = this.carc[i];
        if (k >= 0 && this.cmass[k] > 0) {
          dx = this.cx[k] - x;
          dy = this.cy[k] - y;
          if (dx * dx + dy * dy > 1) pace = 0.85;
        } else {
          this.rMove.unit(this.scratch);
          dx = this.hx[i] + this.scratch.x * 0.3;
          dy = this.hy[i] + this.scratch.y * 0.3;
          pace = 0.6;
        }
        break;
      }
      default:
        break; // Freeze, Rest, Dig, Call, Ambush: stay put
    }

    this.moved[i] = 0;
    if (pace >= 1) this.stam[i] = Math.max(0, this.stam[i] - 1 / SPRINT[s]);
    else if (this.stam[i] < 1) this.stam[i] = Math.min(1, this.stam[i] + 0.06);
    if (pace <= 0) return;
    const l = Math.sqrt(dx * dx + dy * dy);
    if (l < 1e-6) return;
    dx /= l;
    dy /= l;
    let step = def.speed * this.traits[i * N_TRAITS + Trait.Speed] * pace;
    if (!this.isDay && def.active === 'day' && !def.flying) step *= 0.7;
    if (this.stam[i] < 0.25) step *= 0.55; // winded
    // don't overshoot a goal
    if (a === Act.Hunt || a === Act.Mate || a === Act.Scavenge || a === Act.Shelter || (a === Act.Forage && this.gtimer[i] > 0)) step = Math.min(step, l);
    if (a === Act.Drink && !def.flying) step = Math.min(step, Math.max(0.6, this.t.waterDist[c] - 1));
    let nx = x + dx * step;
    let ny = y + dy * step;
    const stuck = !this.passableCell(c, def); // e.g. a flood rose around it: any way out is fine
    if (!stuck && !this.passable(nx, ny, def)) {
      let ok = false;
      for (let f = 0.5; f >= 0.25 && !ok; f -= 0.25) {
        nx = x + dx * step * f;
        ny = y + dy * step * f;
        ok = this.passable(nx, ny, def);
      }
      if (!ok) {
        nx = x + dx * step;
        ny = y + dy * step;
        if (this.passable(nx, y, def)) ny = y;
        else if (this.passable(x, ny, def)) nx = x;
        else {
          this.rMove.unit(this.scratch);
          this.hx[i] = this.scratch.x;
          this.hy[i] = this.scratch.y;
          this.gtimer[i] = 0;
          return;
        }
      }
    }
    nx = clamp(nx, 0.01, this.w - 0.01);
    ny = clamp(ny, 0.01, this.h - 0.01);
    const mx = nx - x;
    const my = ny - y;
    this.moved[i] = Math.sqrt(mx * mx + my * my);
    this.x[i] = nx;
    this.y[i] = ny;
    this.hx[i] = dx;
    this.hy[i] = dy;
  }

  // ---------------------------------------------------------------------
  // resolve: contests and effects, in shuffled order
  // ---------------------------------------------------------------------

  private resolve(i: number): void {
    const s = this.sp[i];
    const def = SPECIES[s];
    const a = this.act[i];
    const x = this.x[i];
    const y = this.y[i];
    const c = (y | 0) * this.w + (x | 0);
    this.shel[i] = 0;

    switch (a) {
      case Act.Forage: {
        if (def.foods === 0) break;
        // deer and other browsers nip saplings, which is how a deer boom stops the forest regrowing
        if (def.foods & Food.Shrub) {
          const tk = this.treeAt[c];
          if (tk >= 0 && this.trStage[tk] <= Stage.Sapling && this.rRes.chance(0.3)) {
            removeTree(this, tk);
            this.energy[i] = Math.min(1, this.energy[i] + 0.03);
          }
        }
        if (def.foods & Food.Willow) {
          const tk = nearestWillow(this, x, y, 1);
          if (tk >= 0) {
            const gain = Math.min(1 - this.energy[i], 0.05);
            this.energy[i] += gain;
            this.rew[i] += 5 * gain;
            if (this.rRes.chance(0.035)) {
              removeTree(this, tk); // felled: the beaver drags a length of willow away
              this.carry[i] = Math.min(3, this.carry[i] + 1);
            }
            break;
          }
        }
        const bite = this.consume(c, def, Math.min(def.bite, (1.02 - this.energy[i]) / def.plantEff));
        if (bite > 0) {
          const gain = Math.min(1 - this.energy[i], bite * def.plantEff);
          this.energy[i] += gain;
          this.rew[i] += 5 * gain;
          // lush, moist forage carries water too
          this.hyd[i] = Math.min(1, this.hyd[i] + gain * this.t.moisture[c]);
        }
        break;
      }
      case Act.Drink: {
        if (this.t.waterDist[c] <= 2 || def.aquatic) {
          const gain = Math.min(0.35, 1 - this.hyd[i]);
          this.hyd[i] += gain;
          this.rew[i] += 3 * gain;
        }
        break;
      }
      case Act.Shelter:
      case Act.Rest: {
        const hm = this.home[i];
        if (s === Sp.Squirrel && hm >= 0 && this.trAlive[hm]) {
          const dx = this.trX[hm] - x;
          const dy = this.trY[hm] - y;
          if (dx * dx + dy * dy < 0.9) this.shel[i] = 2; // up the tree
        } else if (def.burrows && hm >= 0 && this.wAlive[hm]) {
          const dx = this.wx[hm] - x;
          const dy = this.wy[hm] - y;
          if (dx * dx + dy * dy < 0.9) {
            this.shel[i] = 1;
            if (a === Act.Shelter && this.thrKind[i]) this.note(i, LogCode.Sheltered);
          }
        }
        break;
      }
      case Act.Hunt: {
        const j = this.tgt[i];
        if (j < 0 || !this.alive[j] || this.aid[j] !== this.tgtId[i]) break;
        if (this.hcool[i] > 0) break;
        const dx = this.x[j] - x;
        const dy = this.y[j] - y;
        const strike = def.strike * this.traits[i * N_TRAITS + Trait.Body];
        if (dx * dx + dy * dy > strike * strike) break;
        this.attempt(i, j);
        break;
      }
      case Act.Ambush: {
        const j = this.tgt[i];
        if (j < 0 || !this.alive[j] || this.aid[j] !== this.tgtId[i] || this.hcool[i] > 0) break;
        const dx = this.x[j] - x;
        const dy = this.y[j] - y;
        if (dx * dx + dy * dy <= def.strike * def.strike * 1.5) this.attempt(i, j);
        break;
      }
      case Act.Scavenge: {
        const k = this.carc[i];
        if (k < 0 || this.cmass[k] <= 0) break;
        const dx = this.cx[k] - x;
        const dy = this.cy[k] - y;
        if (dx * dx + dy * dy <= 2.25) {
          if (this.eat(i, k) > 0.05) this.note(i, LogCode.Scavenged);
        }
        break;
      }
      case Act.Mate:
        break; // pairing happens below for everyone; choosing Mate means seeking a partner
      case Act.Dig: {
        if (!def.burrows) break;
        // join a warren within reach; dig a new one only away from others and only
        // while the species has fewer than one warren per five animals
        let k = this.nearestWarren(x, y, s, 9);
        if (k < 0 && this.energy[i] > 0.35 && this.warrensOf(s) * 5 < this.counts[s]) {
          k = this.addWarren(x, y, s);
          if (k >= 0) {
            this.energy[i] -= 0.06;
            this.note(i, LogCode.Dug);
          }
        }
        if (k >= 0) this.home[i] = k;
        break;
      }
      case Act.Build: {
        if (this.carry[i] <= 0) break;
        const dk = nearestDam(this, x, y, 2);
        if (dk >= 0) {
          this.damHp[dk] = Math.min(1, this.damHp[dk] + 0.3);
          this.carry[i]--;
          this.rew[i] += 0.5;
          break;
        }
        if (nearestDam(this, x, y, 18) >= 0) break; // one dam per stretch of stream
        // build across an adjacent narrow channel
        for (let k = 0; k < 8; k++) {
          const nx = (x | 0) + [1, -1, 0, 0, 1, 1, -1, -1][k];
          const ny = (y | 0) + [0, 0, 1, -1, 1, -1, 1, -1][k];
          const nc = this.cellAt(nx, ny);
          if (nc >= 0 && isChannel(this, nc) && buildDam(this, nc) >= 0) {
            this.carry[i]--;
            this.rew[i] += 2;
            break;
          }
        }
        break;
      }
      case Act.Cache: {
        // squirrels bury acorns a few cells away; forgotten caches sprout into oaks
        const a = this.acorn[c];
        if (a > 0.02) {
          const amt = Math.min(0.06, a);
          this.acorn[c] -= amt;
          this.rRes.unit(this.scratch);
          const d = 2 + this.rRes.float() * 4;
          const tx = Math.floor(clamp(x + this.scratch.x * d, 0, this.w - 1));
          const ty = Math.floor(clamp(y + this.scratch.y * d, 0, this.h - 1));
          const tc = ty * this.w + tx;
          if (this.t.type[tc] === Cell.Grass) this.cache[tc] += amt;
          this.rew[i] += 0.15;
        }
        break;
      }
      case Act.Call: {
        this.energy[i] -= 0.001;
        const R = def.encoding === 'pack' ? 40 : 12;
        this.forEachNear(x, y, R, (j) => {
          if (this.sp[j] !== s || j === i) return;
          if (def.encoding === 'pack') {
            if (this.pack[j] === this.pack[i] && this.act[j] !== Act.Hunt) {
              this.gx[j] = x;
              this.gy[j] = y;
            }
          } else {
            this.alarm[j] = 8;
            this.alarmAir[j] = this.thrKind[i] === 2 ? 1 : 0;
          }
        });
        if (this.thrKind[i]) {
          this.rew[i] += 0.05;
          this.note(i, LogCode.Called);
        }
        break;
      }
      default:
        break;
    }

    // ready animals that meet pair up, whatever they were doing
    const j = this.mate[i];
    if (j >= 0 && this.alive[j] && this.sex[i] === 1 && this.gest[i] === 0) {
      const dx = this.x[j] - this.x[i];
      const dy = this.y[j] - this.y[i];
      if (dx * dx + dy * dy <= 16 && this.canBreed(i) && this.canBreed(j) && !(this.ceilingHit && this.isTopSpecies(s))) {
        this.gest[i] = Math.max(1, Math.round(def.gestationDays * TICKS_PER_DAY));
        for (let tr = 0; tr < N_TRAITS; tr++) this.ftraits[i * N_TRAITS + tr] = this.traits[j * N_TRAITS + tr];
        this.cool[j] = TICKS_PER_DAY * 2;
        this.rew[i] += 3;
        if (this.act[j] === Act.Mate) this.rew[j] += 3;
        this.note(i, LogCode.Mated);
        this.note(j, LogCode.Mated);
      }
    }
  }

  /** Is j out of reach of hunter species s? Burrows stop all but snakes; trees stop all but birds. */
  hiddenFrom(s: number, j: number): boolean {
    const hd = SPECIES[s];
    const cj = (this.y[j] | 0) * this.w + (this.x[j] | 0);
    if (this.t.type[cj] === Cell.Water) {
      // deep water shelters fish from everyone; any water shelters swimmers from land hunters
      if (SPECIES[this.sp[j]].aquatic && this.t.depth[cj] > 0.85) return true;
      if (!hd.swims && !hd.flying) return true;
    }
    const sh = this.shel[j];
    if (!sh) return false;
    if (sh === 1) return s !== Sp.Snake;
    return !SPECIES[s].flying;
  }

  forEachNear(x: number, y: number, r: number, fn: (j: number) => void): void {
    const r2 = r * r;
    const bx0 = Math.max(0, ((x - r) / BUCKET) | 0);
    const bx1 = Math.min(this.gw - 1, ((x + r) / BUCKET) | 0);
    const by0 = Math.max(0, ((y - r) / BUCKET) | 0);
    const by1 = Math.min(this.gh - 1, ((y + r) / BUCKET) | 0);
    for (let by = by0; by <= by1; by++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const b = by * this.gw + bx;
        for (let k = this.bStart[b]; k < this.bStart[b + 1]; k++) {
          const j = this.bItems[k];
          if (!this.alive[j]) continue;
          const dx = this.x[j] - x;
          const dy = this.y[j] - y;
          if (dx * dx + dy * dy <= r2) fn(j);
        }
      }
    }
  }

  private attempt(i: number, j: number): void {
    const s = this.sp[i];
    const def = SPECIES[s];
    const sj = this.sp[j];
    if (this.hiddenFrom(s, j)) return;
    let p = def.huntBase * HUNTS[s * NS + sj] * TUNE.huntMul;
    const n = this.huntersOn[j];
    if (def.encoding === 'pack') p *= Math.min(2.2, 1 + 0.35 * (n - 1));
    else p /= 1 + 0.4 * (n - 1); // hunters get in each other's way
    if (!this.isDay && def.active === 'day') p *= 0.15;
    if (this.isDay && def.active === 'night') p *= 0.5;
    const tj = j * N_TRAITS;
    const ratio = (def.speed * this.traits[i * N_TRAITS + Trait.Speed]) / (SPECIES[sj].speed * this.traits[tj + Trait.Speed]);
    p *= clamp(0.6 + 0.4 * ratio, 0.6, 1.6);
    p /= this.traits[tj + Trait.Body] * this.traits[tj + Trait.Body];
    if (this.act[j] === Act.Freeze) p *= 0.6;
    if (this.act[i] === Act.Ambush) p *= 1.6;
    if (this.age[j] < SPECIES[sj].maturityDays * TICKS_PER_DAY && SPECIES[sj].mass > 10) p *= 3; // fawns and kits are easy
    if (this.health[j] < 0.5) p *= 1.5;
    const c = (this.y[j] | 0) * this.w + (this.x[j] | 0);
    if (!def.flying) p *= 1 - 0.3 * this.grass[c]; // cover in long grass
    else if (this.canopy[c] > 0) p *= this.shel[j] === 2 ? 0.5 : 0.35; // tree cover against raptors
    this.huntTry[s]++;
    if (this.rRes.float() < p) {
      this.huntWin[s]++;
      this.killMatrix[s * NS + sj]++;
      const k = this.die(j, Cause.Predation);
      this.kills[i]++;
      this.rew[i] += 2.5;
      this.note(i, LogCode.Killed);
      if (k >= 0) this.eat(i, k);
      // handling time grows with the size of the kill
      this.hcool[i] = Math.max(1, Math.round(4 * Math.min(1, SPECIES[sj].mass / def.foodCap)));
      this.tgt[i] = -1;
      // the kill site becomes frightening
      this.scare(this.x[i], this.y[i], 3, 0.6);
    } else {
      this.hcool[i] = def.flying ? 2 : 4;
      this.energy[i] -= def.metab * 2;
      this.alarm[j] = 6;
      this.alarmAir[j] = def.flying ? 1 : 0;
      this.rew[j] += 0.5;
      this.note(j, LogCode.Escaped);
    }
  }

  scare(x: number, y: number, r: number, amt: number): void {
    const x0 = Math.max(0, Math.floor(x - r));
    const x1 = Math.min(this.w - 1, Math.floor(x + r));
    const y0 = Math.max(0, Math.floor(y - r));
    const y1 = Math.min(this.h - 1, Math.floor(y + r));
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const c = yy * this.w + xx;
        this.fear[c] = Math.min(1, this.fear[c] + amt);
      }
    }
  }

  private eat(i: number, k: number): number {
    const def = SPECIES[this.sp[i]];
    if (def.foodCap <= 0) return 0;
    const need = (1 - this.energy[i]) * def.foodCap;
    const amt = Math.min(need, this.cmass[k]);
    if (amt <= 0) return 0;
    this.cmass[k] -= amt;
    const gain = amt / def.foodCap;
    this.energy[i] += gain;
    this.hyd[i] = Math.min(1, this.hyd[i] + gain * 0.4);
    this.rew[i] += 3 * gain;
    if (this.cInf[k] && this.rRes.chance(0.3)) infect(this, i, this.cInf[k]);
    return gain;
  }

  private waterCount = -1;
  private waterCountVersion = -1;
  waterCells(): number {
    if (this.waterCountVersion !== this.waterVersion || this.waterCount < 0) {
      let n = 0;
      for (let c = 0; c < this.n; c++) if (this.t.type[c] === Cell.Water) n++;
      this.waterCount = n;
      this.waterCountVersion = this.waterVersion;
    }
    return this.waterCount;
  }

  /** Mean plant food in a disc around (x, y). */
  localPlant(x: number, y: number, r: number, def: SpeciesDef): number {
    let sum = 0;
    let n = 0;
    const x0 = Math.max(0, Math.floor(x - r));
    const x1 = Math.min(this.w - 1, Math.floor(x + r));
    const y0 = Math.max(0, Math.floor(y - r));
    const y1 = Math.min(this.h - 1, Math.floor(y + r));
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const dx = xx + 0.5 - x;
        const dy = yy + 0.5 - y;
        if (dx * dx + dy * dy > r * r) continue;
        const c = yy * this.w + xx;
        if ((this.t.type[c] === Cell.Water) !== def.aquatic) continue; // fish feed in water, the rest on land
        sum += this.plantAt(c, def);
        n++;
      }
    }
    return n ? sum / n : 0;
  }

  isTopSpecies(s: number): boolean {
    let top = 0;
    for (let k = 1; k < NS; k++) if (this.counts[k] > this.counts[top]) top = k;
    return top === s;
  }

  // ---------------------------------------------------------------------
  // upkeep: metabolism, rewards, deaths, pregnancies
  // ---------------------------------------------------------------------

  private upkeep(i: number): void {
    const s = this.sp[i];
    const def = SPECIES[s];
    const tb = i * N_TRAITS;
    if (this.seasonalDormancy(i, def)) return;
    const a = this.act[i];
    const speedT = this.traits[tb + Trait.Speed];
    const traitCost = (0.6 + 0.4 * speedT * speedT) * (0.85 + 0.15 * this.traits[tb + Trait.Sense]) * this.traits[tb + Trait.Body];
    let restMul = a === Act.Rest || a === Act.Freeze || a === Act.Shelter || a === Act.Ambush ? 0.6 : 1;
    if (this.shel[i] && this.warmth < -0.3) restMul = 0.45; // curled up underground through winter
    let metab = (def.encoding === 'prey' ? def.metab : def.metab * TUNE.predMetabMul) * TUNE.metabMul[s];
    if (ECTOTHERM[s]) metab *= clamp(0.3 + 0.35 * (this.warmth + 1), 0.3, 1); // cold-blooded: slow in the cold
    this.energy[i] -= metab * traitCost * restMul * this.metabMul * weatherMetabMul(this) + def.moveCost * this.moved[i];
    this.hyd[i] -= def.thirst * weatherThirstMul(this) * (this.warmth > 0.5 ? 1.2 : this.warmth < -0.5 ? 0.3 : 1); // snow is water in winter
    if (def.swims && this.t.type[(this.y[i] | 0) * this.w + (this.x[i] | 0)] === Cell.Water) this.hyd[i] = Math.min(1, this.hyd[i] + 0.2);
    if (this.energy[i] > 1) this.energy[i] = 1;
    if (this.hyd[i] > 1) this.hyd[i] = 1;
    this.age[i]++;
    if (this.cool[i] > 0) this.cool[i]--;
    if (this.hcool[i] > 0) this.hcool[i]--;
    if (this.alarm[i] > 0) this.alarm[i]--;

    this.rew[i] += 0.004;
    if (def.encoding !== 'prey' && def.encoding !== 'scavenger' && this.moved[i] > 0) {
      const c = (this.y[i] | 0) * this.w + (this.x[i] | 0);
      if (this.fear[c] < 0.6) this.fear[c] += 0.08;
    }
    if (def.encoding === 'prey' && this.thrKind[i]) {
      if (this.thrClose[i]) this.rew[i] -= 0.15;
      if (this.shel[i]) this.rew[i] += 0.08;
    }

    if (this.sick[i] > 0) {
      this.sick[i]++;
      this.health[i] -= 0.004;
      if (this.rLife.chance(0.0035)) {
        // recovered, and immune to this one from now on
        this.immune[i] |= 1 << this.path[i];
        this.sick[i] = 0;
        this.path[i] = 0;
      }
    } else if (this.health[i] < 1) this.health[i] = Math.min(1, this.health[i] + 0.002);
    const cc = (this.y[i] | 0) * this.w + (this.x[i] | 0);
    if (this.toxin[cc] > 0.05 && (a === Act.Drink || def.aquatic || (def.swims && this.t.type[cc] === Cell.Water))) {
      this.health[i] -= this.toxin[cc] * 0.06;
      this.poisoned = true;
    }
    if (this.fire[cc] && fireDanger(this, i)) {
      this.die(i, Cause.Fire);
      return;
    }

    // deaths
    if (this.energy[i] <= 0) {
      this.die(i, Cause.Starvation);
      return;
    }
    if (this.hyd[i] <= 0) {
      this.die(i, Cause.Thirst);
      return;
    }
    if (this.health[i] <= 0) {
      this.die(i, this.sick[i] ? Cause.Disease : Cause.Poison);
      return;
    }
    const life = def.lifeDays * TICKS_PER_DAY;
    const ag = this.age[i];
    if (ag > life * 0.8) {
      const f = ag / life;
      if (ag > life * 1.3 || this.rLife.float() < 0.0015 * f * f * f * f) {
        this.die(i, Cause.OldAge);
        return;
      }
    }

    if (this.gest[i] > 0) {
      this.gest[i]--;
      if (this.gest[i] === 0) this.births.push(i);
    }
  }

  /** Hibernation and migration. Returns true while the animal is dormant this tick. */
  private seasonalDormancy(i: number, def: SpeciesDef): boolean {
    const d = this.dormant[i];
    const cold = this.warmth < (def.migrates ? -0.35 : -0.45);
    if (!d) {
      if (!cold || !(def.hibernates || def.migrates)) return false;
      if (!this.rLife.chance(0.04)) return false; // departures spread over a few days
      this.flush(i);
      this.dormant[i] = def.migrates ? 2 : 1;
      this.shel[i] = 0;
      this.tgt[i] = -1;
      return true;
    }
    this.age[i]++;
    if (d === 1) {
      // torpor: a trickle of energy, no thirst
      this.energy[i] -= def.metab * 0.04;
      if (this.energy[i] <= 0) {
        this.dormant[i] = 0;
        this.die(i, Cause.Starvation);
        return true;
      }
    }
    if (!cold && this.rLife.chance(0.05)) {
      this.dormant[i] = 0;
      if (d === 2) {
        if (this.rLife.chance(0.08)) {
          this.die(i, Cause.Migration);
          return true;
        }
        // back in from a map edge
        const edge = this.rLife.int(4);
        const tx = edge === 0 ? 1 : edge === 1 ? this.w - 2 : this.rLife.range(1, this.w - 2);
        const ty = edge === 2 ? 1 : edge === 3 ? this.h - 2 : this.rLife.range(1, this.h - 2);
        this.x[i] = tx;
        this.y[i] = ty;
        this.energy[i] = Math.max(this.energy[i], 0.6);
        this.hyd[i] = 0.8;
      }
    }
    return true;
  }

  /** Kill an animal. Returns the carcass index (or -1). */
  die(i: number, cause: number): number {
    const s = this.sp[i];
    const def = SPECIES[s];
    this.rew[i] += cause === Cause.OldAge ? -0.5 : -8;
    this.flush(i);
    this.alive[i] = 0;
    this.dormant[i] = 0;
    this.counts[s]--;
    const lk = s * MAX_LINEAGES + this.lin[i];
    this.brains.members[lk]--;
    if (this.brains.members[lk] <= 0) {
      this.brains.members[lk] = 0;
      this.brains.retire(s, this.lin[i]);
    }
    this.dayDeaths[s * N_CAUSES + cause]++;
    this.freeList[this.freeTop++] = i;
    if (this.counts[s] === 0) this.events.push({ tick: this.tick, kind: 'extinct', sp: s });
    const mass = def.mass * (cause === Cause.Predation ? 1 : 0.7);
    return this.addCarcass(this.x[i], this.y[i], mass, s, this.sick[i] > 0 ? this.path[i] : 0);
  }

  private giveBirth(f: number): void {
    if (!this.alive[f]) return;
    const s = this.sp[f];
    const def = SPECIES[s];
    const tb = f * N_TRAITS;
    const litterT = this.traits[tb + Trait.Litter];
    const mean = def.litter * litterT * TUNE.litterMul[s] * (def.encoding === 'prey' ? TUNE.preyLitterMul : 1);
    let k = Math.floor(mean);
    if (this.rLife.float() < mean - k) k++;
    // carrying capacity: food and space around the mother thin the litter
    let survive: number;
    if (def.encoding === 'prey') {
      const c = (this.y[f] | 0) * this.w + (this.x[f] | 0);
      const q = this.crowdN[f] / (CROWD_K[s] * TUNE.crowdMul);
      survive = clamp((this.localPlant(this.x[f], this.y[f], 6, def) - TUNE.litterFoodLo) / TUNE.litterFoodSpan, 0, 1) / (1 + q * q);
      if (def.aquatic) survive *= Math.max(0, 1 - this.counts[s] / Math.min(2500, this.waterCells() * 0.2)); // what the water can hold
      void c;
    } else {
      // territory: enough prey per resident predator, or the young don't make it
      survive = clamp(this.preyN[f] / ((this.crowdN[f] + 1) * TUNE.preyPerPred[s]), 0.05, 1);
    }
    const total = this.totalAlive();
    let born = 0;
    for (let n = 0; n < k; n++) {
      if (!this.rLife.chance(survive)) continue;
      if (total + born >= PERF_CEILING) {
        if (!this.ceilingHit) this.events.push({ tick: this.tick, kind: 'ceiling', sp: s });
        this.ceilingHit = true;
        break;
      }
      let lineage = this.lin[f];
      if (this.rLife.chance(0.005)) {
        const slot = this.brains.freeSlot(s);
        const from = this.brains.lin[s][lineage];
        if (slot >= 0 && from) {
          this.brains.found(s, slot, from, this.tick, this.rBrain.int(360), () => this.rBrain.normal() * 0.15);
          lineage = slot;
          this.events.push({ tick: this.tick, kind: 'lineage', sp: s, v: slot });
        }
      }
      let px = this.x[f] + this.rLife.range(-0.8, 0.8);
      let py = this.y[f] + this.rLife.range(-0.8, 0.8);
      if (!this.passable(px, py, def)) {
        px = this.x[f];
        py = this.y[f];
      }
      const pup = this.spawn(s, px, py, lineage, this.aid[f]);
      if (pup < 0) break;
      born++;
      const pb = pup * N_TRAITS;
      for (let tr = 0; tr < N_TRAITS; tr++) {
        const [lo, hi] = TRAIT_RANGES[tr];
        const mid = (this.traits[tb + tr] + this.ftraits[tb + tr]) / 2;
        this.traits[pb + tr] = mid + this.rLife.normal() * 0.03 * (hi - lo);
      }
      this.clampTraits(pup);
      this.energy[pup] = clamp(0.8 - 0.3 * (litterT - 1), 0.35, 0.9);
      this.hyd[pup] = 0.8;
      this.home[pup] = this.home[f];
      this.pack[pup] = this.pack[f];
      if (def.encoding === 'pack' && this.rLife.chance(0.25)) this.pack[pup] = this.nextPack++ & 0xffff;
    }
    this.dayBirths[s] += born;
    if (born > 0) {
      this.energy[f] -= (def.encoding === 'prey' ? 0.04 : 0.08) * born;
      this.rew[f] += def.encoding === 'prey' ? 10 : 12;
      this.note(f, LogCode.GaveBirth);
    }
    this.cool[f] = Math.round(def.cooldownDays * TICKS_PER_DAY);
  }

  totalAlive(): number {
    let t = 0;
    for (let s = 0; s < NS; s++) t += this.counts[s];
    return t;
  }

  // =====================================================================
  // player actions (always via the log)
  // =====================================================================

  applyEvent(e: LogEvent): void {
    const a = e.a;
    switch (e.tool) {
      case 'release': {
        const [s, x, y, n] = a;
        const def = SPECIES[s];
        for (let k = 0; k < n; k++) {
          let px = x + this.rLife.range(-3, 3);
          let py = y + this.rLife.range(-3, 3);
          if (!this.passable(px, py, def)) {
            px = x;
            py = y;
            if (!this.passable(px, py, def)) continue;
          }
          let l = 0;
          let most = -1;
          for (let q = 0; q < MAX_LINEAGES; q++) {
            const m = this.brains.members[s * MAX_LINEAGES + q];
            if (this.brains.lin[s][q] && m > most) {
              most = m;
              l = q;
            }
          }
          if (!this.brains.lin[s][l]) {
            const prior = this.brains.prior(s, (st) => ACTION_SLOT[s * N_ACTIONS + rulesFromState(def, st)]);
            prior.visits.fill(60);
            prior.stateVisits.fill(60);
            this.brains.found(s, 0, prior, this.tick, this.rBrain.int(360), null);
            l = 0;
          }
          const i = this.spawn(s, px, py, l, 0);
          if (i < 0) break;
          this.age[i] = Math.floor(def.maturityDays * TICKS_PER_DAY * 1.2);
          this.energy[i] = 0.85;
          this.hyd[i] = 0.9;
          for (let tr = 0; tr < N_TRAITS; tr++) this.traits[i * N_TRAITS + tr] = this.baseTrait(tr) + this.rLife.normal() * 0.04;
          this.clampTraits(i);
          if (def.encoding === 'pack') this.pack[i] = n > 1 ? this.nextPack : this.nextPack++;
          if (def.burrows) this.home[i] = this.nearestWarren(px, py, s, 40);
        }
        if (def.encoding === 'pack' && n > 1) this.nextPack++;
        break;
      }
      case 'cull': {
        const [s, x, y, r] = a;
        const r2 = r * r;
        for (let i = 0; i < this.hw; i++) {
          if (!this.alive[i] || (s >= 0 && this.sp[i] !== s)) continue;
          const dx = this.x[i] - x;
          const dy = this.y[i] - y;
          if (dx * dx + dy * dy <= r2) this.die(i, Cause.Culled);
        }
        break;
      }
      case 'ignite': {
        const [x, y] = a;
        const c = this.cellAt(x, y);
        if (c >= 0 && !ignite(this, c, false)) {
          // try the nearest burnable cell
          for (let k = 0; k < 8; k++) {
            const c2 = this.cellAt(x + ((k % 3) - 1), y + (Math.floor(k / 3) - 1));
            if (c2 >= 0 && ignite(this, c2, false)) break;
          }
        }
        break;
      }
      case 'rain': {
        const [x, y, r] = a;
        this.weather = Weather.Rain;
        this.eachCell(x, y, r, (c) => {
          this.fire[c] = 0;
          if (this.t.grassCap[c] > 0) this.grass[c] = Math.min(this.t.grassCap[c], this.grass[c] + 0.15);
        });
        this.fireCells = this.fireCells.filter((c) => this.fire[c] > 0);
        break;
      }
      case 'drought':
        this.droughtUntil = this.tick + 28 * TICKS_PER_DAY;
        this.weather = Weather.Heat;
        break;
      case 'poison': {
        const [x, y] = a;
        let hit = 0;
        this.eachCell(x, y, 4, (c) => {
          if (this.t.type[c] === Cell.Water) {
            this.toxin[c] = 1;
            hit++;
          }
        });
        if (!hit) this.eachCell(x, y, 12, (c) => {
          if (this.t.type[c] === Cell.Water && hit < 12) {
            this.toxin[c] = 1;
            hit++;
          }
        });
        this.toxinActive = true;
        break;
      }
      case 'pesticide': {
        const [x, y, r] = a;
        this.eachCell(x, y, r, (c) => {
          this.insects[c] = 0;
          if (this.t.type[c] !== Cell.Water) this.toxin[c] = 1;
        });
        this.toxinActive = true;
        break;
      }
      case 'plant': {
        const [kind, x, y] = a;
        let planted = 0;
        this.eachCell(x, y, 5, (c) => {
          const ty = this.t.type[c];
          if (planted >= 14 || this.treeAt[c] >= 0 || this.wall[c]) return;
          const ok = kind === 1 ? (ty === Cell.Grass || ty === Cell.Sand || ty === Cell.Marsh) && this.t.waterDist[c] <= 4 : ty === Cell.Grass;
          if (ok && this.rEnv.chance(0.45) && addTree(this, c, kind, Stage.Sapling, 20) >= 0) planted++;
        });
        break;
      }
      case 'wall': {
        const [x0, y0, x1, y1] = a;
        const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
        for (let k = 0; k <= n; k++) {
          const x = Math.round(x0 + ((x1 - x0) * k) / n);
          const y = Math.round(y0 + ((y1 - y0) * k) / n);
          for (const [ox, oy] of [[0, 0], [1, 0], [0, 1]]) {
            const c = this.cellAt(x + ox, y + oy);
            if (c < 0 || this.t.type[c] === Cell.Water) continue;
            this.wall[c] = 1;
            this.grass[c] = 0;
            const tk = this.treeAt[c];
            if (tk >= 0) removeTree(this, tk);
          }
        }
        break;
      }
      case 'outbreak': {
        const [p, x, y] = a;
        if (p <= 0 || p >= PATHOGENS.length) break;
        let best = -1;
        let bd = 40 * 40;
        for (let i = 0; i < this.hw; i++) {
          if (!this.alive[i] || this.dormant[i] || !HOST[p * 16 + this.sp[i]]) continue;
          const d = (this.x[i] - x) ** 2 + (this.y[i] - y) ** 2;
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
        if (best >= 0 && infect(this, best, p)) this.events.push({ tick: this.tick, kind: 'outbreak', sp: this.sp[best], v: p });
        break;
      }
      case 'dam': {
        const [x, y] = a;
        let best = -1;
        let bd = 64;
        this.eachCell(x, y, 8, (c) => {
          if (!isChannel(this, c)) return;
          const d = ((c % this.w) + 0.5 - x) ** 2 + (Math.floor(c / this.w) + 0.5 - y) ** 2;
          if (d < bd) {
            bd = d;
            best = c;
          }
        });
        if (best >= 0) buildDam(this, best);
        break;
      }
      case 'breach': {
        const [x, y] = a;
        const dk = nearestDam(this, x, y, 12);
        if (dk >= 0) this.damHp[dk] = 0.0001; // fails at the next daily check
        break;
      }
      case 'food': {
        const [kind, x, y] = a;
        if (kind === 1) this.addCarcass(x, y, 40, Sp.Deer, 0);
        else this.eachCell(x, y, 4, (c) => {
          if (this.t.type[c] !== Cell.Water) this.berry[c] = 1;
        });
        break;
      }
      default:
        break;
    }
  }

  cellAt(x: number, y: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return -1;
    return yi * this.w + xi;
  }

  eachCell(x: number, y: number, r: number, fn: (c: number) => void): void {
    const x0 = Math.max(0, Math.floor(x - r));
    const x1 = Math.min(this.w - 1, Math.floor(x + r));
    const y0 = Math.max(0, Math.floor(y - r));
    const y1 = Math.min(this.h - 1, Math.floor(y + r));
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const dx = xx + 0.5 - x;
        const dy = yy + 0.5 - y;
        if (dx * dx + dy * dy <= r * r) fn(yy * this.w + xx);
      }
    }
  }

  // =====================================================================
  // snapshot / restore / hash
  // =====================================================================

  snapshot(): ArrayBuffer {
    const hwN = this.hw;
    const parts: { name: string; bytes: Uint8Array; ctor: string; len: number }[] = [];
    for (const { name, arr, stride } of this.agentArrays) {
      const sub = arr.subarray(0, hwN * stride);
      parts.push({ name, bytes: new Uint8Array(sub.buffer, sub.byteOffset, sub.byteLength), ctor: arr.constructor.name, len: sub.length });
    }
    for (const { name, arr } of this.fullArrays) {
      parts.push({ name, bytes: new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), ctor: arr.constructor.name, len: arr.length });
    }
    // brains
    const b = this.brains;
    for (const [name, arr] of [['b.members', b.members], ['b.founded', b.founded], ['b.rewardSum', b.rewardSum], ['b.rewardN', b.rewardN], ['b.hue', b.hue]] as [string, TA][]) {
      parts.push({ name, bytes: new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), ctor: arr.constructor.name, len: arr.length });
    }
    for (let s = 0; s < NS; s++) {
      for (let l = 0; l < MAX_LINEAGES; l++) {
        const lin = b.lin[s][l];
        if (!lin) continue;
        for (const [k, arr] of [['q', lin.q], ['v', lin.visits], ['sv', lin.stateVisits]] as [string, TA][]) {
          parts.push({ name: `L${s}.${l}.${k}`, bytes: new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), ctor: arr.constructor.name, len: arr.length });
        }
      }
    }
    const header = {
      tick: this.tick, nextId: this.nextId, nextPack: this.nextPack, hw: this.hw, freeTop: this.freeTop,
      wCount: this.wCount, cTop: this.cTop, ceilingHit: this.ceilingHit, trCount: this.trCount,
      weather: this.weather, windX: this.windX, windY: this.windY, windStrength: this.windStrength, droughtUntil: this.droughtUntil, toxinActive: this.toxinActive, damCount: this.damCount, waterVersion: this.waterVersion,
      rng: [this.rThink, this.rMove, this.rRes, this.rLife, this.rBrain, this.rEnv].map((r) => r.getState()),
      parts: [] as { name: string; ctor: string; len: number; off: number; bytes: number }[],
    };
    let off = 0;
    for (const p of parts) {
      header.parts.push({ name: p.name, ctor: p.ctor, len: p.len, off, bytes: p.bytes.byteLength });
      off += Math.ceil(p.bytes.byteLength / 8) * 8;
    }
    const hjson = new TextEncoder().encode(JSON.stringify(header));
    const hlen = Math.ceil((hjson.byteLength + 4) / 8) * 8;
    const out = new Uint8Array(hlen + off);
    new DataView(out.buffer).setUint32(0, hjson.byteLength, true);
    out.set(hjson, 4);
    for (let k = 0; k < parts.length; k++) out.set(parts[k].bytes, hlen + header.parts[k].off);
    return out.buffer;
  }

  restore(buf: ArrayBuffer): void {
    const u8 = new Uint8Array(buf);
    const hl = new DataView(buf).getUint32(0, true);
    const header = JSON.parse(new TextDecoder().decode(u8.subarray(4, 4 + hl)));
    const hlen = Math.ceil((hl + 4) / 8) * 8;
    this.tick = header.tick;
    this.nextId = header.nextId;
    this.nextPack = header.nextPack;
    this.freeTop = header.freeTop;
    this.wCount = header.wCount;
    this.cTop = header.cTop;
    this.ceilingHit = header.ceilingHit;
    this.trCount = header.trCount;
    this.weather = header.weather;
    this.windX = header.windX;
    this.windY = header.windY;
    this.windStrength = header.windStrength;
    this.droughtUntil = header.droughtUntil;
    this.toxinActive = header.toxinActive;
    this.damCount = header.damCount;
    this.waterVersion = header.waterVersion;
    [this.rThink, this.rMove, this.rRes, this.rLife, this.rBrain, this.rEnv].forEach((r, k) => r.setState(header.rng[k]));
    const byName = new Map<string, { ctor: string; len: number; off: number; bytes: number }>();
    for (const p of header.parts) byName.set(p.name, p);
    const view = (p: { len: number; off: number; bytes: number }, like: TA): TA => {
      const Ctor = like.constructor as unknown as { new (b: ArrayBuffer, o: number, l: number): TA };
      const copy = u8.slice(hlen + p.off, hlen + p.off + p.bytes);
      return new Ctor(copy.buffer, 0, p.len);
    };
    for (const { name, arr } of this.agentArrays) {
      arr.fill(0);
      const p = byName.get(name)!;
      arr.set(view(p, arr) as never);
    }
    this.hw = header.hw;
    for (const { name, arr } of this.fullArrays) {
      const p = byName.get(name)!;
      arr.set(view(p, arr) as never);
    }
    const b = this.brains;
    for (const [name, arr] of [['b.members', b.members], ['b.founded', b.founded], ['b.rewardSum', b.rewardSum], ['b.rewardN', b.rewardN], ['b.hue', b.hue]] as [string, TA][]) {
      arr.set(view(byName.get(name)!, arr) as never);
    }
    for (let s = 0; s < NS; s++) {
      for (let l = 0; l < MAX_LINEAGES; l++) {
        const pq = byName.get(`L${s}.${l}.q`);
        if (!pq) {
          b.lin[s][l] = null;
          continue;
        }
        const blank = b.blank(s);
        blank.q.set(view(pq, blank.q) as Float32Array);
        blank.visits.set(view(byName.get(`L${s}.${l}.v`)!, blank.visits) as Uint16Array);
        blank.stateVisits.set(view(byName.get(`L${s}.${l}.sv`)!, blank.stateVisits) as Uint16Array);
        b.lin[s][l] = blank;
      }
    }
    this.counts.fill(0);
    for (let i = 0; i < this.hw; i++) if (this.alive[i]) this.counts[this.sp[i]]++;
    this.wDirty = true;
    reindexTrees(this);
    reindexFire(this);
    this.updateEnv();
  }

  hash(): string {
    const u8 = new Uint8Array(this.snapshot());
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (let k = 0; k < u8.length; k++) {
      h1 = Math.imul(h1 ^ u8[k], 0x01000193);
      h2 = Math.imul(h2 ^ u8[k], 0x5bd1e995);
    }
    return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
  }
}
