import type { CharacterDef } from '../types';

export const Dad: CharacterDef = {
  id: 'dad',
  name: 'Dad',
  ability: 'groundPound',
  abilityName: 'Ground Pound',
  abilityDescription: 'Slam down from the air to crush enemies and shake the street.',
  ratings: { speed: 3, jump: 3, ability: 4 },
  stats: { walkSpeed: 95, runSpeed: 160, groundAccel: 900, groundDecel: 1100, airAccel: 650, jumpVelocity: 390, runJumpBonus: 35 },
  body: { width: 12, height: 30, crouchHeight: 18 },
  abilityCooldownMs: 400,
  color: 0x2f6fd6,
};
