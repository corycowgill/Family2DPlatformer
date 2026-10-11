import { PLAYER_DEFAULTS } from '../config';
import type { CharacterId } from '../types';
import { saveSystem } from '../systems/SaveSystem';

/**
 * Session (non-persistent) state that survives scene transitions:
 * current character, lives, and the checkpoint reached in the current level.
 */
export class GameState {
  character: CharacterId = saveSystem.get().selectedCharacter;
  lives: number = PLAYER_DEFAULTS.startingLives;
  /** Checkpoint index reached in `checkpointLevel` (-1 = level start). */
  checkpoint = -1;
  checkpointLevel = '';
  /** Deaths per boss level this session (assist: boss skip is offered after 3). */
  bossDeaths: Record<string, number> = {};
  /** `${levelId}:${deaths}` for which the boss-skip prompt was last shown (show it once). */
  bossSkipOffered = '';

  selectCharacter(id: CharacterId): void {
    this.character = id;
    saveSystem.update((d) => {
      d.selectedCharacter = id;
    });
  }

  /** Called when starting a level fresh from the map/menu. */
  beginLevel(levelId: string): void {
    if (this.checkpointLevel !== levelId) {
      this.checkpoint = -1;
      this.checkpointLevel = levelId;
    }
  }

  resetCheckpoint(): void {
    this.checkpoint = -1;
    this.checkpointLevel = '';
  }

  resetLives(): void {
    this.lives = PLAYER_DEFAULTS.startingLives;
  }
}

export const gameState = new GameState();
