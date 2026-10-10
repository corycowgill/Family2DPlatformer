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
- **mobile** — Pixel 7 landscape (`hasTouch`), only tests tagged `@touch` or `@smoke`.

### Test inventory

Unit (`tests/unit`):
- `save.test.ts` — SaveSystem defaults, corrupted JSON, wrongly typed fields, versions,
  `recordCompletion` (best times, souvenirs, stars, coins, unlocks, worlds), reset, throwing storage.
- `systems.test.ts` — `AnimationSystem.groupFrames`, `InputSystem.edge`, `CombatSystem.isStomp`.
- `levels.test.ts` — level compiler (`parseSource`/`compile`): meta, legend, auto-tiling,
  layers, entity objects, checkpoint indexing, `@objects`, decor grids, errors (unknown chars,
  unknown tiles, missing/duplicate playerStart, missing goal); every `tools/levels/src/*.txt`
  compiles; every registered level whose JSON exists has ground/entities/playerStart/goal.
- Movement-motor tests belong to the player team (`tests/unit/motor.test.ts`).

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
  known-defect tests (`test.fail`, see below).
- `touch.spec.ts` (`@touch`, mobile) — touch buttons shown; ▶/◀ move; jump while ▶ held (multi-touch); pause button.
- `bot.spec.ts` — bot completes the test level with all five characters (damage on); widened
  gap; impassable wall ⇒ stuck report; every existing `LEVELS` map with every character
  (invulnerable; **warning only**, with screenshot + JSON attachments).
- `perf.spec.ts` — FPS over 5 s of scripted play (report; warns below 50 fps);
  10 level restarts: textures / listeners / bodies / display list stable, heap growth reported.

New levels are covered automatically: anything listed in `src/game/data/levels.ts` whose
`public/<file>` exists is picked up by the level unit test and the bot spec. Specs that need a
real `LEVELS` entry (menu flow, unlocks) fall back to `test.json` for maps that don't exist yet
(`harness.aliasMissingLevels()`), noted as a test annotation.

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
| `getSave()`, `clearSave()` | Save = localStorage `cfa-save`. |
| `levels()`, `useMap(id, file)`, `aliasMissingLevels()` | Which LEVELS maps exist; substitute test.json. |
| `scenes()`, `isActive(key)`, `sceneTexts(key)`, `sceneObjects(key, type)` | UI assertions. |
| `stats()` | textures, display-list sizes, bodies, tweens, listener counts, JS heap. |
| `measureFps(ms)` | Real render frame times. |
| `bot(options)` | Runs the platforming bot (below). |

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

`src/game/debug/PlatformBot.ts`, run via `await __harness.bot({ levelId, character, invulnerable })`.
Holds right; while grounded it scans the tile layers ahead (ground/oneway/hazards/water) and
enemies, and jumps when a wall, gap, hazard or enemy is within a lead distance computed from
the character's speed and jump velocity. On death (revived in place, the scene isn't
restarted) or no progress for 4 s it rewinds to an earlier safe ground position (further back
on each attempt) and retries with the next jump-timing variant (run/walk, earlier/later jump,
short/long hold). After `maxAttemptsPerSection` (10) it gives up and reports `stuckAt`.

Result: `{ completed, progress, maxX, goalX, deaths, rewinds, failures[], stuckAt, simSeconds }`.
A failure is a lead for a human, not proof of an impossible level — the bot doesn't plan
routes, climb via one-way platforms above it, use abilities, wait for moving platforms, or
backtrack left.

## Known defects / flaky areas

- **Grounded flicker (open defect).** On flat ground `Player.grounded` toggles every frame:
  the motor sets `vy = 0` when grounded and the body has gravity disabled, so the next physics
  step doesn't touch the floor (`blocked.down = false`), gravity pulls it back the frame after.
  Effects: `onLand` fires every other frame (dust puffs, `land` sfx, squash tween that also
  resizes the Arcade body), jump/fall animation flicker. Repro: `?debug`, hold → on the
  ground — the dust trail and `g0/g1` alternating in the debug line. Tracked by the
  `test.fail` test in `gameplay.spec.ts` (it will report "unexpectedly passed" once fixed —
  then delete the `test.fail` line). Likely fix (player team): keep a small downward velocity
  while grounded (e.g. `vy = gravity * dt`) or detect ground with a probe.
- **FPS in CI / containers** is software WebGL (SwiftShader): expect 25–40 fps; the perf spec only warns.
- **Real-time specs** (pause, death respawn, touch) depend on wall-clock timers; they use
  generous `waitForFunction` timeouts. If they flake under heavy load, run with `--workers=1`.
- Keyboard input: Phaser polls key state per frame, so specs hold keys (`holdKey`) instead of
  `keyboard.press` for in-game controls (menus use keydown events and are fine with `press`).
- `favicon.ico` 404 is ignored by the console-error check (no favicon yet).
