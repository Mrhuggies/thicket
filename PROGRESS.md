# Thicket build progress

Spec: https://claude.ai/code/artifact/85ba2b94-f241-4ed8-a299-730e80206597
Run: `npm run dev` (port 5199; Desktop launch.json entry "thicket"). Tests: `npm test`. Lint: `npm run check:det`.
Headless: `npm run sim -- days seed preset instinct [rules]`, `npm run balance -- seeds days policy preset`, `npm run train -- worlds days`.

| Milestone | Status |
| --- | --- |
| M0 Determinism harness | done: rng streams, detmath, lint, vitest (hash, snapshot/restore, log replay). Browser-vs-Node hash check still to do |
| M1 Live core | done: terrain presets, grass, water, worker loop, Canvas renderer, time controls, species panel, chart, timeline |
| M2 Brains | done (trained instincts did not beat the prior; see M7): encodings + tests, n-step Q-learning, bloodlines, traits, rules prior. Balanced via scripts/tune.ts (all 8 species survive 2 yrs on 8/8 seeds). instinct.bin removed: trained tables were worse than the prior; trainer needs a validation step |
| M3 Rewind and share | done + verified in browser: rewind, branch, share link replays to identical hash; Node hash matches browser (scripts/verify-link.ts) |
| M4 Inspect and charts | done: inspect panel (Q-values, why, traits, life log), narrator, deaths, overlays+legend, Call it mode, clip recorder (MediaRecorder) |
| M5 Roster wave 1 | done: 13 species live (all but beaver, cat). Trees (oak/willow life stages, acorns, caches sprout, deer browse saplings, canopy cover), insects/berries/algae, dormancy (hibernate/migrate), ectotherms |
| M6 Roster wave 2 | done: all 16 species (cat via Release). Beavers fell willows, build dams that flood ponds; dams decay/burst → marsh → meadow (terrain in snapshot). Weather, fire, disease, poison, pesticide, walls, plant, food, dam/breach tools + UI + rendering. Balance ~12/15 species survive 2 yrs on 8/8 seeds; frogs/snakes fragile by design |
| M7 Polish | done (first pass): twin worlds, 5 challenges, Daily world, Call it, clips, Director camera, species detail charts, help, phone layout, a11y, render perf. Instinct trainer with validation: trained tables scored 0.950 vs prior 0.976 → not shipped; worlds start from the rules prior and learn live. |

## Notes
- Balance levers live in src/sim/species.ts (+ SPRINT, CROWD_K) and world.ts (grass rate, canBreed thresholds).
- Rules policy (`policy: 'rules'`) is the control for mechanics; learned brains start from a rules prior.

## Not done / needs the user
- Cross-browser hash CI (Playwright WebKit/Firefox) — needs downloading browser builds; only Chromium vs Node verified.
- Versioned engine deploys (/v1/ paths) for old share links — deployment, not code.
- Clip export renders the live canvas via MediaRecorder; offline WebCodecs render from the log is future work.

## Next ideas
- Engine speed: ~5 ms/tick at 5–6k animals in Node; 16× can't keep up in busy worlds (UI says so).
- Make trained instincts beat the prior (longer training, per-species validation).
- Offline clip render (WebCodecs) and share-card PNG.
