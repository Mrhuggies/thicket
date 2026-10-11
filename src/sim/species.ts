// Species data. Behaviour lives in world.ts; everything tunable lives here.

export const enum Sp {
  Rabbit = 0,
  Mouse,
  Squirrel,
  Deer,
  Beaver,
  Frog,
  Fish,
  Fox,
  Cat,
  Hawk,
  Owl,
  Snake,
  Heron,
  Wolf,
  Bear,
  Vulture,
}
export const N_SPECIES = 16;

export const enum Act {
  Forage = 0,
  Drink,
  Shelter,
  Flee,
  Freeze,
  Hunt,
  Ambush,
  Scavenge,
  Mate,
  Rest,
  Explore,
  Dig,
  Cache,
  Build,
  Call,
}
export const N_ACTIONS = 15;
export const ACTION_NAMES = [
  'Forage', 'Drink', 'Shelter', 'Flee', 'Freeze', 'Hunt', 'Ambush', 'Scavenge',
  'Mate', 'Rest', 'Explore', 'Dig', 'Cache', 'Build', 'Call',
];

export type Encoding = 'prey' | 'predator' | 'pack' | 'scavenger';
export type Active = 'day' | 'night' | 'twilight' | 'any';
export type BreedSeason = 'any' | 'spring' | 'warm';

/** Plant foods a grazer can take from the map layers. */
export const enum Food {
  Grass = 1,
  Shrub = 2,
  Acorn = 4,
  Willow = 8,
  Algae = 16,
  Insect = 32,
  Berry = 64,
}

export interface SpeciesDef {
  id: Sp;
  name: string;
  plural: string;
  encoding: Encoding;
  /** Implemented and placed in new worlds. */
  enabled: boolean;
  speed: number; // cells per tick at full pace
  sense: number; // cells
  lifeDays: number;
  maturityDays: number;
  gestationDays: number;
  cooldownDays: number; // after a birth before breeding again
  litter: number; // mean young per birth
  breeds: BreedSeason;
  mass: number; // kg, sets carcass size
  metab: number; // energy fraction burned per tick at rest
  moveCost: number; // energy fraction per cell moved
  thirst: number; // hydration lost per tick
  foods: number; // Food bitmask for grazers
  bite: number; // plant units taken per tick
  plantEff: number; // energy per plant unit
  foodCap: number; // kg of meat that fills energy 0 → 1 (meat eaters)
  prey: Partial<Record<Sp, number>>; // catchability per prey species
  huntBase: number;
  strike: number; // cells
  flying: boolean;
  swims: boolean;
  aquatic: boolean; // water only
  burrows: boolean; // shelters in warrens
  active: Active;
  hibernates: boolean;
  migrates: boolean;
  start: number; // River valley starting count
  size: number; // render size in cells
  color: string;
  actions: Act[];
}

const PREY_ACTIONS = [Act.Forage, Act.Drink, Act.Shelter, Act.Flee, Act.Freeze, Act.Mate, Act.Rest, Act.Dig, Act.Call];

export const SPECIES: SpeciesDef[] = [
  {
    id: Sp.Rabbit, name: 'Rabbit', plural: 'Rabbits', encoding: 'prey', enabled: true,
    speed: 2.3, sense: 18, lifeDays: 170, maturityDays: 15, gestationDays: 6, cooldownDays: 8, litter: 4, breeds: 'warm',
    mass: 1.5, metab: 0.0095, moveCost: 0.0006, thirst: 0.003,
    foods: Food.Grass | Food.Shrub, bite: 0.06, plantEff: 0.9, foodCap: 0, prey: {}, huntBase: 0, strike: 0,
    flying: false, swims: false, aquatic: false, burrows: true, active: 'twilight', hibernates: false, migrates: false,
    start: 600, size: 1.7, color: '#c9b79c',
    actions: PREY_ACTIONS,
  },
  {
    id: Sp.Mouse, name: 'Mouse', plural: 'Mice', encoding: 'prey', enabled: true,
    speed: 2.0, sense: 9, lifeDays: 45, maturityDays: 14, gestationDays: 5, cooldownDays: 9, litter: 3, breeds: 'warm',
    mass: 0.05, metab: 0.013, moveCost: 0.0008, thirst: 0.0025,
    foods: Food.Grass | Food.Acorn, bite: 0.01, plantEff: 3.2, foodCap: 0, prey: {}, huntBase: 0, strike: 0,
    flying: false, swims: false, aquatic: false, burrows: true, active: 'night', hibernates: false, migrates: false,
    start: 800, size: 1.0, color: '#8d8478',
    actions: [Act.Forage, Act.Drink, Act.Shelter, Act.Flee, Act.Freeze, Act.Mate, Act.Rest, Act.Dig],
  },
  {
    id: Sp.Squirrel, name: 'Squirrel', plural: 'Squirrels', encoding: 'prey', enabled: true,
    speed: 2.2, sense: 14, lifeDays: 220, maturityDays: 30, gestationDays: 8, cooldownDays: 45, litter: 3, breeds: 'warm',
    mass: 0.5, metab: 0.011, moveCost: 0.0007, thirst: 0.003,
    foods: Food.Acorn | Food.Berry | Food.Grass, bite: 0.03, plantEff: 1.6, foodCap: 0, prey: {}, huntBase: 0, strike: 0,
    flying: false, swims: false, aquatic: false, burrows: false, active: 'day', hibernates: false, migrates: false,
    start: 150, size: 1.25, color: '#b0623a',
    actions: [Act.Forage, Act.Drink, Act.Shelter, Act.Flee, Act.Freeze, Act.Mate, Act.Rest, Act.Cache, Act.Call],
  },
  {
    id: Sp.Deer, name: 'Deer', plural: 'Deer', encoding: 'prey', enabled: true,
    speed: 3.4, sense: 24, lifeDays: 560, maturityDays: 100, gestationDays: 30, cooldownDays: 70, litter: 2.0, breeds: 'spring',
    mass: 60, metab: 0.0055, moveCost: 0.0003, thirst: 0.005,
    foods: Food.Grass | Food.Shrub, bite: 0.14, plantEff: 0.26, foodCap: 0, prey: {}, huntBase: 0, strike: 0,
    flying: false, swims: false, aquatic: false, burrows: false, active: 'twilight', hibernates: false, migrates: false,
    start: 300, size: 3.2, color: '#a8754a',
    actions: [Act.Forage, Act.Drink, Act.Shelter, Act.Flee, Act.Freeze, Act.Mate, Act.Rest, Act.Explore, Act.Call],
  },
  {
    id: Sp.Beaver, name: 'Beaver', plural: 'Beavers', encoding: 'prey', enabled: true,
    speed: 1.4, sense: 10, lifeDays: 450, maturityDays: 100, gestationDays: 14, cooldownDays: 100, litter: 4, breeds: 'spring',
    mass: 20, metab: 0.006, moveCost: 0.0005, thirst: 0.004,
    foods: Food.Willow | Food.Algae | Food.Shrub, bite: 0.08, plantEff: 0.4, foodCap: 0, prey: {}, huntBase: 0, strike: 0,
    flying: false, swims: true, aquatic: false, burrows: false, active: 'night', hibernates: false, migrates: false,
    start: 12, size: 2.0, color: '#6b4a2e',
    actions: [Act.Forage, Act.Drink, Act.Shelter, Act.Flee, Act.Mate, Act.Rest, Act.Build, Act.Explore],
  },
  {
    id: Sp.Frog, name: 'Frog', plural: 'Frogs', encoding: 'prey', enabled: true,
    speed: 1.0, sense: 6, lifeDays: 170, maturityDays: 25, gestationDays: 5, cooldownDays: 100, litter: 26, breeds: 'spring',
    mass: 0.05, metab: 0.008, moveCost: 0.0008, thirst: 0.008,
    foods: Food.Insect, bite: 0.01, plantEff: 3, foodCap: 0, prey: {}, huntBase: 0, strike: 0,
    flying: false, swims: true, aquatic: false, burrows: false, active: 'night', hibernates: true, migrates: false,
    start: 300, size: 0.9, color: '#5f8a3c',
    actions: [Act.Forage, Act.Drink, Act.Shelter, Act.Flee, Act.Freeze, Act.Mate, Act.Rest],
  },
  {
    id: Sp.Fish, name: 'Fish', plural: 'Fish', encoding: 'prey', enabled: true,
    speed: 2.5, sense: 8, lifeDays: 110, maturityDays: 30, gestationDays: 5, cooldownDays: 100, litter: 10, breeds: 'warm',
    mass: 0.3, metab: 0.007, moveCost: 0.0004, thirst: 0,
    foods: Food.Algae | Food.Insect, bite: 0.02, plantEff: 1.5, foodCap: 0, prey: {}, huntBase: 0, strike: 0,
    flying: false, swims: true, aquatic: true, burrows: false, active: 'any', hibernates: false, migrates: false,
    start: 600, size: 1.1, color: '#9fb4c0',
    actions: [Act.Forage, Act.Shelter, Act.Flee, Act.Mate, Act.Rest, Act.Explore],
  },
  {
    id: Sp.Fox, name: 'Fox', plural: 'Foxes', encoding: 'predator', enabled: true,
    speed: 3.2, sense: 30, lifeDays: 340, maturityDays: 70, gestationDays: 12, cooldownDays: 80, litter: 4, breeds: 'warm',
    mass: 6, metab: 0.0056, moveCost: 0.0004, thirst: 0.006,
    foods: 0, bite: 0, plantEff: 0, foodCap: 3,
    prey: { [Sp.Rabbit]: 1, [Sp.Mouse]: 1.1, [Sp.Squirrel]: 0.6, [Sp.Frog]: 0.5 }, huntBase: 0.35, strike: 1.6,
    flying: false, swims: false, aquatic: false, burrows: false, active: 'twilight', hibernates: false, migrates: false,
    start: 40, size: 2.2, color: '#d0672f',
    actions: [Act.Hunt, Act.Scavenge, Act.Drink, Act.Flee, Act.Mate, Act.Rest, Act.Explore],
  },
  {
    id: Sp.Cat, name: 'Cat', plural: 'Cats', encoding: 'predator', enabled: false,
    speed: 2.8, sense: 14, lifeDays: 340, maturityDays: 60, gestationDays: 10, cooldownDays: 60, litter: 4, breeds: 'any',
    mass: 4, metab: 0.0075, moveCost: 0.0004, thirst: 0.006,
    foods: 0, bite: 0, plantEff: 0, foodCap: 1.2,
    prey: { [Sp.Mouse]: 1.3, [Sp.Frog]: 1, [Sp.Squirrel]: 0.7 }, huntBase: 0.6, strike: 1.4,
    flying: false, swims: false, aquatic: false, burrows: false, active: 'any', hibernates: false, migrates: false,
    start: 0, size: 1.8, color: '#5a5a5a',
    actions: [Act.Hunt, Act.Ambush, Act.Drink, Act.Flee, Act.Mate, Act.Rest, Act.Explore],
  },
  {
    id: Sp.Hawk, name: 'Hawk', plural: 'Hawks', encoding: 'predator', enabled: true,
    speed: 5.76, sense: 34, lifeDays: 450, maturityDays: 112, gestationDays: 14, cooldownDays: 100, litter: 2, breeds: 'spring',
    mass: 1.2, metab: 0.007, moveCost: 0.0002, thirst: 0.005,
    foods: 0, bite: 0, plantEff: 0, foodCap: 0.6,
    prey: { [Sp.Mouse]: 1.1, [Sp.Rabbit]: 0.65, [Sp.Squirrel]: 0.8, [Sp.Snake]: 0.2, [Sp.Frog]: 0.35 }, huntBase: 0.3, strike: 2,
    flying: true, swims: false, aquatic: false, burrows: false, active: 'day', hibernates: false, migrates: false,
    start: 14, size: 2.3, color: '#7a5634',
    actions: [Act.Hunt, Act.Scavenge, Act.Drink, Act.Mate, Act.Rest, Act.Explore],
  },
  {
    id: Sp.Owl, name: 'Owl', plural: 'Owls', encoding: 'predator', enabled: true,
    speed: 4.5, sense: 20, lifeDays: 450, maturityDays: 100, gestationDays: 14, cooldownDays: 100, litter: 3, breeds: 'spring',
    mass: 1.0, metab: 0.0075, moveCost: 0.0002, thirst: 0.005,
    foods: 0, bite: 0, plantEff: 0, foodCap: 0.3,
    prey: { [Sp.Mouse]: 1.3, [Sp.Frog]: 0.35, [Sp.Rabbit]: 0.35 }, huntBase: 0.4, strike: 2,
    flying: true, swims: false, aquatic: false, burrows: false, active: 'night', hibernates: false, migrates: false,
    start: 12, size: 2.0, color: '#b9a27f',
    actions: [Act.Hunt, Act.Drink, Act.Mate, Act.Rest, Act.Explore],
  },
  {
    id: Sp.Snake, name: 'Snake', plural: 'Snakes', encoding: 'predator', enabled: true,
    speed: 1.0, sense: 6, lifeDays: 340, maturityDays: 60, gestationDays: 20, cooldownDays: 100, litter: 8, breeds: 'warm',
    mass: 0.5, metab: 0.003, moveCost: 0.0006, thirst: 0.005,
    foods: 0, bite: 0, plantEff: 0, foodCap: 0.3,
    prey: { [Sp.Mouse]: 1.2, [Sp.Frog]: 0.4, [Sp.Rabbit]: 0.3 }, huntBase: 0.5, strike: 1.5,
    flying: false, swims: true, aquatic: false, burrows: false, active: 'day', hibernates: true, migrates: false,
    start: 60, size: 2.2, color: '#6d7a3a',
    actions: [Act.Ambush, Act.Hunt, Act.Drink, Act.Shelter, Act.Mate, Act.Rest],
  },
  {
    id: Sp.Heron, name: 'Heron', plural: 'Herons', encoding: 'predator', enabled: true,
    speed: 4.0, sense: 16, lifeDays: 450, maturityDays: 112, gestationDays: 14, cooldownDays: 100, litter: 3, breeds: 'spring',
    mass: 2, metab: 0.0085, moveCost: 0.0002, thirst: 0.004,
    foods: 0, bite: 0, plantEff: 0, foodCap: 0.6,
    prey: { [Sp.Fish]: 1.1, [Sp.Frog]: 0.5, [Sp.Snake]: 0.25, [Sp.Mouse]: 0.6 }, huntBase: 0.4, strike: 1.8,
    flying: true, swims: false, aquatic: false, burrows: false, active: 'day', hibernates: false, migrates: true,
    start: 10, size: 2.4, color: '#8e9aa6',
    actions: [Act.Hunt, Act.Ambush, Act.Drink, Act.Mate, Act.Rest, Act.Explore],
  },
  {
    id: Sp.Wolf, name: 'Wolf', plural: 'Wolves', encoding: 'pack', enabled: true,
    speed: 3.6, sense: 40, lifeDays: 450, maturityDays: 112, gestationDays: 16, cooldownDays: 100, litter: 5, breeds: 'spring',
    mass: 40, metab: 0.005, moveCost: 0.0002, thirst: 0.006,
    foods: 0, bite: 0, plantEff: 0, foodCap: 15,
    prey: { [Sp.Deer]: 0.5, [Sp.Beaver]: 0.35, [Sp.Rabbit]: 0.4, [Sp.Fox]: 0.25 }, huntBase: 0.4, strike: 1.8,
    flying: false, swims: false, aquatic: false, burrows: false, active: 'twilight', hibernates: false, migrates: false,
    start: 12, size: 2.8, color: '#7d7f86',
    actions: [Act.Hunt, Act.Scavenge, Act.Drink, Act.Mate, Act.Rest, Act.Explore, Act.Call],
  },
  {
    id: Sp.Bear, name: 'Bear', plural: 'Bears', encoding: 'predator', enabled: true,
    speed: 2.6, sense: 28, lifeDays: 900, maturityDays: 224, gestationDays: 40, cooldownDays: 200, litter: 2, breeds: 'spring',
    mass: 200, metab: 0.005, moveCost: 0.0002, thirst: 0.006,
    foods: Food.Berry | Food.Acorn | Food.Shrub, bite: 0.12, plantEff: 0.15, foodCap: 30,
    prey: { [Sp.Fish]: 0.6, [Sp.Deer]: 0.12, [Sp.Beaver]: 0.15, [Sp.Wolf]: 0.04 }, huntBase: 0.3, strike: 1.8,
    flying: false, swims: true, aquatic: false, burrows: false, active: 'day', hibernates: true, migrates: false,
    start: 8, size: 3.6, color: '#4d3426',
    actions: [Act.Hunt, Act.Forage, Act.Scavenge, Act.Drink, Act.Mate, Act.Rest, Act.Explore],
  },
  {
    id: Sp.Vulture, name: 'Vulture', plural: 'Vultures', encoding: 'scavenger', enabled: true,
    speed: 6.0, sense: 60, lifeDays: 670, maturityDays: 150, gestationDays: 20, cooldownDays: 110, litter: 1, breeds: 'spring',
    mass: 7, metab: 0.0075, moveCost: 0.0001, thirst: 0.005,
    foods: 0, bite: 0, plantEff: 0, foodCap: 2,
    prey: {}, huntBase: 0, strike: 0,
    flying: true, swims: false, aquatic: false, burrows: false, active: 'day', hibernates: false, migrates: true,
    start: 10, size: 2.8, color: '#3d3330',
    actions: [Act.Scavenge, Act.Drink, Act.Mate, Act.Rest, Act.Explore],
  },
];

/** hunts[a * N + b] = catchability when a hunts b (0 if not). */
export const HUNTS = new Float32Array(N_SPECIES * N_SPECIES);
for (const s of SPECIES) for (const [k, v] of Object.entries(s.prey)) HUNTS[s.id * N_SPECIES + Number(k)] = v as number;

/** Action index within a species' mask, or -1. */
export const ACTION_SLOT = new Int8Array(N_SPECIES * N_ACTIONS).fill(-1);
for (const s of SPECIES) s.actions.forEach((a, i) => (ACTION_SLOT[s.id * N_ACTIONS + a] = i));

/** Hours of full sprint before tiring. */
export const SPRINT: number[] = [4, 3, 3, 5, 2, 2, 6, 6, 3, 12, 12, 2, 10, 30, 4, 12];
/** Local crowding (same species within 4 cells) at which half of each litter is lost. */
export const CROWD_K: number[] = [4, 2, 5, 9, 4, 10, 2.5, 3, 3, 2, 2, 4, 3, 6, 2, 4];

/** Global balance knobs. Constant during a run (part of the engine version); the balance
 *  search script adjusts them between runs. */
export const TUNE = {
  grassRate: 0.0011,
  winterGrow: 0.6565,
  litterFoodLo: 0.03141, // local grass below this: no young survive
  litterFoodSpan: 0.2275, // … and all survive above lo + span
  crowdMul: 1.517,
  huntMul: 1.1,
  predMetabMul: 0.75,
  preyLitterMul: 1.026,
  /** Per-species multipliers on litter size and metabolism (searched by scripts/tune.ts). */
  litterMul: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] as number[],
  metabMul: [1, 1, 1, 1, 1, 1, 1, 1, 1, 0.85, 0.85, 1, 0.55, 0.62, 1, 1] as number[],
  /** Prey animals per predator of the same species in range for its young to survive. */
  preyPerPred: [0, 0, 0, 0, 0, 0, 0, 100, 100, 80, 80, 3, 8, 48, 10, 1] as number[],
};

export const isMeatEater = (s: SpeciesDef) => s.foodCap > 0;
