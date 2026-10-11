import type Phaser from 'phaser';
import type { CharacterId } from '../types';
import { IMAGES } from '../data/assets';
import { gameState } from '../state/GameState';
import { saveSystem } from '../systems/SaveSystem';
import { costumeTexture, selectedCostume } from '../systems/Rewards';

/**
 * Texture key of a hero in their selected costume (cosmetic only). Costume atlases are
 * `<id>-<costume>` (tools/art/costumes.py); a missing atlas falls back to the base one.
 */
export function heroTexture(scene: Phaser.Scene, id: CharacterId = gameState.character, costume?: string): string {
  const key = costumeTexture(id, costume ?? selectedCostume(saveSystem.get(), id));
  return scene.textures.exists(key) ? key : id;
}

/** 24x24 HUD portrait for the hero's costume (falls back to the base portrait). */
export function heroPortrait(scene: Phaser.Scene, id: CharacterId = gameState.character): string {
  const key = IMAGES.portrait(heroTexture(scene, id));
  return scene.textures.exists(key) ? key : IMAGES.portrait(id);
}
