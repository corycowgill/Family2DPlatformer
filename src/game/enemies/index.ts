import { registerSpawner } from '../world/registry';
import type { EnemyKind } from '../types';
import type { LevelContext, SpawnObject } from '../world/LevelContext';
import type { Enemy } from '../entities/Enemy';
import { Rat } from './Rat';
import { Pigeon } from './Pigeon';
import { Raccoon } from './Raccoon';
import { ConeGuy } from './ConeGuy';
import { TurnstileBot } from './TurnstileBot';
import { SecurityDrone } from './SecurityDrone';
import { WindowWasher } from './WindowWasher';
import { Gnat } from './Gnat';
import { Skirmisher } from './Skirmisher';
import { Wasp } from './Wasp';
import { Warlord } from './Warlord';
import { Juggernaut } from './Juggernaut';
import { Overseer } from './Overseer';
import { OverseerBoss } from './OverseerBoss';
import { Eliminator } from './Eliminator';

type EnemyFactory = (ctx: LevelContext, obj: SpawnObject) => Enemy;

/**
 * Enemy registry: Tiled object type "enemy" with property `kind`.
 * Common optional props: `hp`, `damage` (overrides), `facing` (left|right), `speed`, `range`.
 */
export const ENEMY_FACTORIES: Record<EnemyKind, EnemyFactory> = {
  rat: (ctx, o) => new Rat(ctx, o),
  pigeon: (ctx, o) => new Pigeon(ctx, o),
  raccoon: (ctx, o) => new Raccoon(ctx, o),
  coneGuy: (ctx, o) => new ConeGuy(ctx, o),
  turnstileBot: (ctx, o) => new TurnstileBot(ctx, o),
  securityDrone: (ctx, o) => new SecurityDrone(ctx, o),
  windowWasher: (ctx, o) => new WindowWasher(ctx, o),
  gnat: (ctx, o) => new Gnat(ctx, o),
  skirmisher: (ctx, o) => new Skirmisher(ctx, o),
  wasp: (ctx, o) => new Wasp(ctx, o),
  warlord: (ctx, o) => new Warlord(ctx, o),
  juggernaut: (ctx, o) => new Juggernaut(ctx, o),
  // `boss=true` (or the boss spawner) → the full World 2 boss; otherwise the small hovering pod.
  overseer: (ctx, o) => (o.props.boss === true ? new OverseerBoss(ctx, o) : new Overseer(ctx, o)),
  eliminator: (ctx, o) => new Eliminator(ctx, o),
};

registerSpawner('enemy', (ctx, o) => {
  const kind = String(o.props.kind ?? 'rat') as EnemyKind;
  const f = ENEMY_FACTORIES[kind];
  if (!f) {
    console.warn(`Unknown enemy kind "${kind}"`);
    return;
  }
  f(ctx, o);
});

/**
 * Boss spawner: Tiled object type "boss". The object's rectangle is the arena (its bottom
 * edge = the floor), or use props arenaX/arenaWidth/arenaHeight (px). Prop `kind`
 * (default eliminator; `overseer` = the World 2 boss). A non-boss kind (e.g. warlord) is spawned with `boss=true`.
 */
registerSpawner('boss', (ctx, o) => {
  const kind = String(o.props.kind ?? 'eliminator') as EnemyKind;
  if (kind === 'eliminator') {
    new Eliminator(ctx, o);
    return;
  }
  if (kind === 'overseer') {
    new OverseerBoss(ctx, o);
    return;
  }
  const f = ENEMY_FACTORIES[kind];
  if (!f) {
    console.warn(`Unknown boss kind "${kind}"`);
    return;
  }
  f(ctx, { ...o, width: 16, height: 16, props: { ...o.props, boss: true } });
});
