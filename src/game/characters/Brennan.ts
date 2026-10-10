import type { CharacterDef } from '../types';

export const Brennan: CharacterDef = {
  id: 'brennan',
  name: 'Brennan',
  ability: 'dash',
  abilityName: 'Soccer Dash',
  abilityDescription: 'Burst forward in a quick dash that bowls over small enemies.',
  ratings: { speed: 5, jump: 3, ability: 3 },
  stats: { walkSpeed: 100, runSpeed: 170, groundAccel: 1000, groundDecel: 1150, airAccel: 700, jumpVelocity: 362, runJumpBonus: 56 },
  body: { width: 11, height: 26, crouchHeight: 16 },
  abilityCooldownMs: 900,
  color: 0xe0413a,
};
