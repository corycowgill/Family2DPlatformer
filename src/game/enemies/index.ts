import { registerSpawner } from '../world/registry';
import type { EnemyKind } from '../types';
import type { LevelContext, SpawnObject } from '../world/LevelContext';
import type { Enemy } from '../entities/Enemy';
import { Rat } from './Rat';

type EnemyFactory = (ctx: LevelContext, obj: SpawnObject) => Enemy;

/** Enemy registry: Tiled object type "enemy" with property `kind`. */
export const ENEMY_FACTORIES: Partial<Record<EnemyKind, EnemyFactory>> = {
  rat: (ctx, o) => new Rat(ctx, o),
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
