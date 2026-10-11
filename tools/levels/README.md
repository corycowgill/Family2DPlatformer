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

## World 2 — The North Side

All four maps were rebuilt from the short systems-pass placeholders into full levels
(240-280 tiles; 2-4 = a 168-tile approach + the unchanged 26-tile Overseer arena). Materials:
`M` grass, `H` park path, `D` sand, `U` boardwalk, `Q` greystone, `Z` stadium seats, `I` ivy,
`,` boardwalk plank; `A` asphalt for the night streets (the World 1 sidewalk is too bright at
night). Decor: background `@FLAT` (auto-dressed three-flats), neon / bleacher / Addison / zoo
sign / conservatory tiles via `@legend`, and World 2 props. Two tricks worth reusing:

- **Facade-dressed solid buildings** (2-3): the street face of a solid `Q` building is covered
  with greystone / brownstone facade tiles on the *foreground* layer (`GS_*` / `BS_*` walls,
  windows, quoined edges). The player can never stand in front of a solid cell, so foreground
  tiles over solid ground are safe and turn a flat stone block into a three-flat with windows.
- **Hidden rooms** (2-1 hill cave, 2-2 ship cabin, 2-3 alley back room, 2-4 the ivy): the
  room is empty in `@map` and the whole room (not just its entrance) is covered by the same
  material in `@foreground`; a `secret` rectangle fades it while the player is inside.

Heatmap (damage on, sloppy 0.5, seeds 1-3; Dad/Mom/Brennan/Parker/Lupin = 15 runs, Grandma 3):

| level | deaths / hits / sim (15 runs) | Grandma (3 runs) |
|---|---|---|
| 2-1 north-1 | 0.27 / 0.73 / 26 s | 0.00 / 1.00 / 29 s |
| 2-2 north-2 | 0.27 / 1.27 / 32 s | 0.67 / 1.33 / 34 s |
| 2-3 north-3 | 0.13 / 2.07 / 42 s | 0.33 / 1.67 / 44 s |
| 2-4 north-4 (before the arena) | 0.07 / 1.87 / 21 s | 0.00 / 1.33 / 22 s |
| 2-4 north-4 (incl. the fight) | 3.20 / 8.47 / 137 s (13 of 15 within 300 s) | 3.67 / 8.67 / 117 s |

Compared with World 1 the regular levels are longer (par 24 / 26-32 / 34 s vs 22-33 s), denser
and bring the alien soldiers (skirmishers, wasps, the Warlord) into regular levels. The
Overseer is far harder for the bot with damage on than the EL-iminator (0.67 / 4.07): the
fight itself is the boss team's tuning (`enemies/overseerPlan.ts`), the arena is unchanged.

Hotspots found and fixed while tuning: a skirmisher on the 2-3 rooftop right after a gap (shot
every jumper into the gangway: 6 of 6 runs), a gnat over the 2-4 moving girder (14 hits + 13
pit deaths in 18 runs) and the skirmisher that guarded the 2-4 scaffolds, the skirmisher on the
2-2 piers (shoots players mid-jump over the lake; moved to the beach), a wasp over the 2-2
harbor planks and one over the last inlet, gnats over the 2-2 tide planks, the 2-1 ravine
(falling plank → a stump, 2-wide jumps), the raccoon at the 2-3 alley entrance (10 of 18 runs),
a turnstile bot in the 2-4 concourse (17 of 18 runs). Two bot-planner stalls were removed by
geometry: the 2-2 harbor boat now starts 12 tiles past the beach house (the bot waited on the
upper deck for a jump onto the boat) and the 2-3 alley light-well has two landings. Remaining
hotspots are intentional: the Warlord at Addison (≈ 1.3 hits per run, an awning lets you pass
over it), the 2-2 beach skirmisher, the 2-4 grandstand skirmisher + wasp and the pre-arena
skirmisher + wasp + gnats combo.

### 2-1 Lincoln Park (`north-1`) — gentle start, 240×20

1. Zoo entrance: the LINCOLN PARK ZOO board, lion statues, `?` row (hotdog, 5 coins). Treetops
   (one-way `HEDGE` canopies over tree props) climb from a hedge step to souvenir 1 above the
   limestone zoo house (roof garden). First 3-wide pit under a coin arc.
2. "Alien gnats swoop" sign + the first gnat over open lawn (giraffe topiary).
3. **The Conservatory**: glasshouse in the background, boardwalk galleries inside (15 → 12 → 9),
   one-way glass roof (6) and cupola (3); Chicago Star 1 above the cupola, a gnat on the roof,
   a 1-up block. Checkpoint.
4. **North Pond**: fishing pier, two stepping stones, the pond boat, an island. Bounce pad on the
   pier into the willow tops (souvenir 2), a security drone over the boat.
5. Lawns (pigeons, CTA-pass brick row), checkpoint, the hill: **souvenir 3 in a cave hidden
   behind the hillside** (walk into the hill at ground level). Ravine with a stump step.
6. Zoo exit gate, the classic end staircase; Chicago Star 2 in the arc past the top step.

### 2-2 Lakefront Trail (`north-2`) — speedy and breezy, 250×20

1. North Avenue Beach: umbrellas, lifeguard chair (one-way seat), volleyball net, beach-ball
   bounce pad to a high `?` row, a skirmisher on the sand.
2. Boardwalk piers over Lake Michigan (railings), a lookout plank above a lifeguard chair
   (souvenir 1), sinking pier planks (3 × falling planks). Checkpoint.
3. **The tide**: eight bobbing planks (period 3.4 s, phase-shifted like a wave) over open water;
   Chicago Star 1 above the crest, one gnat high above.
4. **The ship-shaped beach house**: hull, main deck, upper deck, bridge deck and a crow's nest
   (souvenir 2), limestone superstructure in the background; skirmisher + rat on the decks,
   a wasp at the crow's nest. **Souvenir 3 in the cabin inside the hull** (door at the stern).
5. Checkpoint, the harbor: boat ride, breakwater, harbor-light gallery (bounce pad → Chicago
   Star 2), sinking planks; a security drone over the boat.
6. Oak Street Beach sprint: dune, a 3-wide inlet, rats, volleyball, wasp, flag.

### 2-3 Wrigleyville Nights (`north-3`) — hardest regular level, 280×20

1. Clark Street (asphalt): three-flats with neon (BAR, PIZZA, HOT DOGS), lamps, pigeons, a rat;
   the greystone stoop up to the roofs.
2. Rooftops over bottomless gangways: a raccoon, a 4-wide gap, chimney steam on a roof, a 5-wide
   running jump to the **rooftop bleachers** (three one-way tiers, souvenir 1 at the top), a
   skirmisher at the far end, a crumbling scaffold over an 8-wide gangway. Checkpoint.
3. **The Red Line**: the track runs above the roofs with a hazard-train lane and two plank
   shelters; a boarding step *below* the lane, then the car ride over the gap (Chicago Star 1
   above it, a drone). The lane is above everything else on purpose: a hazard train sweeps the
   whole screen at the lane height.
4. Addison station (canopy, ADDISON sign, drone + gnat), stairs down to the plaza: **the Warlord**
   (mini-boss, `boss=false`), an awning over it. Checkpoint.
5. The alley (`darkZone`) under a building: steam vents, a rat, a raccoon, a window washer;
   or the roof above it (skirmisher, wasp, Chicago Star 2 on a high plank). Out through the
   light-well's fire-escape landings; **souvenir 2 in the back room behind the alley's end wall**.
6. Rooftop bleachers down to the street, a cone guy, skirmisher, rat; the ballpark: ivy wall with
   bleachers, a light tower with a service ladder (souvenir 3, wasp), the W flag.

### 2-4 Battle at Wrigley (`north-4`) — 196×17, boss

1. The concourse under the grandstand (steel columns, CHICAGO DOGS cart): `?` row with hotdog +
   pizza before the fight, a cone guy, two gnats.
2. Up the grandstand seats (`Z`): skirmisher + wasp on the top row, Chicago Star 1 above it,
   the press-box catwalk (souvenir 3). Checkpoint on the field.
3. The outfield bleachers: the scoreboard with a catwalk on top (bounce pad, souvenir 1), a
   raccoon. The bleacher renovation: two crumbling scaffolds + a shuttling girder over a
   bottomless pit; a wasp past it.
4. **The ivy** (souvenir 2: the lost ball hidden in the ivy, walk into the wall). Checkpoint.
5. The dugout (rats under its roof), the warning track: CTA pass, skirmisher + wasp + gnats.
6. The arena (unchanged): `boss 168 12 width=26 height=13 kind=overseer`, floor 13, one-way
   ledges at row 10, ivy wall on the right.

## Changing a level

Keep `npm run levels:check` green, keep the 3 souvenirs, run the bot spec
(`npx playwright test tests/e2e/bot.spec.ts`) and re-measure the medal times in
`src/game/systems/Rewards.ts` (gold ≈ 1.4 × a clean bot run; docs/QA.md "Medal times").
