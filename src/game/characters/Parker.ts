import type { CharacterDef } from '../types';

export const Parker: CharacterDef = {
  id: 'parker',
  name: 'Parker',
  ability: 'projectile',
  abilityName: 'Energy Blast',
  abilityDescription: 'Fire a short-range energy blast at enemies.',
  ratings: { speed: 3, jump: 3, ability: 4 },
  stats: { walkSpeed: 95, runSpeed: 160, groundAccel: 950, groundDecel: 1100, airAccel: 700, jumpVelocity: 385, runJumpBonus: 35 },
  body: { width: 11, height: 24, crouchHeight: 15 },
  abilityCooldownMs: 450,
  color: 0x3aa04a,
};
