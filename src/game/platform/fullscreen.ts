import { isAndroid, isAutomated, isIOS, isStandalone } from './device';

let attempted = false;

/**
 * Android Chrome (and other touch browsers with the Fullscreen API): enter fullscreen and lock
 * landscape on the first gameplay tap. Must run inside a user-activation handler (touchend).
 * iPhone Safari has no element fullscreen — there the home-screen web app is the way (see
 * homeScreenTip). Tried once per page load so backing out of fullscreen isn't fought.
 * Skipped under automation (Playwright) to keep viewport sizes deterministic.
 */
export function maybeEnterFullscreen(): void {
  if (attempted) return;
  attempted = true;
  if (typeof document === 'undefined' || isIOS() || isStandalone() || isAutomated()) return;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  if (!isAndroid() && !coarse) return;
  const el = document.documentElement;
  if (!document.fullscreenEnabled || document.fullscreenElement || typeof el.requestFullscreen !== 'function') return;
  try {
    el.requestFullscreen({ navigationUI: 'hide' })
      .then(() => {
        const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
        return o?.lock?.('landscape');
      })
      .catch(() => {
        /* denied / unsupported: keep playing in the browser */
      });
  } catch {
    /* old browsers throw synchronously */
  }
}
