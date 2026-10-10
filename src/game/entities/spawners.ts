import { registerSpawner } from '../world/registry';
import type { PickupKind } from '../types';
import { Pickup } from './Collectible';
import { Checkpoint, Goal } from './Triggers';

/** Spawners for pickups and core triggers. Object `type` names are the level-format contract. */

const PICKUPS: PickupKind[] = ['coin', 'hotdog', 'pizza', 'ctaPass', 'star', 'oneUp'];
for (const kind of PICKUPS) {
  registerSpawner(kind, (ctx, o) => {
    new Pickup(ctx, o.x, o.y - 8, kind);
  });
}
registerSpawner('souvenir', (ctx, o) => {
  new Pickup(ctx, o.x, o.y - 8, 'souvenir', Number(o.props.index ?? 0));
});
registerSpawner('checkpoint', (ctx, o) => {
  new Checkpoint(ctx, o);
});
registerSpawner('goal', (ctx, o) => {
  new Goal(ctx, o);
});
