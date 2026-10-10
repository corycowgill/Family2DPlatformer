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
