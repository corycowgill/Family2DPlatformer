import type { CharacterDef } from '../types';

export const Mom: CharacterDef = {
  id: 'mom',
  name: 'Mom',
  ability: 'airJump',
  abilityName: 'Sparkle Jump',
  abilityDescription: 'Jump again in mid-air with a burst of sparkles.',
  ratings: { speed: 3, jump: 5, ability: 3 },
  stats: { walkSpeed: 95, runSpeed: 155, groundAccel: 900, groundDecel: 1100, airAccel: 700, jumpVelocity: 385, runJumpBonus: 30 },
  body: { width: 12, height: 30, crouchHeight: 18 },
  abilityCooldownMs: 0,
  color: 0xc23fd0,
};
