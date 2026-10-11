# Levels

Sources: `tools/levels/src/<id>.txt` (ASCII grid + `@objects`), compiled by
`build-levels.mjs` (auto-tiling in `autotile.mjs`) to `public/levels/<id>.json`.
`npm run levels` builds, `npm run levels:check` validates and runs the reachability checker
(`check-reachability.mjs`: BFS over standing spots with the weakest character's jump, no
abilities; goal / checkpoints / boss arena must be reachable, souvenirs and Chicago Stars
are reported when they need an ability or a secret route). The level-design jump limits
are the `JUMP LIMITS` block in `src/game/config.ts`; entity syntax is in
`src/game/world/worldSpawners.ts` and the default legend in `build-levels.mjs`.

Every level has 3 souvenirs (`1` `2` `3`) and 1-2 Chicago Stars (`*`) in optional skill spots.

## Playtesting with the bot

`window.__harness.bot({ levelId, character, invulnerable, sloppy, seed })` (see docs/QA.md)
plays a level with a route planner + per-frame simulation of the real motor. `bot.spec.ts`
requires every level to be finished by every character. For a **death heatmap** run it with
damage on, `sloppy: 0.5` (human-like reaction lag and noisy choices) over a few seeds and bin
`result.incidents` (x, kind) — that is how the numbers below were measured.

Heatmap (World 1, damage on, sloppy 0.5, seeds 1-3; Dad/Mom/Brennan/Parker/Lupin = 15 runs
per level; deaths and hits per run, avg simulated clear time):

| level | before: deaths / hits / sim | after: deaths / hits / sim | after, Grandma (3 runs) |
|---|---|---|---|
| 1-1 loop-1 | 0.07 / 0.27 / 26 s | 0.07 / 0.13 / 25 s | 0.33 / 0.00 / 27 s |
| 1-2 loop-2 | 0.53 / 1.27 / 89 s | 0.53 / 1.27 / 43 s | 0.67 / 1.67 / 42 s |
| 1-3 loop-3 | 0.07 / 2.07 / 38 s | 0.13 / 2.00 / 34 s | 0.00 / 1.00 / 35 s |
| 1-4 loop-boss (before the arena) | 1.20 / 3.53 | 0.33 / 1.87 | 0.00 / 0.67 |
| 1-4 loop-boss (incl. the fight) | 1.80 / 5.60 / 94 s | 0.67 / 4.07 / 85 s | 0.67 / 3.33 / 83 s |

Biggest before-hotspots: the 1-4 train ride (wasp above it + hazard train overlapping the
boarding point: 15 of 27 deaths) and its landing (skirmisher shots), the 1-2 train ride
(up to 12 s waits; 1-2's average clear took 89 s), the window washer on the 1-2 tower
landing, the raccoon on the 1-3 Lower Wacker landing. Remaining hotspots are intentional:
the 1-2 drone over the train ride, the 1-2 tower → roof gaps, the 1-3 gnats at the end run
and the boss fight itself. 1-2 kills more than 1-3, but 1-3 hits harder (more enemies);
1-4 is the hardest by both measures.

## Design notes

### 1-1 Welcome to the Loop (`loop-1`) — gentle

Idea: teach the verbs on wide, safe streets.
1. Start street: `?` blocks (one high `?` above the row and a Chicago Star to the right of
   it for players who climb onto the blocks), planters as first hops, a rat between them.
2. Coin trench (a 1-deep dip — falling in is safe and rewarded) → first real pit (3 wide)
   under a coin arc, with the "Hold RUN" sign right before it.
3. Awning → **planter step** → 3-high limestone block: the step (new) turns the first
   tall wall into a staircase a 5-year-old can climb.
4. Girder ride over the only wide pit: the girder is 4 wide and slower (period 5 s) and a
   "Ride the girder!" sign announces it.
5. Checkpoint, bounce pad up to the plank shelf (souvenir 1), question/brick row, the
   building with the under-floor secret (souvenir 2).
6. Pillar hops (3-wide gaps) with a lift plank as a helper, checkpoint, awning + plank
   (souvenir 3), then the classic end staircase. Chicago Star floats in the coin arc past
   the top of the staircase — jump off the top step toward the flag to grab it.

### 1-2 The Elevated Tracks (`loop-2`) — ramp up: rooftops, trains, steam

Idea: the elevated train is both a hazard and a ride.
1. Rooftops and the first steam vent (sign: they puff before they blast); the pigeon was
   moved from the first gaps to the wide lower roofs (it hit almost every run there).
2. Upper rail with a warning-light hazard train (risk / coins) vs the lower roofs (gaps,
   rats); brick pocket with souvenir 2.
3. Collapsing scaffold hop (a Chicago Star above the middle scaffold), then the one-way
   plank staircase up the 7-tile tower; the window washer now stands a few tiles past the
   checkpoint instead of on the landing.
4. **Train-car ride** over the 36-tile gap (period 12 s → 9 s, shorter pause: a missed
   train is a 4-5 s wait instead of up to 12 s); one of the two drones that shot riders was
   removed. High girder route above with souvenir 1.
5. Steam-lift to the high plank (souvenir 3, reached with the lift — the checker can't model
   steam lifts and lists it as info), checkpoint (the rat moved off the gap edge), then the finale: the rail with a
   hazard train and plank shelters above it, or the lower roofs — a Chicago Star hangs over
   the 6-wide lower gap for the brave.

### 1-3 Riverwalk Rush (`loop-3`) — ramp up: water and Lower Wacker

Idea: boats and a dark under-street run.
1. Riverwalk, dock planks over the first water, then the boat crossing (two boats + a plank
   island). **New checkpoint** right after the boats (col 80) — the first one used to be 116
   tiles in, behind the hardest part of the first half.
2. Bridge deck with a raccoon, the stone pocket with souvenir 1, the twin lift planks over
   the river (Chicago Star above them).
3. Checkpoint, then Lower Wacker (dark, low ceiling): shallow dips, rats, raccoons, a drone.
   The raccoon that stood right where you land after the second dip was moved 6 tiles on.
4. Plank bridge over the river with the deck above (souvenir 2), checkpoint, the last boat
   crossing (Chicago Star high above the water next to the drone), bounce pad to the high
   plank (souvenir 3), two gnats (was three: the end run caused most of 1-3's hits), goal.

### 1-4 Battle for the Loop (`loop-boss`) — hardest, then the EL-iminator

Idea: everything from 1-1..1-3 at once, then the boss.
1. Turnstile bot, steam vent, the long collapsing-scaffold bridge (souvenir 1 on the high
   planks), skirmisher, checkpoint.
2. Upper rail with the fast hazard train vs the lower route (souvenir 2 in the brick
   pocket). The hazard lane now ends 6 tiles before the train-car boarding point so the
   boarding jump isn't also a train dodge.
3. **Train-car ride** over the 34-tile gap (period 11 s → 9 s); the wasp above the ride was
   removed (it caused most of the level's deaths together with the boarding). Chicago Star
   above the ride. **New checkpoint** where the ride lands (previously 114 tiles between
   checkpoints), and the shooting skirmisher on the landing became a cone guy at the far end of the roof.
4. Bounce pad to souvenir 3, steam-vent pair, girder jump to the last checkpoint, arena.

## Changing a level

Keep `npm run levels:check` green, keep the 3 souvenirs, run the bot spec
(`npx playwright test tests/e2e/bot.spec.ts`) and re-measure the medal times in
`src/game/systems/Rewards.ts` (gold ≈ 1.4 × a clean bot run; docs/QA.md "Medal times").
