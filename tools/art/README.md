# tools/art — sprite extraction pipeline

Requires Python 3 + Pillow + numpy (no scipy). All outputs are reproducible:

```sh
python3 tools/art/extract_characters.py   # characters + HUD portraits
python3 tools/art/extract_enemies.py      # enemies (pass kind names to rebuild a subset → enemies-partial.png)
python3 tools/art/validate_atlases.py     # contract checks (exit 1 on failure)
node tools/art/build-manifest.mjs         # regenerate public/assets/manifest.json
```

`artlib.py` holds the shared pipeline: background flood-fill from the cut-out border
(colour tolerance against the median border colour, plus enclosed background pockets),
connected components, box-downsample by one float factor per sprite set (target pixel is
opaque when ≥50% of its source block is foreground; colour = median of foreground
pixels), one shared median-cut palette per atlas, dark 1px inner outline on the
silhouette edge (kills any navy fringe), hard alpha only, bottom-centre placement.
Previews (4x, checkerboard, red baseline) go to `art/previews/`.

## Characters — `public/assets/characters/<id>.png/.json`

Source: `art/reference/family-characters-sheet.png` (Grandma row skipped). All frames
48x48, facing right, feet on the bottom row (except deliberate hops, see below).

| id | idle-pose height | downscale |
|---|---|---|
| dad | 37 px | 2.11 |
| mom | 35 px | 2.34 |
| brennan | 31 px | 2.52 |
| parker | 29 px | 2.72 |
| lupin | 18 px sitting (≈22-26 px walking/running) | 2.78 |

Frames (sheet has 2 idle, 3 walk, 3 run, 1 jump/fall/crouch, 2 attack, 1 hurt/die):

- `idle_0-3`: idle A, idle A squashed 1px (breath), idle B, idle B squashed.
- `walk_0-5`, `run_0-5`: the 3 sheet poses twice, 2nd cycle starts with a 1px-squashed pose (Lupin: 2 poses + squashed variants).
- `jump_0-1`, `fall_0-1`: sheet pose, then 1px stretched.
- `land_0-1`: crouch pose, then idle squashed 2px.
- `crouch_0-1`: crouch, crouch squashed 1px.
- `attack_0-3`: wind-up, strike, strike squashed, wind-up. Attack FX (swooshes, ball, sparkles, energy) are erased — they are separate effect sprites. Lupin: crouch → lunge → lunge +2px → squashed.
- `hurt_0-1`: hurt pose, hurt shifted 2px back.
- `victory_0-5`: idle, crouch, jump pose lifted 3/6/3 px (hop — intentionally off the ground), idle squashed.
- `defeat_0-3`: hurt, hurt squashed, DIE pose ×2.
- `ability_0-3`: dad ground pound (jump rise, tucked crouch in the air 8px/4px up, slam squash); mom air-jump (jump, mirrored jump = spin, stretched jump, mirrored fall); brennan dash (run poses leaned forward with a shear); parker energy blast (attack poses without the energy FX); lupin sniff (crouch with head/front lowered 1-2px).

HUD portraits: `public/assets/ui/portrait-<id>.png` (24x24, manifest key `portrait-<id>`), cut from the idle pose head at a finer scale.

## Enemies — `public/assets/enemies/<kind>.png/.json`

Frames `idle_n, move_n, attack_n, hit_n, die_n` (2-4 each), bottom-centre, facing right.
`hit_0` is a white flash, `hit_1` a red tint (or the sheet's hit pose); the last `die`
frames of several kinds dissolve and may not touch the bottom row.

| kind | frame | source | notes |
|---|---|---|---|
| pigeon | 24x24 | enemies sheet, Chicago interactives | 3 standing + 1 fly-away pose; die = upside-down, flattened |
| rat | 32x20 | enemies sheet, rat scurry | attack = leap pose; die = flattened |
| raccoon | 44x28 | Chicago sheet | holds its manhole-cover shield (wider than suggested 32) |
| coneGuy | 28x32 | Chicago sheet | single pose; lean/squash derived, stomp-flatten die |
| turnstileBot | 36x32 | Chicago sheet | single pose; derived |
| securityDrone | 36x24 | Chicago sheet | single pose; sway/lean derived |
| windowWasher | 44x40 | Chicago sheet | squeegee spray erased; pole + bucket kept |
| gnat | 28x24 | enemies sheet | |
| skirmisher | 60x48 | enemies sheet | width driven by the lying death pose; attack = ranged poses (shot FX removed) |
| wasp | 32x28 | enemies sheet | |
| warlord | 68x56 | enemies sheet | attack = projectile + slash poses (slash arc trimmed) |
| juggernaut | 88x72 | enemies sheet | attack = crouch + ranged pose (smash pose dropped: dust/arm too large) |
| overseer | 80x96 | enemies sheet | single pod pose; tentacle sway, glow/tint attack, dissolve die |
| eliminator | 128x112 | Chicago sheet "THE EL" | single pose (no flip, so "CTA" reads correctly); attack = telescoping right arm (+4/+8px); no separate `arm_0` part frame |

Frame sizes start from the suggested size and grow in 4px steps when a pose needs more
room (logged by the script). Physics bodies should be sized in code, not from frame size.

## Known weak spots
- Single-pose Chicago enemies (raccoon, coneGuy, turnstileBot, securityDrone,
  windowWasher, eliminator) have procedurally derived motion (lean/squash/sway), not real
  walk cycles.
- Small sources at 2.5-2.8x downscale (parker, lupin, gnat) lose some facial detail.
- Some gnat/wasp/skirmisher die frames keep small spark bits from the sheet.

---

# Environment art (tiles, backgrounds, items, props, effects, platforms, UI, logo, map)

Everything below is drawn procedurally in PIL at native resolution (no AI pixels):
named palette + hard alpha + 1px dark (`ink` #1a1c2c) outlines on sprites, seeded RNG,
so every output is reproducible. Shared helpers live in `pxl.py` (palette `P`, canvas
`Cv`, 3x5 `FONT3` / 5x7 `FONT5` pixel fonts, `pack_atlas` → Phaser JSON Hash,
`contact_sheet` previews).

```sh
python3 tools/art/draw_backgrounds.py   # public/assets/backgrounds/bg-<theme>-<layer>.png
python3 tools/art/draw_tiles.py         # public/assets/tilesets/chicago-tiles.png (+ tiles-demo uses the day bg)
python3 tools/art/draw_items.py         # items.png/json + ui.png/json
python3 tools/art/draw_props.py         # props.png/json
python3 tools/art/draw_effects.py       # effects.png/json
python3 tools/art/draw_platforms.py     # platforms.png/json
python3 tools/art/draw_logo_map.py      # logo.png, world-map.png, pixel-font.png
python3 tools/art/validate_env.py       # contract checks for all of the above
node tools/art/build-manifest.mjs
```

Previews in `art/previews/`: `tiles-sheet.png` (indexed), `tiles-seams.png` (3x4 self-tiling
check of every fill under its top tile), `tiles-demo.png` (sample scene over the day
parallax), `backgrounds.png` (all four themes composited), `items/ui/props/effects/platforms.png`,
`logo.png`, `world-map.png`.

## Tileset
`chicago-tiles.png` 256 wide, 16 columns, as many rows as `TILE_COUNT` needs (608 tiles = 38 rows).
Order is generated from `src/game/data/tiles.ts` (the script parses the contract and asserts every
name is drawn). Rows 0-3 (indices 0-63) are the original hand-placed tiles and stay stable.
Fill tiles are 16px-periodic; every `*_TOP` tile is its fill pattern with a bright walkable top band.
Open/partial tiles (GIRDER_X, GIRDER_POST, SCAFFOLD_*, CHAIN_FENCE, PIPE_H, WOOD_POST, BRIDGE_TRUSS/RAIL,
RAILING, BUSH, AWNING_*, WATER_TOP surface, SPIKES, ELECTRIC_RAIL arcs) have transparency.
Notes: RAIL = steel running rail on ties on a girder (walkable track top); RAIL_TIE = ties
only. WATER is static. BRIDGE_* steel is slate green-grey to read differently from the
rust-red L steel.

### Materials (rows 4-33, `tools/art/draw_terrain.py`)
Ten auto-tiled materials — CONC (sidewalk over board-formed concrete), LIME (limestone ashlar,
cornice cap), BRICK (bold running bond, limestone coping), GIRD (riveted L steel), RWALK (granite
pavers over big granite blocks, algae deep down), STONE (river rubble wall), ROOF (metal parapet
coping over a slate precast wall), ASPH (road with lane paint over a gravel road base), DECK (bridge
plate girder), WACK (Lower Wacker slab with sodium lamps on its underside). Each has the same 48 slots
(`${MAT}_${SUFFIX}`, 3 rows, see `MATERIAL_SUFFIXES`): caps `T0-T3` + rare `X0/X1`, corners `TL/TR/TLR`,
inner corners `IL/IR`, one-tile slabs `S*`, side edges `L/R/LR`, near-surface fills `F0-F6` + rare
`X2/X3`, undersides `B*` (shadowed), and darker depth tiers `D*` (2-3 tiles down) / `E*` (4+, incl.
`DL/DR/EL/ER` edges). Every walkable top has a bright lit lip; edges have a dark outline + inner
highlight (left) / shade (right). Variant details (cracks, stains, tie holes, rivets, rust, plaques,
mooring rings...) stay inside the tile so any variant tiles with any other.

### Facade decor (rows 34-37)
Background-only, flatter and lower contrast than the solids and never with a lit lip: brick (`FB_*`)
and limestone (`FL_*`) walls, cornices (`*_CORN_L/_/R`), quoined edges, unlit / lit / blind / AC / TV
windows, Chicago windows and arches, fire escape (window, rail, stair), belt-course ledges,
storefront sign band (`BAND_*`), rooftop water tower (2x2 `WT_*`), HVAC / stacks / antenna, a vertical
"CHICAGO" marquee (`SIGN_V_TOP`, `SIGN_V1-4`), Lower Wacker wall / lamp / guide sign / exit / beam /
pillar (+ striped base), lit / dark curtain-wall glass and a CTA sign. The level compiler places them
(see `tools/levels/autotile.mjs`).

Previews: `art/previews/tiles-sheet.png` (all indices), `terrain-before-after-<level>.png`.

## Backgrounds
sky 480x270 (opaque, ordered-dither gradient + clouds); far/mid/near 960x270, drawn with
x-wrapping so they tile seamlessly. Content: far = skyline incl. Willis, Hancock, Trump,
Aon, crown/spire towers; mid = day/sunset: hazed mid-rises + an L line with a train,
rooftop: neighbouring rooftops + L below, river: far bank (Marina City, Wrigley Building),
river with bascule bridges and a tour boat; near = trees/lamps/hedge (day, sunset),
riverwalk railing (river), parapet + HVAC/water tanks/antennas/billboards (rooftop).
Mid/far are hazed toward the sky colour so playfield tiles stay the highest-contrast layer.

## Atlases (frame sizes)
- **items**: coin_0-5, star_0-3, question_0-3, hotdog, pizza, cta_pass, one_up (red Chicago star),
  souvenir_0-2, block_used, brick, bounce_pad_0/1 (0 = extended, 1 = compressed) — all 16x16.
  checkpoint_off/on **34x48** (pole centred at x=17, flag extends right), goal_pole **54x96**
  (pole centred, Chicago flag attached), goal_flag 27x17 (standalone flag).
- **props** (bottom-anchored, variable sizes): lamp 16x48, hydrant 14x16, hotdog_cart 52x44,
  bench 32x16, flag_pole 32x48, cone 12x16, barricade 32x22, news_box 16x24, trash_can(_broken)
  18x18, planter 32x22, traffic_light 14x48, sign_wacker 44x34, sign_michigan 52x34, clock 18x48,
  cta_entrance 48x48, bus_shelter 48x40, steam_vent 16x8, mailbox 16x22, tree 32x48.
  Anims: pigeon_idle_0-3 / pigeon_fly_0-3 16x16, steam_0-5 16x32 (rising puffs, loop),
  train_light_0-5 16x24 (railroad-crossing flasher, alternates every 3 frames).
- **effects** (centred): dust 16x16x5, spark 16x16x4, explosion_small 24x24x6, explosion_large 48x48x8,
  smoke 24x24x6, coin_burst 24x24x5, poof 24x24x5, energy_shot 16x16x4, alien_laser 24x8x4,
  plasma_shot 16x16x4, drone_shot 12x12x4, shockwave 64x24x6, sniff 16x16x6, air_puff 24x16x5,
  dash_trail 24x16x4, spawn_ring 32x32x6; debris_0/1 8x8; bolt 12x16 (lightning bolt).
  Projectiles face right.
- **platforms**: girder_2/3/4 32/48/64x16, plank_2/3 32/48x**8**, scaffold_3 48x16,
  train_car 128x40, train_front 128x40 (lead car, cab on the right), boat 112x36 (top deck at y≈5-10),
  bus 104x40, taxi 56x26, cop_car 56x26. Vehicles face right.
- **ui**: heart_full/empty 11x10, coin_icon/star_icon/souvenir_icon(_empty) 12x12, lock 12x14,
  btn_left/right/jump/action/pause 32x32 (opaque grey disc + white glyph: set alpha ~0.5 in code),
  map_node(_locked/_done) 14x14.

## Single images
- `logo.png` 304x84 — "CHICAGO" on a Chicago-flag ribbon + "FAMILY ADVENTURE" banner.
- `world-map.png` 480x270. District centres (for map nodes): loop (306,150), lincoln-park (318,72),
  wrigleyville (290,22), navy-pier (398,110), museum-campus (382,196), chinatown (250,206),
  south-side (276,242), ohare (62,44). The Loop is drawn highlighted; the rest are greyed.
- `pixel-font.png` 96x24 — white 5x7 font in 6x8 cells, 16 per row, for Phaser RetroFont:
  `chars: " !'-.,:/?0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"`, width 6, height 8, charsPerRow 16
  (key `pixel-font`).
