import type Phaser from 'phaser';
import { audio } from '../systems/AudioSystem';
import { REQUEST_PAUSE } from '../systems/InputDevice';

/**
 * Audio + app lifecycle for phones:
 *  - iOS 17+: `navigator.audioSession.type = 'playback'` so game sound plays even with the
 *    ring/silent switch on (a game is media, like a video).
 *  - Unlock: Phaser unlocks WebAudio on its first gesture; iOS can also re-suspend the context
 *    later ("interrupted" after a call / Siri / app switch), so every touchend / pointerup /
 *    keydown resumes it if needed, and the very first one plays a 1-sample silent buffer
 *    (older iOS only un-mutes after a sound starts inside a gesture).
 *  - Background (visibilitychange hidden / pagehide): pause the running level (REQUEST_PAUSE)
 *    and suspend the context; on return resume the context — gameplay stays on the pause menu.
 */
export function installAudioLifecycle(game: Phaser.Game): void {
  if (typeof document === 'undefined') return;
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (session) {
    try {
      session.type = 'playback';
    } catch {
      /* unsupported value */
    }
  }

  let primed = false;
  const onGesture = () => {
    if (document.visibilityState === 'hidden') return;
    const ctx = audio.context;
    if (!ctx) return;
    if (!primed) {
      primed = true;
      try {
        const src = ctx.createBufferSource();
        src.buffer = ctx.createBuffer(1, 1, 22050);
        src.connect(ctx.destination);
        src.start(0);
      } catch {
        /* ignore */
      }
    }
    audio.resume();
  };
  for (const t of ['touchend', 'pointerup', 'keydown', 'click']) {
    window.addEventListener(t, onGesture, { capture: true, passive: true });
  }

  const onHidden = () => {
    game.events.emit(REQUEST_PAUSE);
    audio.suspend();
  };
  const onVisible = () => audio.resume();
  document.addEventListener('visibilitychange', () => (document.visibilityState === 'hidden' ? onHidden() : onVisible()));
  window.addEventListener('pagehide', onHidden);
  window.addEventListener('pageshow', (e) => {
    if ((e as PageTransitionEvent).persisted) onVisible();
  });
}
