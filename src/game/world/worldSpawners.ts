import { registerSpawner } from './registry';
import { BouncePad, FallingPlatform, MovingPlatform, TrainPlatform } from '../entities/Platforms';
import { Block } from '../entities/Blocks';
import { KillZone, PassingTrain, SteamVent } from '../entities/Hazards';
import { Newspapers, PigeonFlock, Sign, TrashCan, spawnProp } from '../entities/Props';
import { CameraZone, Secret } from '../entities/Secrets';
import { applyLevelStyle, spawnDarkZone } from './LevelStyle';

/**
 * World-entity spawners (Level / world team). Object syntax in tools/levels/src/*.txt
 * `@objects` (tile coords = bottom-left cell; width/height in tiles):
 *
 *   movingPlatform <tx> <ty> width=3 dx=6 dy=0 period=4 style=girder|plank|scaffold|train phase=0 oneWay=true pause=0
 *   fallingPlatform <tx> <ty> width=2 [style=plank] [respawn=4]
 *   collapsingScaffold <tx> <ty> width=3 [respawn=4]
 *   trainPlatform <tx> <ty> width=8 dx=30 period=12 pause=1.5
 *   passingTrain <tx> <ty> width=<lane> height=3 [hazard=true] interval=6 offset=1 dir=1|-1 cars=3 speed=480
 *   bouncePad <tx> <ty> [power=560]                 (grid char J)
 *   block <tx> <ty> kind=question|brick contents=coin|coins5|hotdog|pizza|ctaPass|star|oneUp   (grid ? and %)
 *   steamVent <tx> <ty> period=3 offset=0 height=4 [lift=true]
 *   sign <tx> <ty> text=Hold_RUN_to_jump_farther
 *   prop <tx> <ty> frame=lamp [front=true] [flip=true] [scale=1]
 *   pigeons <tx> <ty> count=4 width=4
 *   trashCan <tx> <ty> [contents=coin|hotdog|none]
 *   newspapers <tx> <ty>
 *   secret <tx> <ty> width=.. height=..
 *   cameraZone <tx> <ty> width=.. height=..
 *   killZone <tx> <ty> width=.. height=..
 *   levelStyle 0 0 [bgTint=8c93b6]                 (tints the decor tile layer; default per theme)
 *   darkZone <tx> <ty> width=.. height=.. alpha=0.35
 */
registerSpawner('movingPlatform', (ctx, o) => void new MovingPlatform(ctx, o));
registerSpawner('fallingPlatform', (ctx, o) => void new FallingPlatform(ctx, o, 'plank'));
registerSpawner('collapsingScaffold', (ctx, o) => void new FallingPlatform(ctx, o, 'scaffold'));
registerSpawner('trainPlatform', (ctx, o) => void new TrainPlatform(ctx, o));
registerSpawner('passingTrain', (ctx, o) => void new PassingTrain(ctx, o));
registerSpawner('bouncePad', (ctx, o) => void new BouncePad(ctx, o));
registerSpawner('block', (ctx, o) => void new Block(ctx, o));
registerSpawner('steamVent', (ctx, o) => void new SteamVent(ctx, o));
registerSpawner('sign', (ctx, o) => void new Sign(ctx, o));
registerSpawner('prop', (ctx, o) => spawnProp(ctx, o));
registerSpawner('pigeons', (ctx, o) => void new PigeonFlock(ctx, o));
registerSpawner('trashCan', (ctx, o) => void new TrashCan(ctx, o));
registerSpawner('newspapers', (ctx, o) => void new Newspapers(ctx, o));
registerSpawner('secret', (ctx, o) => void new Secret(ctx, o));
registerSpawner('cameraZone', (ctx, o) => void new CameraZone(ctx, o));
registerSpawner('killZone', (ctx, o) => void new KillZone(ctx, o));
registerSpawner('levelStyle', (ctx, o) => applyLevelStyle(ctx, o));
registerSpawner('darkZone', (ctx, o) => spawnDarkZone(ctx, o));
