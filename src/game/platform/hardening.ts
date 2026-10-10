import type Phaser from 'phaser';

/**
 * Mobile-browser hardening (mostly for iPhone Safari, harmless elsewhere):
 *  - pinch zoom: iOS ignores `user-scalable=no`, so cancel the proprietary gesture events;
 *  - double-tap zoom: `touch-action: none` (CSS) + cancel a second touchend within 300 ms
 *    and dblclick;
 *  - rubber-band / pull-to-refresh: cancel document touchmove (nothing on the page scrolls);
 *  - long-press callout, selection, context menu;
 *  - Safari's collapsing toolbars / rotation: re-measure the canvas (debounced, twice, as iOS
 *    reports the final viewport size late) and keep the page scrolled to the top.
 * Canvas taps are untouched: Phaser's own canvas listeners run before these document ones.
 */
export function installHardening(game: Phaser.Game): void {
  if (typeof document === 'undefined') return;
  const cancel = (e: Event) => {
    if (e.cancelable) e.preventDefault();
  };
  const nonPassive = { passive: false } as const;
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, cancel, nonPassive);
  document.addEventListener('dblclick', cancel, nonPassive);
  document.addEventListener('contextmenu', cancel);
  document.addEventListener('selectstart', cancel);
  document.addEventListener('touchmove', (e) => {
    // Pinch with two fingers or page drag: never let the page scroll/zoom.
    if (e.cancelable) e.preventDefault();
  }, nonPassive);
  let lastEnd = 0;
  document.addEventListener('touchend', (e) => {
    const t = e.timeStamp;
    const quick = t - lastEnd < 300;
    lastEnd = t;
    const el = e.target as Element | null;
    // Elements that rely on click (e.g. links in a future DOM page) opt out with data-allow-dbl.
    if (quick && e.cancelable && !el?.closest?.('[data-allow-dbl]')) e.preventDefault();
  }, nonPassive);

  let timers: number[] = [];
  const refresh = () => {
    if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
    game.scale.refresh();
  };
  const schedule = () => {
    timers.forEach((id) => clearTimeout(id));
    timers = [window.setTimeout(refresh, 80), window.setTimeout(refresh, 450)];
  };
  window.addEventListener('orientationchange', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  window.visualViewport?.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('pageshow', schedule, { passive: true });
}
