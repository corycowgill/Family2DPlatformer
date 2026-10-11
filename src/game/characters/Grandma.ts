import type { CharacterDef } from '../types';

/** Secret 6th hero — unlocked by beating the World 1 boss (see systems/Rewards.ts). */
export const Grandma: CharacterDef = {
  id: 'grandma',
  name: 'Grandma',
  ability: 'panSpin',
  abilityName: 'Frying Pan Spin',
  abilityDescription: 'Spin your trusty frying pan to bonk enemies on both sides. Once per jump it slows your fall.',
  ratings: { speed: 2, jump: 3, ability: 4 },
  stats: { walkSpeed: 90, runSpeed: 150, groundAccel: 880, groundDecel: 1100, airAccel: 650, jumpVelocity: 362, runJumpBonus: 54 },
  body: { width: 12, height: 28, crouchHeight: 17 },
  abilityCooldownMs: 650,
  color: 0x9b59d0,
};
