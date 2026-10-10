import type { CharacterDef } from '../types';

export const Lupin: CharacterDef = {
  id: 'lupin',
  name: 'Lupin',
  ability: 'sniff',
  abilityName: 'Super Sniff',
  abilityDescription: 'Crawl through tiny gaps and sniff out hidden secrets.',
  ratings: { speed: 4, jump: 3, ability: 3 },
  stats: { walkSpeed: 105, runSpeed: 165, groundAccel: 1000, groundDecel: 1150, airAccel: 720, jumpVelocity: 380, runJumpBonus: 35 },
  body: { width: 18, height: 14, crouchHeight: 10 },
  abilityCooldownMs: 1500,
  color: 0xe8c547,
};
