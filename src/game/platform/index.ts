import type Phaser from 'phaser';
import { installHardening } from './hardening';
import { installAudioLifecycle } from './audioLifecycle';
import { installHomeScreenTip } from './homeScreenTip';
import { installTouchOverlay } from '../ui/TouchControls';

/**
 * Mobile / iOS platform layer, installed once from main.ts:
 * browser hardening (zoom/scroll/callout), viewport refresh, audio unlock + app lifecycle
 * (background ⇒ pause), the DOM touch-control overlay (shown by the HUD), and the iOS
 * "Add to Home Screen" tip on the title screen.
 */
export function installPlatform(game: Phaser.Game): void {
  installHardening(game);
  installAudioLifecycle(game);
  installTouchOverlay(game);
  installHomeScreenTip(game);
}

export { isIOS, isAndroid, isStandalone } from './device';
