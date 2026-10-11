// Challenges: a fixed world, a goal, and a budget of interventions.

import type { Preset } from '../sim/terrain';
import { SPECIES } from '../sim/species';

export interface ChallengeCtx {
  day: number;
  counts: number[];
  startCounts: number[];
  oaks: number;
  startOaks: number;
  sick: number[];
  used: number;
}

export interface Challenge {
  id: string;
  title: string;
  goal: string;
  seed: number;
  preset: Preset;
  budget: number;
  /** Tools that may be used; anything else is locked. */
  allow: string[];
  /** Actions logged at tick 0 to set the scene. */
  setup: { tool: string; a: number[] }[];
  check(c: ChallengeCtx): { status: 'running' | 'won' | 'lost'; progress: string; why?: string };
}

const ALL_TOOLS = ['release', 'cull', 'ignite', 'rain', 'drought', 'poison', 'pesticide', 'plant', 'wall', 'outbreak', 'food', 'dam'];

export const CHALLENGES: Challenge[] = [
  {
    id: 'all-present',
    title: 'Nobody goes extinct',
    goal: 'Keep every species alive for one full year (112 days).',
    seed: 4242,
    preset: 'valley',
    budget: 12,
    allow: ALL_TOOLS,
    setup: [],
    check(c) {
      const lost = SPECIES.filter((s) => c.startCounts[s.id] > 0 && c.counts[s.id] === 0);
      if (lost.length) return { status: 'lost', progress: '', why: `The ${lost[0].plural.toLowerCase()} died out on day ${c.day}.` };
      if (c.day >= 112) return { status: 'won', progress: 'All species made it through the year.' };
      const weakest = SPECIES.filter((s) => c.startCounts[s.id] > 0).sort((a, b) => c.counts[a.id] / c.startCounts[a.id] - c.counts[b.id] / c.startCounts[b.id])[0];
      return { status: 'running', progress: `Day ${c.day} of 112. Most at risk: ${weakest.plural.toLowerCase()} (${c.counts[weakest.id]}).` };
    },
  },
  {
    id: 'regrow-forest',
    title: 'Regrow the forest',
    goal: 'Grow the number of mature oaks by 15% within two years, without culling anything.',
    seed: 1717,
    preset: 'lakes',
    budget: 10,
    allow: ALL_TOOLS.filter((t) => t !== 'cull' && t !== 'plant'),
    setup: [],
    check(c) {
      const target = Math.ceil(c.startOaks * 1.15);
      if (c.oaks >= target && c.day > 7) return { status: 'won', progress: `${c.oaks} mature oaks, up from ${c.startOaks}.` };
      if (c.day >= 224) return { status: 'lost', progress: '', why: `Two years passed with ${c.oaks} mature oaks; the goal was ${target}.` };
      return { status: 'running', progress: `Mature oaks: ${c.oaks} of ${target} (started at ${c.startOaks}). Day ${c.day} of 224.` };
    },
  },
  {
    id: 'predators-only',
    title: 'Plague, predators only',
    goal: 'Rabbit plague has broken out. End it within 40 days using only released predators, and keep rabbits alive.',
    seed: 9090,
    preset: 'plain',
    budget: 6,
    allow: ['release'],
    setup: [
      { tool: 'outbreak', a: [1, 192, 108] },
      { tool: 'outbreak', a: [1, 100, 60] },
      { tool: 'outbreak', a: [1, 290, 150] },
    ],
    check(c) {
      if (c.counts[0] === 0) return { status: 'lost', progress: '', why: 'The rabbits are gone, and the plague with them.' };
      if (c.day >= 3 && c.sick[0] === 0) return { status: 'won', progress: `No sick rabbits left on day ${c.day}.` };
      if (c.day >= 40) return { status: 'lost', progress: '', why: `Day 40 came with ${c.sick[0]} rabbits still sick.` };
      return { status: 'running', progress: `${c.sick[0]} sick rabbits. Day ${c.day} of 40.` };
    },
  },
  {
    id: 'save-frogs',
    title: 'Save the frogs',
    goal: 'Frogs are usually first to go. Keep them alive for two years.',
    seed: 3131,
    preset: 'valley',
    budget: 8,
    allow: ALL_TOOLS,
    setup: [],
    check(c) {
      if (c.counts[5] === 0) return { status: 'lost', progress: '', why: `The last frog died on day ${c.day}.` };
      if (c.day >= 224) return { status: 'won', progress: `${c.counts[5]} frogs after two years.` };
      return { status: 'running', progress: `${c.counts[5]} frogs. Day ${c.day} of 224.` };
    },
  },
  {
    id: 'no-wolves',
    title: 'A year without wolves',
    goal: 'The wolves are gone. Keep at least 90% of the mature oaks standing for a year, without bringing wolves back.',
    seed: 5150,
    preset: 'valley',
    budget: 10,
    allow: ALL_TOOLS,
    setup: [{ tool: 'cull', a: [13, 192, 108, 400] }],
    check(c) {
      if (c.counts[13] > 0 && c.day > 0) return { status: 'lost', progress: '', why: 'Wolves came back. The point was to manage without them.' };
      const floor = Math.floor(c.startOaks * 0.9);
      if (c.oaks < floor && c.day > 1) return { status: 'lost', progress: '', why: `Mature oaks fell to ${c.oaks}, below ${floor}, on day ${c.day}.` };
      if (c.day >= 112) return { status: 'won', progress: `${c.oaks} mature oaks still standing after a year.` };
      return { status: 'running', progress: `Mature oaks ${c.oaks} (floor ${floor}). Deer ${c.counts[3]}. Day ${c.day} of 112.` };
    },
  },
];
