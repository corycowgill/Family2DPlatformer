import type { CharacterDef, CharacterId } from '../types';
import { Dad } from './Dad';
import { Mom } from './Mom';
import { Brennan } from './Brennan';
import { Parker } from './Parker';
import { Lupin } from './Lupin';

export const CHARACTERS: Record<CharacterId, CharacterDef> = {
  dad: Dad,
  mom: Mom,
  brennan: Brennan,
  parker: Parker,
  lupin: Lupin,
};

export function getCharacter(id: CharacterId): CharacterDef {
  return CHARACTERS[id] ?? Dad;
}
