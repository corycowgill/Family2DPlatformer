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

Source: `art/reference/family-characters-sheet.png`. All frames
48x48, facing right, feet on the bottom row (except deliberate hops, see below).
`python3 tools/art/extract_characters.py [ids...]` rebuilds a subset (no contact sheet).

| id | idle-pose height | downscale |
|---|---|---|
| dad | 37 px | 2.11 |
| mom | 35 px | 2.34 |
| brennan | 31 px | 2.52 |
| parker | 29 px | 2.72 |
| lupin | 18 px sitting (≈22-26 px walking/running) | 2.78 |
| grandma | 33 px | 2.36 |

Grandma (secret 6th hero) uses the same human rig; her frying pan is a rig prop drawn in
the near hand only in `attack` (wind-up, overhead, smash, follow-through) and `ability`
(Frying Pan Spin: pan out front / overhead / mirrored behind — loops).

### Costumes (`costumes.py`) — `public/assets/characters/<id>-<costume>.png/.json`

`python3 tools/art/extract_characters.py --costumes [ids...]` renders the 18 costume
variants of the sheet's POWER-UPS column as full atlases (same 44 frames, frame names,
`meta.anims` and contract as the base atlas) plus `public/assets/ui/portrait-<id>-<costume>.png`
(24x24, idle head + hat at 1x). Previews: `art/previews/costumes-<id>.png` (every frame)
and `anim-<id>-<costume>.gif`. The costume is applied to the rig *before* posing, so it
can't drift or tear between frames:

- limb palette swap (sleeves / trouser bands / shoes), torso pixels remapped by role
  (shirt above the hips, trousers below, same tone index) + painted straps / aprons / belts;
- `hood`: hair recoloured (+1 px growth) into a hood; `hat`: hand-authored pixel sprite
  anchored to the head bbox (head + torso sprites are padded so hats can rise above);
- `back`: cape / tail drawn behind the body from the rig's hip & shoulder each frame;
- `item`: prop in the front hand (wand, sword, spatula, flowers; Dad's fireball only in
  `attack`); Grandma's pan still wins in her attack / ability frames;
- Lupin: cape over the back, bee stripes + antennae + wings, firefighter helmet + coat.

| id | costumes (ids, tier 1 / 2 / 3) |
|---|---|
| dad | `flame` red tee + fireball punch, `raccoon` hood/ears/striped tail, `hardhat` hard hat + overalls |
| mom | `wand` star wand, `cat` white kitty hood/ears/tail + pink suit, `chef` toque + apron + spatula |
| brennan (Bro2) | `knight` blue tunic, red cape, sword, `raccoon`, `elf` green hat + tunic |
| parker (Bro1) | `cap` sky-blue "Chicago cap" with a red six-point Chicago star (original, no letter logo), red shirt + navy overalls, `dino` green dino hood + tail, `propeller` beanie |
| lupin | `cape`, `bee`, `firefighter` |
| grandma | `princess` crown + pink dress (skirt), `sporty` headband + tank + shorts, `gardener` straw hat + overalls + flowers |

Ids must match `src/game/systems/Rewards.ts` (`COSTUMES`); unlock rules live there too.

### Animation rig (`rig.py`, `animate_characters.py`, `animate_dog.py`)

The sheet only has 2-3 poses per action, so every character frame is re-posed by a small
part rig instead of padding the sheet poses with squash/offset copies:

- **Humans**: head and torso+pelvis are the original pixels of the clean idle pose (cut by
  per-character boxes in `HUMANS`); arms (sleeve, forearm, fist), legs (trouser / shorts /
  skin / sock bands) and side-view shoes are redrawn as rig limbs (4x4-supersampled capsule
  chains, 2-bone IK for legs, FK for arms) with colours snapped to the sprite's own palette.
- **Lupin**: body, head (ear, rainbow collar, tongue touch-ups) and tail from the sheet's
  walk pose; four fluffy legs + paws are rig limbs; the tail wags with a rotsprite rotation.
- `Canvas.finish()` draws one 1px outline around the composite silhouette plus contours
  where a part overlaps another (near arm over torso, near leg over far leg...), so limbs
  never tear away and there are no outline gaps. Rotations use rotsprite (8x nearest
  upscale, rotate, majority-vote downscale); 90-degree steps are exact.
- Pose tables (`common_poses`, `ATTACKS`, `ABILITIES`, `dog_poses`) are keyed at Dad's leg
  length and scaled per character. Feet are planted on the bottom row on contact frames and
  a planted foot slides back exactly `stride` px per frame.

| anim | frames |
|---|---|
| idle | rest, breathe (1px dip), rest, blink (Lupin: tail wag) — per-frame durations in meta |
| walk | 6: contact (heel), down, passing, toe-off, swing x2 — arms counter-swing (Lupin: trot) |
| run | 6: contact, down, flight (both feet up), x2 — torso lean, bent arms (Lupin: bound) |
| jump / fall | launch, rising / apex (arms out), falling (arms up) |
| land / crouch | squash 4px, recover / hunch 4px, 6px |
| attack | dad shoulder-bump punch, mom sparkle-hand thrust, brennan soccer kick (leg in front), parker two-hand push, lupin pounce + bite |
| hurt / defeat | recoil (eyes shut) / recoil, tilt 40, lying, lying limp |
| victory | crouch, hop up with fist pump, peak, fall, land, fist raised (Lupin: hop + spin) |
| ability | dad tuck -> ground-pound slam pose, mom tucked front flip, brennan dash lean, parker blast push + recoil, lupin nose-down sniff |

Runtime timing lives in each atlas JSON (`meta.anims`): `fps`, per-frame `durations`, and
for walk/run the `stride` (px of ground per frame). `AnimationSystem.playAnim` scales
walk/run playback to the body's real speed (`speed / (stride * fps)`, clamped 0.55-2.0), so
feet stay planted at any speed instead of skating or moonwalking.

Downscale uses `dark_frac=0.45` (feature-preserving: a block that is >=45% dark takes the
dark colour) so glasses, eyes and mouths survive; eye pixels are then set explicitly
(`HUMANS[*]['eyes']`) for a readable blink.

Previews: `art/previews/anim-<id>.gif` (every anim at its runtime rate, 4x; walk/run cells
scroll a ground strip at the nominal stride speed — planted feet must move with the
ticks) and `anim-<id>.png` frame strips.

HUD portraits: `public/assets/ui/portrait-<id>.png` (24x24, manifest key `portrait-<id>`), cut from the idle pose head at a finer scale.

## Enemies — `public/assets/enemies/<kind>.png/.json`

Frames `idle_n, move_n, attack_n, hit_n, die_n` (idle/move 2-8, attack 2-6, hit 2-4, die 2-6),
bottom-centre, facing right (coneGuy also has a looping `shell`). Rig-animated anims come from
`animate_enemies.py` (see below); anims a kind does not rig keep the sheet-derived frames.
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

### Enemy animation (`animate_enemies.py`)

Each enemy's sheet pose is cut into rigid parts by hand-picked boxes (`PartRig`), re-posed
per frame (offset + rotsprite rotation about a pivot) with procedural pieces where the sheet
has none, and re-outlined by the same `Canvas.finish()` pass:

| kind | rig |
|---|---|
| pigeon | head-bob walk (head thrusts, then holds while the body catches up), thin rig legs, tail bob; looping wing-flap hop-flight |
| rat | gallop-scurry (gather / extend), 4 rig legs, rippling rig tail; crouch + lunge |
| raccoon | 4-leg waddle, head bob, tail swish, lid shield bob (never crosses Raccoon.ts' 68% crop line) |
| coneGuy | rocking waddle on its feet, blink; looping `shell` (feet tucked, eyes shut, wobble) |
| turnstileBot | robot march (legs lift / stomp); rig turnstile bars rotate about a vertical axis — the spin attack sweeps a full 120-degree period over 4 frames |
| securityDrone | edge-on rotor blades spinning, belly light pulse, lens charge / flare on attack |
| wasp | rig thruster flame flicker, eye + side light blink |
| gnat | wing buzz (rotsprite wing), dangling legs |
| windowWasher | squeegee arm wipe, bucket sway, boots dangle (code adds rope bob / shake) |
| skirmisher | stalking scissor-step (legs counter-swing about the hips), claw arm swing |
| warlord / juggernaut | 6-frame stomp walk on one consistent sheet pose (front foot, dip, back foot, dip), cape / claw arm counter-swing |
| overseer | tentacle wave travelling down each tentacle (out of phase), rigid stalk tip pendulum, red core pulse |
| eliminator | stomp walk (far leg lifts + slams, body dips, arms counter-swing, near leg rocks on its toe); cannon-arm wind-up + punch; CTA plate stays readable after the face-left mirror |

`strip_floor` removes the painted floor shadow under some alien sheet poses. Timing per
atlas is in `ENEMY_META` (written to `meta.anims`, `loop` overrides the default play-once).
Previews: `art/previews/anim-<kind>.gif` / `.png` (2x for the 88px+ sprites).

## Known weak spots
- hit/die (and the alien attack) frames still come from the sheet poses / flash-tint-dissolve.
- Small sources at 2.5-2.8x downscale (parker, lupin, gnat) lose some facial detail.
- Some gnat/wasp/skirmisher die frames keep small spark bits from the sheet.
- Kids / Lupin are short-legged for their speed: stride sync hits its 2.0x cap at full
  walk speed (~5-7% residual foot slide).

---

# Environment art (tiles, backgrounds, items, props, effects, platforms, UI, logo, map)

Everything below is drawn procedurally in PIL at native resolution (no AI pixels):
named palette + hard alpha + 1px dark (`ink` #1a1c2c) outlines on sprites, seeded RNG,
so every output is reproducible. Shared helpers live in `pxl.py` (palette `P`, canvas
`Cv`, 3x5 `FONT3` / 5x7 `FONT5` pixel fonts, `pack_atlas` → Phaser JSON Hash,
`contact_sheet` previews).

```sh
python3 tools/art/draw_backgrounds.py   # backgrounds/bg-<theme>-<layer>.png, ambient atlas, AmbientAnchors.ts
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
`python3 tools/art/draw_backgrounds.py` writes, per theme (`day`, `rooftop`, `river`, `sunset`):
sky 480x270 (opaque dithered gradient, sun + glow, distant static clouds / haze streaks),
**clouds 640x176** (drifting cumulus — sunset: lit altostratus bands; loaded as `bg-<theme>-clouds`),
far/mid/near 960x270, all drawn with x-wrapping so they tile seamlessly. ~4.1 MB uncompressed per theme.

Atmospheric perspective is a post-process: rows are drawn in material colours, then `grade()`
pulls them toward the theme's haze (far back row ≈ 60-95 %, far landmark row 30-90 % increasing
toward the base, mid 15-50 %), near layers are darkened/saturated instead. Day/river get a
cool rim light on the left, rooftop/sunset a warm one on the right (sunset: purple silhouettes,
lit window runs).
- far: Willis (stepped tubes, twin antennas), Aon, Two Prudential (gable + spire), Trump
  (setbacks + spire), Crain (diamond top), Hancock (tapered, X-braced), 311 S Wacker crown,
  Board of Trade, plus a hazier back row. Rooftop puts the base at 270 under heavy haze (high vantage).
- mid: day/sunset — Loop mid-rises with water towers, the Chicago Theatre sign, the L structure;
  rooftop — neighbouring roofs seen from above (tanks, AC units) + the L below; river — far bank
  (Marina City corncobs, 330 N Wabash, Wrigley Building, Tribune Tower), bascule bridges, and the
  river with rippled reflections of everything above it (bank at y=160 so it shows above the riverwalk).
- near: trees, twin-globe lamps, hedge + fence (day, sunset with lamp halos), riverwalk railing (river),
  parapet + HVAC/tanks/chimneys/vents/antenna/billboard (rooftop).

The script also writes the **ambient** atlas (`public/assets/ambient.png/json`: `bird_0-3` 9x6 white
silhouettes (tinted at runtime), `train_day|rooftop|sunset` pre-hazed 4-car L trains, `boat_tour`,
`boat_taxi` (+ `_sunset`), `steam_0-3` 12x12, `glint_0-3` 9x9, `px` 2x2 white, `wake_0-1`),
`public/assets/ambient-water.png` (32x8 tileable surface highlight) and the generated
`src/game/world/AmbientAnchors.ts` (dark windows that the sunset twinkle switches on, glint spots,
rooftop vent mouths, L-track and river lines in layer pixels). Runtime: `src/game/world/Ambient.ts`.

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
- **effects** (centred; dust bottom-centred): dust 24x16x6, spark 24x24x5, explosion_small 32x32x8,
  explosion_large 64x64x10, smoke 32x32x8, coin_burst 24x24x6, poof 32x32x7, energy_shot 16x16x4,
  alien_laser 24x8x4, plasma_shot 16x16x4, drone_shot 12x12x4, shockwave 64x24x7 (ground row y=17),
  sniff 24x24x8, air_puff 32x20x6, dash_trail 32x24x5, spawn_ring 40x40x8; debris_0/1 8x8; bolt 12x16.
  Projectile frame sizes are unchanged on purpose (enemy hitboxes derive from them). Projectiles face right.
  Style: puffs/fireballs are unions of spheres lit from the upper left and quantised into 3-5 bands;
  effects fade by shape (shrink / split / bitten away / streaks shorten), never by dither. fps per anim
  live in `src/game/systems/AnimationSystem.ts`. `python3 tools/art/preview_effects.py [anim..]` writes
  `art/previews/fx-anim-<anim>.gif` (4x, day | sunset backdrop, real timing), `fx-strip-<anim>.png`
  and `fx-strips.png`.
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
