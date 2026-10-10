# Chicago Family Adventure — agent guide

Browser 2D platformer: TypeScript + Phaser 3.90 (Arcade physics) + Vite. Logical resolution 480×270, pixel art.

## Commands
- `npm run dev` — dev server (append `?level=loop-1` to jump into a level, `?debug` for hitboxes/FPS/hotkeys)
- `npm run levels` — compile `tools/levels/src/*.txt` → `public/levels/*.json` (`levels:check` validates only)
- `npm run typecheck`, `npm test` (Vitest, `tests/unit`), `npm run test:e2e` (Playwright, `tests/e2e`)
- `npm run build` — levels + typecheck + production build to `dist/`
- Playwright: use the preinstalled Chromium (`executablePath: '/opt/pw-browsers/chromium'`), never `playwright install`.

## Architecture (contracts owned by the tech lead — coordinate before changing)
- `src/game/types.ts` — shared types and `EV` event names.
- `src/game/config.ts` — all physics tuning, depths.
- `src/game/data/tiles.ts` — tileset index contract (art draws, levels place).
- `src/game/data/assets.ts` — asset/atlas/frame-naming contract; runtime loads everything listed in `public/assets/manifest.json`.
- `src/game/world/LevelContext.ts` — what entities receive; `world/registry.ts` maps Tiled object `type` → spawner. Each team registers spawners in its own module, imported from `world/registerAll.ts`.
- Pure logic (no Phaser imports) lives in `systems/PlayerMotor.ts`, `systems/SaveSystem.ts` etc. so it is unit-testable in Node.
- Missing art falls back to generated placeholders (`systems/PlaceholderArt.ts`) — the game must always run.

## Ownership
| Area | Paths |
|---|---|
| Tech lead | `src/main.ts`, `src/game/{config,types,main-config}.ts`, `src/game/data/*`, `src/game/world/{LevelContext,registry,registerAll}.ts`, `src/game/scenes/LevelScene.ts` |
| Player mechanics | `src/game/entities/Player.ts`, `src/game/characters/*`, `src/game/systems/{PlayerMotor,Abilities,InputSystem}.ts` |
| Levels / world | `tools/levels/**`, `public/levels/**`, `src/game/world/*` (except contracts), `src/game/entities/{Platforms,Blocks,Hazards}.ts` |
| Enemies / bosses | `src/game/enemies/**`, `src/game/entities/{Enemy,Boss,Projectile}.ts`, `src/game/systems/CombatSystem.ts` |
| Art | `tools/art/**`, `public/assets/**` (except audio), `art/**` |
| UI / audio | `src/game/scenes/{Menu,CharacterSelect,WorldMap,HUD,Pause,Results,Boot,Preload}Scene.ts`, `src/game/ui/**`, `src/game/systems/{Audio*}.ts` |
| QA | `tests/**`, `playwright.config.ts`, `.github/workflows/**` |

## Rules
- Keep `main` playable: `npm run build && npm test` must pass before merging.
- Don't claim a feature works until you have run it (unit test or browser check).
- Prefer data-driven content (level files, config tables) over hardcoding in scenes.
