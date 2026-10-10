import type { AbilityController, Player } from '../entities/Player';
import type { InputState } from '../types';

/**
 * Character special abilities. Each returns an AbilityController attached to the
 * player. (Owned by the Player Mechanics team — placeholder implementations.)
 */
export function createAbility(player: Player): AbilityController {
  switch (player.def.ability) {
    default:
      return { onPress: (_i: InputState) => {}, update: () => {} };
  }
}

export function attachAbilities(player: Player): void {
  player.ability = createAbility(player);
}
