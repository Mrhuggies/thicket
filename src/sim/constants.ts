export const ENGINE_VERSION = 1;

export const TICKS_PER_DAY = 24;
export const DAYS_PER_SEASON = 28;
export const SEASONS_PER_YEAR = 4;
export const DAYS_PER_YEAR = DAYS_PER_SEASON * SEASONS_PER_YEAR; // 112
export const TICKS_PER_YEAR = DAYS_PER_YEAR * TICKS_PER_DAY; // 2,688
export const CHECKPOINT_TICKS = 7 * TICKS_PER_DAY; // 168

export const CAPACITY = 16384; // agent slots
export const PERF_CEILING = 12000; // total animals before births pause
export const BUCKET = 16; // spatial hash bucket size in cells

export const MAX_WARRENS = 2048;
export const MAX_CARCASSES = 4096;
export const MAX_TREES = 8192;
export const MAX_DAMS = 64;
export const MAX_LINEAGES = 6;

export const N_STEP = 6;
export const GAMMA = 0.99;
export const N_TRAITS = 7;
export const LOG_LEN = 8;

export const SEASON_NAMES = ['Spring', 'Summer', 'Autumn', 'Winter'] as const;

export const enum Cell {
  Water = 0,
  Sand = 1,
  Grass = 2,
  Rock = 3,
  Marsh = 4,
}

export const enum Cause {
  Starvation = 0,
  Thirst = 1,
  Predation = 2,
  OldAge = 3,
  Disease = 4,
  Fire = 5,
  Culled = 6,
  Poison = 7,
  Migration = 8,
}
export const CAUSE_NAMES = ['starvation', 'thirst', 'predation', 'old age', 'disease', 'fire', 'culled', 'poison', 'lost migrating'];
export const N_CAUSES = 9;

export const enum Tree {
  Oak = 0,
  Willow = 1,
}
export const enum Stage {
  Seed = 0,
  Sapling = 1,
  Mature = 2,
  Snag = 3,
}

/** Trait slots in the per-animal genome. */
export const enum Trait {
  Speed = 0,
  Sense = 1,
  Boldness = 2,
  Litter = 3,
  Body = 4,
  Night = 5,
  Coat = 6,
}
export const TRAIT_NAMES = ['Speed', 'Sense range', 'Boldness', 'Litter size', 'Body size', 'Night shift', 'Coat shade'];
export const TRAIT_RANGES: [number, number][] = [
  [0.75, 1.25],
  [0.75, 1.25],
  [0, 1],
  [0.6, 1.6],
  [0.8, 1.25],
  [0, 1],
  [0, 1],
];
