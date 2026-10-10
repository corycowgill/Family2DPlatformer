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
- `bot.spec.ts` — bot completes the test level with all five characters (damage on); widened
  gap; impassable wall ⇒ stuck report; every existing `LEVELS` map with every character
  (invulnerable; **warning only**, with screenshot + JSON attachments).
- `perf.spec.ts` — FPS over 5 s of scripted play (report; warns below 50 fps);
  10 level restarts: textures / listeners / bodies / display list stable, heap growth reported.

New levels are covered automatically: anything listed in `src/game/data/levels.ts` whose
`public/<file>` exists is picked up by the level unit test and the bot spec. Specs that need a
real `LEVELS` entry (menu flow, unlocks) fall back to `test.json` for maps that don't exist yet
(`harness.aliasMissingLevels()`), noted as a test annotation.

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
| `getSave()`, `clearSave()` | Save = localStorage `cfa-save`. |
| `levels()`, `useMap(id, file)`, `aliasMissingLevels()` | Which LEVELS maps exist; substitute test.json. |
| `scenes()`, `isActive(key)`, `sceneTexts(key)`, `sceneObjects(key, type)` | UI assertions. |
| `stats()` | textures, display-list sizes, bodies, tweens, listener counts, JS heap. |
| `measureFps(ms)` | Real render frame times. |
| `bot(options)` | Runs the platforming bot (below). |

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

- **Grounded flicker (fixed on main).** Before the fixed-step motor, `Player.grounded`
  toggled every frame on flat ground (vy = 0 with gravity off → no floor contact on the next
  step): `onLand` fired every other frame (dust trail, `land` sfx, squash tween resizing the
  body). Now a regression test in `gameplay.spec.ts`.
- **Bot limits on the real levels** (warnings, not failures): it doesn't climb one-way
  platform staircases to get over tall walls (loop-2 ≈ x 1547, the TTTT wall at column 98),
  and it can walk into the pocket under the loop-3 overhang (≈ x 1578, columns 96–100) instead
  of taking the bridge above. Characters with better jumps get through some of these.
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
