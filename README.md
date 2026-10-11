# Thicket

A live, seeded ecosystem of 16 species that learn and evolve while you watch, meddle and rewind. Same seed plus the same actions always gives the same world, so every ending can be shared as a link.

Build spec: https://claude.ai/code/artifact/85ba2b94-f241-4ed8-a299-730e80206597 · Progress: [PROGRESS.md](PROGRESS.md)

## Run it

```bash
npm install
npm run dev        # http://localhost:5199
npm run build      # static site in dist/
```

## Check it

```bash
npm test                 # encodings, determinism, snapshot/restore, log replay
npm run check:det        # lint: no Math.random / Date / transcendental Math in src/sim
npx tsx scripts/verify-link.ts '<share link>'   # replay a link headless and compare hashes
```

## Tune it

```bash
npm run sim -- 140 7 valley wild           # one world, weekly populations, causes of death, hunt stats
npm run balance -- 8 224 learned valley    # 8 seeds in parallel: survival, rates per capita, extinction days
SIM_DIR=/tmp/simcopy npx tsx scripts/tune.ts 40 6 336   # hill-climb the TUNE knobs on a frozen copy
```

Balance levers: `src/sim/species.ts` (per-species stats, `TUNE`, `SPRINT`, `CROWD_K`) and `src/sim/world.ts`. Pass `policy: 'rules'` to a `World` to swap brains for the hand-written reflexes, which separates mechanics bugs from learning problems.

## How it works

| Part | File |
| --- | --- |
| Tick pipeline, perception, motor control, contests, life and death, snapshots | `src/sim/world.ts` |
| Species data, balance knobs | `src/sim/species.ts` |
| State encodings, Q-learning, bloodlines | `src/sim/brain.ts` |
| Trees, acorns, caches, insects, berries, algae | `src/sim/ecology.ts` |
| Weather, fire, disease, toxins | `src/sim/hazards.ts` |
| Beavers, dams, ponds, marsh | `src/sim/beavers.ts` |
| Terrain presets and water fields | `src/sim/terrain.ts` |
| Deterministic PRNG streams and maths | `src/sim/rng.ts`, `src/sim/detmath.ts` |
| Worker: live loop, action log, checkpoints, rewind, stats | `src/sim/worker.ts` |
| Canvas renderer, layered terrain, sprites | `src/render/` |
| UI: chart, timeline, narrator, share links, clips, challenges | `src/ui/`, `src/main.ts` |

One tick is one hour; a year is 4 seasons × 28 days. Every animal perceives, encodes its state into bins, picks an action from its bloodline's Q-table, moves, and has contests (hunts, grazing, mating) resolved in a seeded shuffle. Learning uses 6-step returns. Young inherit a 7-trait genome with mutation.
