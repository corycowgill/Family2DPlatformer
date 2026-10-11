# QA guide

## Running the tests

| What | Command |
|---|---|
| Level sources validate | `npm run levels:check` |
| Typecheck | `npm run typecheck` |
| Unit tests (Vitest, `tests/unit`) | `npm test` (watch: `npm run test:watch`) |
| E2E (Playwright, `tests/e2e`) | `npx playwright test` |
| E2E, one project | `npx playwright test --project=desktop` (or `mobile`) |
| E2E, one spec / grep | `npx playwright test tests/e2e/bot.spec.ts -g lupin` |
| HTML report | `npx playwright show-report` |

Playwright's `webServer` runs `npm run build && vite preview` on `PORT` (default **4173**).
Several agents share the dev machine, so locally use your assigned port, e.g.
`PORT=4187 npx playwright test`. `E2E_SKIP_BUILD=1` serves the existing `dist/` without
rebuilding (much faster when iterating on specs only — rebuild after changing `src/`).
An existing server on the port is reused outside CI.

Chromium: `PW_CHROMIUM` or `/opt/pw-browsers/chromium` when that file exists (the dev
container); otherwise Playwright's own download (CI runs `npx playwright install --with-deps chromium`).
Don't run `playwright install` in the dev container.

Projects:
- **desktop** — Desktop Chrome 1280×720, every spec except `@touch`.
- **mobile** — Pixel 7 landscape (`hasTouch`), only tests tagged `@touch` or `@smoke` (not `@iphone`).
- **iphone** — iPhone 14 landscape emulated in **Chromium** (844×390, DPR 3, touch, iOS Safari UA; WebKit is
  not installed in the dev container), tests tagged `@touch` or `@iphone`.

### Test inventory

Unit (`tests/unit`):
- `save.test.ts` — SaveSystem defaults, corrupted JSON, wrongly typed fields, versions,
  `recordCompletion` (best times, souvenirs, stars, coins, unlocks, worlds), reset, throwing storage.
- `systems.test.ts` — `AnimationSystem.groupFrames`, `InputSystem.edge`, `CombatSystem.isStomp`.
- `levels.test.ts` — level compiler (`parseSource`/`compile`): meta, legend, auto-tiling,
  layers, entity objects, checkpoint indexing, `@objects`, decor grids, errors (unknown chars,
  unknown tiles, missing/duplicate playerStart, missing goal); every `tools/levels/src/*.txt`
  compiles; every registered level whose JSON exists has ground/entities/playerStart/goal.
- `story.test.ts` — cutscene text helpers (`wrapText`, typewriter slicing), the cutscene auto-play
  rule (`storyAllowed`: off for `?test`/`?debug`/`?level`/`?screen`/`?nointro` and automated browsers,
  forced on by `?story`), intro panels / level taglines / boss cards / ending credits data.
- Movement-motor tests belong to the player team (`tests/unit/motor.test.ts`).
- `gamepad.test.ts` — controller mapping: radial dead zone, crouch angle threshold, trigger
  threshold, A/X/B/RT/Menu/View mapping, run + jump together, `resetEdges` (A held from the map
  doesn't jump), non-standard Xbox remaps (Linux xpad axes d-pad + Firefox untouched-trigger
  quirk, macOS 360Controller, hat switch), most-recent-pad selection, hot-plug events, menu
  auto-repeat, rumble feature detection, `settings.rumble` sanitising, prompt templates.

E2E (`tests/e2e`):
- `smoke.spec.ts` — boots without console errors, test level runs, `?debug` overlay + hotkeys,
  every character can start a level, walk and jump.
- `harness.spec.ts` — determinism (same input script ⇒ identical trajectory, even with
  wall-clock jitter between frames), manual mode freezes time, teleport/checkpoint/goal,
  invulnerability, spawnEnemy, pit death ⇒ restart with a life fewer, revive.
- `gameplay.spec.ts` — menu → character select → world map → level by keyboard; keyboard
  movement; pause/resume (Esc), held keys don't stick through pause, pause menu restart/quit;
  pit death & respawn (HUD lives), checkpoint respawn, game over; hazards; level completion
  ⇒ Results, unlock, save persisted across reload, Continue / world map ✓; corrupted save boot;
  touch controls hidden on desktop; grounded-on-flat-ground regression.
- `gamepad.spec.ts` — fake standard-mapping Xbox pad (`navigator.getGamepads` stubbed via
  `addInitScript`): menu → character select → world map → level using only the pad, A held
  through the level start doesn't jump; stick moves, analog RT run + A jump, diagonal doesn't
  crouch, X ability, Menu pauses / B resumes / View pauses / Menu resumes; pause → settings →
  controls → back out; disconnect mid-level pauses with a toast; prompts follow the last
  device, mouse move restores the cursor; Vibration toggle persists and gates rumble.
- `touch.spec.ts` (`@touch`, mobile + iphone) — DOM touch overlay: shown only in gameplay, buttons at the
  screen edges / letterbox bars and never over the central play area; ▶ moves, sliding ▶→◀→▼ without lifting;
  ▶ + JUMP + ABILITY three-finger multi-touch with single-finger release; touchcancel releases all; RUN latch
  (persisted, faster); DOM pause → pause menu, canvas tap on RESUME still works; visibilitychange hidden →
  pause menu; portrait → rotate overlay + pause + controls hidden; keyboard hides / touch re-shows; manifest +
  icons served (relative paths). `@iphone`: Add-to-Home-Screen tip on the title screen (dismissal persists),
  safe-area insets respected (emulated via `--cfa-safe-*` CSS vars), Lupin ↘ crawl diagonal, screenshots
  (`iphone-gameplay*.png`, `iphone-title-tip.png` in the test output dir).
- `touch-layout.test.ts` (unit) — overlay geometry on iPhone / Pro Max / iPad / Pixel sizes (thumb size, safe
  area, centre kept free), d-pad angle hit test, JUMP↔ABILITY slide, iOS / standalone detection, tip rule.
- `overseer.test.ts` (unit) — Overseer phases from hp (9 → 6/3 thresholds, overrides), per-phase timing
  (telegraphs ≥ 0.7 s, windows ≥ 2 s), attack rotation + summon caps, weak-spot attacks per cycle, beam
  sweep plan (player half, wall → middle, a walking player always escapes), laser reach, segment hits.
- `rewards.test.ts` (unit) — medal targets ordered for every level, `medalFor` boundaries,
  `nextMedal`; unlock tiers (clear 1-2 / 6 souvenirs incl. Chicago Stars / 3 golds / boss → Grandma);
  costume fallback to classic when locked; every costume atlas + portrait in the manifest; save
  fields (defaults, old-save load with retroactive unlocks, malformed values, locked Grandma
  can't be the selected hero), `recordCompletion` best medal + unlocks reported once, `markSeen`.
- `rewards.spec.ts` — locked Grandma silhouette + hint, confirm refused; boss beaten ⇒ unlock popup
  once, selectable, persisted; costume picker (▲▼) saves wearable outfits only, level uses the
  `<id>-<costume>` atlas; Results medal + NEW MEDAL! + best medal saved + outfits III popup;
  Collection screen from the menu; Frying Pan Spin hits both sides and caps the fall once per jump.
- `bot.spec.ts` — bot completes the test level with all six characters (damage on); widened
  gap; impassable wall ⇒ stuck report; every existing `LEVELS` map with every character
  (damage on; boss levels invulnerable, plus a damage-on run that must reach the arena) —
  failures attach a screenshot + the bot JSON.
- `story.spec.ts` — `?story`: PLAY on a new save plays the opening comic, ENTER advances / ESC skips to
  character select, `seenIntro` persists and PLAY skips it next time; without `?story` automation never
  sees it; tap-through; level intro card texts; boss intro beat (letterbox card, input held, then the HP
  bar; JUMP skips); boss clear → Results CONTINUE → ending beats (flag → credits → teaser) → world map,
  `seenEnding`, Extras rewatch.
- `world2.spec.ts` — World 2 locked until 1-4 is beaten (old World 1 saves open 2-1 retroactively, map
  opens on 2-1, PLAY enters north-1); `?story` World 2 comic plays once before 2-1; beating 1-4 → ending
  teaser "WORLD 2 / UNLOCKED! / THE NORTH SIDE" → map on 2-1; beating 2-4 → WORLD 2 CLEAR → W-flag
  ending → World 3 teaser → map, Extras rewatch; every 2-x map loads; **THE OVERSEER is
  defeated by the PlatformBot stomping only, for every character** (invulnerable, all three
  phases' signature attacks seen) → Results.
- `perf.spec.ts` — FPS over 5 s of scripted play (report; warns below 50 fps);
  10 level restarts: textures / listeners / bodies / display list stable, heap growth reported.

New levels are covered automatically: anything listed in `src/game/data/levels.ts` whose
`public/<file>` exists is picked up by the level unit test and the bot spec. Specs that need a
real `LEVELS` entry (menu flow, unlocks) fall back to `test.json` for maps that don't exist yet
(`harness.aliasMissingLevels()`), noted as a test annotation.

## Local co-op (2 players, same screen)

Drop-in / drop-out during any level. Code: `systems/Coop.ts` (pure rules, `tests/unit/coop.test.ts`),
`systems/CoopSystem.ts` (Phaser glue), `InputSystem` sources (`primary` / `keys2` / `pad`),
HUD P2 panel; e2e `tests/e2e/coop.spec.ts`.

- **Join:** A or Start on a second controller (a lone controller always stays P1's, so its Start
  keeps pausing), or **U** on the keyboard (one keyboard + one controller: P2 takes the keys). A picker appears beside P1: left/right picks a hero (never P1's;
  Grandma only once unlocked), jump/ability confirms. P2 keyboard set: **IJKL** move, **U** jump,
  **O** ability, **H** run; while it's in use P1 keeps Arrows/WASD, Space/Z jump, X ability (J/K go to P2).
- **Leave:** View/Back on P2's controller, **Backspace** on the keyboard, or unplug P2's pad.
- **Camera:** midpoint of the living players, clamped to the world/arena. If they can't fit on one
  screen the camera follows the player furthest right, and a player who stays off-screen for 0.7 s
  warps (poof) next to the partner's last safe footing.
- **Deaths / lives / coins:** shared lives and coins. A player who falls while the partner is alive
  respawns next to them after 1.5 s at full health — no life lost. Only when both are down is a
  life lost (restart at the checkpoint, P2 comes back too). Checkpoint flags heal everyone; either
  player can reach the goal; boss arenas wall in both.
- P2 persists for the session (next levels, restarts) via `gameState.coop`. Touch stays P1-only.

## Controller (Xbox) support

Browser Gamepad API, W3C "standard" layout (Chrome/Edge/Firefox on Windows/macOS, Safari on
Mac/iPhone/iPad, Android Chrome). Code: `systems/Gamepads.ts` (pure: normalise/remap, most
recently used pad, presses, hot-plug, rumble), `systems/InputMapping.ts` (pure mapping),
`ui/PadOverlay.ts` (per-frame poll, toasts, cursor, pause on disconnect), `ui/NavInput.ts`
(menus), `ui/Prompts.ts` (device-aware button glyphs), `ui/ControlsScreen.ts` (Settings →
Controls shows this table in game).

| Action | Xbox controller | Keyboard | Notes |
|---|---|---|---|
| Move | Left stick, d-pad | Arrows / WASD | Radial dead zone 0.25 (rescaled). |
| Crouch / drop through | Stick down, d-pad down | ↓ / S | Stick must be within 30° of straight down — a down-diagonal while running never crouches. Left/right need ≥ 22.5° from vertical. |
| Jump (hold = higher) | **A** | Space / Z / K | |
| Run (hold) | **RT**, LT, RB, LB | Shift | Analog triggers count above 0.3. Hold RT + press A to run-jump. |
| Ability / attack | **X**, B | J / X | |
| Pause | **Menu**, View | Esc / P | |
| Menus: move | D-pad / stick (auto-repeat 380 ms, then 140 ms) | Arrows / WASD | |
| Menus: confirm | A (Menu also confirms; in the pause menu it resumes) | Enter / Space / Z / J / K | |
| Menus: back | B, View | Esc / Backspace / X | Pause menu: B resumes. |
| Settings sliders/toggles | D-pad left/right adjust, A toggles | ← → / Enter | |
| World map: change hero | Y | C | |

Why this layout: A (bottom face) jumping is the universal Xbox platformer convention. The
ability lives on X — the left face button, where Mario's fireball/run button sits on an Xbox
pad and the same letter as the keyboard's X/J ability key; B duplicates it so either face
button works for small hands. Run is a *separate hold* on the shoulders (RT first in prompts):
abilities have cooldowns and some (dash, ground pound) move the hero, so the SMB "hold the
fire button to run" overload would fire one every time you start running. An index finger on
RT leaves the thumb free to roll A ↔ X, so run + jump + ability all work together.

Behaviour:
- The pad used most recently drives the game (any index; several pads can be connected).
- Browsers expose a pad only after one of its buttons is pressed; that wake-up press is
  swallowed (so it doesn't also confirm a menu) but switches prompts to Xbox glyphs. Settings →
  Controls shows "PRESS ANY BUTTON" while no pad is seen.
- Any pad button / stick push → `setInputDevice('gamepad')`: prompts switch to Xbox glyphs,
  the mouse cursor hides over the canvas (until the mouse moves), touch controls hide (touch
  team). A keypress / touch switches back.
- Hot-plug: "CONTROLLER CONNECTED / DISCONNECTED" toast on every screen (overlay scene added on
  demand). A pad that was used disconnecting emits `REQUEST_PAUSE` (LevelScene pauses).
- Non-standard mappings (`pad.mapping !== 'standard'`, e.g. Firefox on Linux/macOS) are remapped
  for Xbox ids (`xbox`/`xinput`/`045e`): Linux xpad (d-pad on axes 6/7 or a hat axis, triggers on
  axes 2/5, ignored until seen at rest — Firefox reports untouched triggers as 0) and macOS
  360Controller (d-pad buttons 11-14). Unknown pads use the raw indices.
- Rumble (`vibrationActuator.playEffect('dual-rumble')`, or legacy `hapticActuators`; feature
  detected): hurt, death, ground-pound landing, boss hit, boss defeated. Only while the pad is
  the active device; Settings → Vibration (`settings.rumble`, default on).
- Button prompts: `prompt(scene, x, y, '{JUMP} JUMP')` with tokens JUMP RUN ABILITY MOVE CROUCH
  PAUSE CONFIRM BACK NAV CHOOSE ADJUST HERO or explicit glyphs (`{pad:A}`, `{key:SPACE}`). Level
  signs use the same tokens (`sign x y text=Hold_{RUN}_to_jump_farther`).

Needs a real controller to verify: rumble strength/feel (Chrome/Edge; Firefox has no
dual-rumble; Safari support varies), Safari/iOS pairing and that the Menu/View buttons reach the
page (iPadOS may reserve them), Firefox non-standard remaps on real hardware, Bluetooth
reconnect after sleep, and that the Xbox button (16) is left to the OS.

## Test harness (`window.__harness`)

Installed when the URL has `?test` or `?debug` (loaded lazily from `src/main.ts`; not in the
main bundle). Source: `src/game/debug/TestHarness.ts`.

```js
const h = window.__harness;
await h.ready();                                   // boot/preload finished
await h.startLevel('test', 'parker', { manual: true, seed: 1 }); // → HarnessState
h.setInput({ right: true, run: true, jump: true }); // replaces keyboard/touch/gamepad; null = give back
await h.stepFrames(60);                            // advance exactly 60 frames (dt 1000/60)
h.getState();  // { scenes, levelId, character, x, y, vx, vy, grounded, mode, health, lives,
               //   coins, levelTimeMs, finished, enemies, deaths, checkpoint, manual, frame }
```

| Method | Notes |
|---|---|
| `ready()` | Resolves when a scene other than Boot/Preload runs. |
| `startLevel(id, character, {manual, seed, mapFile})` | Stops other scenes, (re)starts Level, resets lives/checkpoint, resolves after `create()`. |
| `setManual(bool)` / `isManual()` | Manual = deterministic stepping only. Real-time otherwise. |
| `stepFrames(n, dtMs = 1000/60)` | Runs the full scene update (timers, tweens, cameras, sprites, Arcade physics, `LevelScene.step`). Waits for queued scene transitions (death restart). Returns frames stepped (stops early if the level stops/pauses). |
| `setInput(input \| null)` | `{left,right,up,down,jump,run,attack,pause}` via `InputSystem.override`; sticky across restarts. |
| `getState()` | See above. |
| `teleport(x, y)`, `teleportToCheckpoint(i)`, `checkpoints()`, `goal()` | Bottom-centre coordinates. |
| `setInvulnerable(bool)` | Sticky; pits/water still kill. |
| `spawnEnemy(kind, x, y, props?)` | Through the spawner registry (`getSpawner('enemy')`). |
| `editTiles(layer, tx, ty, w, h, index)` | Runtime tile edits for synthetic scenarios (`-1` clears). |
| `completeLevel()`, `killPlayer()`, `revive(x?, y?)`, `setLives(n)`, `pause()` | |
| `getSave()`, `clearSave()`, `setSettings(patch)` | Save = localStorage `cfa-save`. `setSettings` merges + sanitises settings (assist / accessibility). |
| `levels()`, `useMap(id, file)`, `aliasMissingLevels()` | Which LEVELS maps exist; substitute test.json. |
| `scenes()`, `isActive(key)`, `sceneTexts(key)`, `sceneObjects(key, type)` | UI assertions. |
| `stats()` | textures, display-list sizes, bodies, tweens, listener counts, JS heap. |
| `measureFps(ms)` | Real render frame times. |
| `bot(options)` | Runs the platforming bot (below). |
| `joinP2(character)`, `leaveP2()`, `setInputP2(input \| null)`, `killP2()`, `teleportP2(x, y)`, `coopState()` | Local co-op (below). `startLevel` always starts single player; `getState().p2` is P2's snapshot or null. |

**Player motor and stepping:** the player motor advances on the Arcade world's
`WORLD_STEP` event; `Player.tick()` only latches input. `stepFrames` runs the scene's whole
update, including `world.update()`, which fires exactly one `WORLD_STEP` per 1000/60 ms frame
(another `dtMs` still works; the world's fixed-step accumulator decides how many steps run).

**How determinism works:** in manual mode the Level scene's `sys.step` is gated, so the
browser's rAF loop keeps rendering but never advances the simulation. `stepFrames` calls the
real `Systems.step` with a synthetic time and fixed dt; the TweenManager (normally
`Date.now()`-based) is fed the same dt; `Math.random` and `Phaser.Math.RND` are seeded; camera
`worldView` is refreshed after each step (the renderer normally does it, and enemy culling
reads it). Other scenes (HUD) keep running in real time but don't affect the simulation.
Keep it that way: gameplay code should take time from `ctx.now()`/`delta`, never `Date.now()`
or `performance.now()`, or determinism breaks (the determinism spec will catch it).

From Playwright use the helpers in `tests/e2e/helpers.ts` (`openGame`, `startLevel`,
`harness(page, fn, arg)`, `holdKey`, `gameToPage`, `trackConsole`, …).

### Debug overlay (`?debug`)

LevelScene's own: collision boxes, bottom status line, `I` invulnerable, `C` respawn at
checkpoint, `B` toggle boxes, `N` finish level. Harness adds: a status block (frame time,
bodies, enemies, tweens, textures, level/time/hp/lives/coins/checkpoint), `0` test level,
`1`–`9` LEVELS[n-1], `R` restart, `G` teleport near the goal, `T` run the bot in real time.

## Platforming bot

`src/game/debug/PlatformBot.ts`, run via `await __harness.bot({ levelId, character, invulnerable })`
(`T` in the `?debug` overlay runs it in real time).

1. **Navigation graph** (built at the start of a run for that character, ~0.3-0.6 s): every
   tile surface the character can stand on is a node; edges are walking steps and jump /
   walk-off arcs simulated with the real motor (`PlayerMotor`) and the character's stats —
   jumping up through one-way platforms, moving-platform paths (ride them), bounce pads,
   blocks. A reverse Dijkstra from the goal (boss levels: the boss arena) gives every node a
   cost-to-go in frames. If the goal isn't in the graph the bot heads for the explored node
   closest to it (and then reports `stuck`).
2. **Receding-horizon control**, every frame: candidate inputs (run / walk / brake / wait and
   ~25 jumps with different hold times and air-steering on the ground; steer + hold/release
   in the air) are simulated from the player's exact state with an emulation of Arcade's
   tile separation (`SeparateTile`, tileBias 20), predicted moving / falling platforms,
   steam-vent phases, hazard-train schedules, kill zones, enemies (linear, ≤ 0.9 s) and enemy
   shots. Score = frames + cost-to-go where the sim ends + damage / death penalties + a
   "can I stand here ~1 s" check + a small penalty for toe-hold landings. The cheapest
   candidate's first input is applied. This climbs one-way staircases, waits for platforms,
   trains and steam, runs up for long jumps (backs off when a jump needs more speed),
   stomps or avoids enemies. Boss arenas: keep away from the boss, stomp it while it can be
   damaged.
3. **Recovery**: on death (revived in place) or no cost-to-go progress for `stuckFrames`
   (900) it rewinds to an earlier safe spot and retries with some randomness; after
   `maxAttemptsPerSection` (10) failures in one place it gives up.

Options: `invulnerable`, `maxFrames`, `stuckFrames`, `maxAttemptsPerSection`, `seed`,
`stopAtBossArena` (damage-on reachability of a boss level), `sloppy` (0..1, human-like
reaction lag + noisy choices — used for death heatmaps), `trace` / `traceDetail`
(per-frame decisions, candidate scores and one-step mispredictions, for debugging the bot).

Result: `{ completed, reachedBossArena, progress, maxX, goalX, deaths, rewinds, failures[],
stuckAt, simSeconds, incidents[] (every hurt / death with x, y, kind), graph, perf }`.
`bot.spec.ts` requires every registered level to be finished by every character (damage on;
boss levels invulnerable + a damage-on run that must reach the arena). A failure is still a
lead for a human first: check the attached screenshot / JSON before blaming the level.

**Death heatmaps:** run the bot with `sloppy: 0.5` over several seeds with damage on and
bin `incidents` by x (the level design notes in `tools/levels/README.md` quote the numbers).
### Medal times

Time-trial targets live in `src/game/systems/Rewards.ts` (`MEDAL_TIMES`). Par = the bot's
cleanest invulnerable run (`h.startLevel(id, ch, { manual: true }); h.bot({ noRestart: true,
invulnerable: true })`, sim seconds), measured 2026-10 on the shipped maps:

| level | bot par (clean invulnerable runs, 6 characters) | gold | silver | bronze |
|---|---|---|---|---|
| 1-1 loop-1 | 22-24 s | 0:32 | 0:50 | 1:20 |
| 1-2 loop-2 | 31-33 s | 0:45 | 1:10 | 1:50 |
| 1-3 loop-3 | 27-31 s | 0:40 | 1:05 | 1:40 |
| 1-4 boss | 73-76 s (≈ 30 s run + the fight) | 1:45 | 2:30 | 3:30 |
| 2-1 north-1 | 23-25 s | 0:34 | 0:53 | 1:25 |
| 2-2 north-2 | 25-32 s (Mom / Grandma wait longer for the tide planks) | 0:40 | 1:02 | 1:38 |
| 2-3 north-3 | 34-35 s | 0:48 | 1:15 | 2:00 |
| 2-4 boss | 103-106 s (≈ 20 s approach + the 9-HP Overseer) | 2:30 | 3:30 | 5:00 |

Gold ≈ 1.4 × par, silver ≈ 2.2 ×, bronze ≈ 3.5 × (boss: a little tighter — the fight's
length is set by the boss). Measure with the bot runner in `bot.spec.ts` / `h.bot({ levelId,
character, invulnerable: true })` → `simSeconds`.

Re-measure after a level layout change. `h.setSave(data)` replaces the save (sanitised like
a loaded one, retroactive unlocks applied) to set up progress in tests.

## Known defects / flaky areas

- **Grounded flicker (fixed on main).** Before the fixed-step motor, `Player.grounded`
  toggled every frame on flat ground (vy = 0 with gravity off → no floor contact on the next
  step): `onLand` fired every other frame (dust trail, `land` sfx, squash tween resizing the
  body). Now a regression test in `gameplay.spec.ts`.
- **FPS in CI / containers** is software WebGL (SwiftShader): expect 25–40 fps; the perf spec only warns.
- **Real-time specs** (pause, death respawn, touch) depend on wall-clock timers; they use
  generous `waitForFunction` timeouts. If they flake under heavy load, run with `--workers=1`.
- Keyboard input: Phaser polls key state per frame, so specs hold keys (`holdKey`) instead of
  `keyboard.press` for in-game controls (menus use keydown events and are fine with `press`).
- `favicon.ico` 404 is ignored by the console-error check (no favicon yet).

## Mobile / iPhone

Code: `src/game/platform/**` (device detection, hardening, audio lifecycle, fullscreen, home-screen tip,
touch geometry, pixel SVG) and the DOM overlay in `src/game/ui/TouchControls.ts`.

- **Touch controls** are an HTML overlay (`#touch-controls`) above the canvas, pinned to the screen edges
  (letterbox bars on wide phones), sized from viewport height (≥ 56 px main buttons, ≥ 44 px RUN / pause),
  inset by `env(safe-area-inset-*)`. Left: one d-pad zone (◀ ▶ ▼, slide between them, ↙/↘ = down + direction).
  Right: JUMP (▲, A), ABILITY (★, B), RUN latch; PAUSE top-right (the HUD's canvas pause hides while the overlay
  is up). Touch events with `passive: false`, tracked per `Touch.identifier`; touchcancel / blur / hidden
  release everything. Visible only while the Level runs (not paused), in landscape, and when the active input
  device is touch (Settings → Touch controls ON forces it, OFF hides it; a keypress or pad hides it). DOM is
  only written on state changes / resize.
- **iOS hardening**: gesture* events cancelled (pinch), double-tap + dblclick cancelled, document touchmove
  cancelled (no rubber-band / pull-to-refresh), callout/selection/tap-highlight off, fixed body + `100dvh`,
  debounced `game.scale.refresh()` on resize / orientationchange / visualViewport resize.
- **Audio**: `navigator.audioSession.type = 'playback'` (iOS 17+, plays with the silent switch on); context
  resumed on every touchend/pointerup/keydown if suspended or interrupted (+ silent buffer on the first);
  backgrounding (visibilitychange hidden / pagehide) → `REQUEST_PAUSE` + suspend; return → resume (game stays
  on the pause menu).
- **Home-screen app**: `public/manifest.webmanifest` (fullscreen → standalone, landscape), icons from
  `python3 tools/art/draw_icons.py`, apple-touch-icon + Apple meta tags. iOS Safari (not standalone) shows a
  dismissible "Share → Add to Home Screen" tip on the title screen. Android: first gameplay touchend requests
  fullscreen + `screen.orientation.lock('landscape')` (skipped under automation).

Verified by emulation (Chromium): layout at 844×390 and 863×360, multi-touch via CDP, touchcancel, pause /
visibility / portrait flows, manifest & icons, tip show/dismiss. **Needs a real-device check:**
iPhone Safari pinch / double-tap / rubber-band suppression; actual safe-area insets (notch, Dynamic Island,
home indicator) and toolbar collapse; touchcancel from the home-indicator swipe; audio with the silent
switch and after a call / app switch / lock screen; Add to Home Screen icon + fullscreen launch; Android
Chrome fullscreen + orientation lock; iPad (4:3, controls over the top/bottom bars); thumb comfort of the
button sizes.
