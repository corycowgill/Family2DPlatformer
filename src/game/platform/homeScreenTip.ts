import type Phaser from 'phaser';
import { isIOS, isStandalone } from './device';
import { pixelTextSvg } from './pixelSvg';

export const TIP_DISMISSED_KEY = 'cfa-a2hs-tip-dismissed';

/** Pure: should the "Add to Home Screen" tip be offered? */
export function shouldOfferHomeScreenTip(opts: { ios: boolean; standalone: boolean; dismissed: boolean }): boolean {
  return opts.ios && !opts.standalone && !opts.dismissed;
}

function dismissed(): boolean {
  try {
    return localStorage.getItem(TIP_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

const CSS = `
#a2hs-tip { position: fixed; z-index: 30; left: 0; right: 0; margin: 0 auto; width: max-content; box-sizing: border-box;
  bottom: max(6px, env(safe-area-inset-bottom, 0px)); display: none; align-items: center; gap: 10px;
  padding: 6px 4px 6px 12px; background: rgba(19, 37, 74, 0.94); color: #ffffff;
  border: 2px solid #5b7bb5; box-shadow: 0 0 0 2px #0b1730; image-rendering: pixelated;
  -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; touch-action: none; max-width: calc(100vw - 24px); }
#a2hs-tip.show { display: flex; }
#a2hs-tip .lines { display: flex; flex-direction: column; gap: 5px; }
#a2hs-tip .row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; }
#a2hs-tip .gold { color: #ffd25a; }
#a2hs-tip .sub { color: #cfe3ff; }
#a2hs-tip .share { width: 14px; height: 18px; display: block; color: #cfe3ff; }
#a2hs-tip button { all: unset; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;
  cursor: pointer; color: #cfe3ff; -webkit-tap-highlight-color: transparent; }
#a2hs-tip button:active { color: #ffd25a; }
`;

/** iOS share glyph (box with an up arrow) as pixel SVG, 7x9 cells. */
const SHARE_SVG =
  '<svg class="share" viewBox="0 0 7 9" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="' +
  'M3 0h1v6h-1zM2 1h3v1h-3zM1 2h1v1h-1zM5 2h1v1h-1zM0 4h2v1h-1v3h5v-3h-1v-1h2v5h-7z"/></svg>';

/**
 * iPhone/iPad Safari (not already a home-screen app): a one-time dismissible tip on the title
 * screen — "Share → Add to Home Screen" is the only true fullscreen on iPhone. Shown while the
 * Menu scene runs; dismissal is remembered in localStorage.
 */
export function installHomeScreenTip(game: Phaser.Game): void {
  if (typeof document === 'undefined') return;
  if (!shouldOfferHomeScreenTip({ ios: isIOS(), standalone: isStandalone(), dismissed: dismissed() })) return;

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.id = 'a2hs-tip';
  el.setAttribute('role', 'note');
  el.setAttribute('aria-label', 'Tip: tap Share, then Add to Home Screen, to play fullscreen');
  el.innerHTML =
    `<div class="lines"><div class="row">${pixelTextSvg('TIP:', 2, 'gold')}${pixelTextSvg('TAP', 2)}${SHARE_SVG}${pixelTextSvg('SHARE, THEN', 2)}` +
    `${pixelTextSvg('"ADD TO HOME SCREEN"', 2, 'gold')}</div>` +
    `<div class="row">${pixelTextSvg('TO PLAY FULLSCREEN!', 2, 'sub')}</div></div>` +
    `<button type="button" aria-label="Dismiss tip">${pixelTextSvg('×', 3)}</button>`;
  document.body.appendChild(el);

  // Keep taps on the tip away from Phaser's window-level listeners (they'd hit the menu below).
  const stop = (e: Event) => {
    e.stopPropagation();
    if (e.cancelable) e.preventDefault();
  };
  for (const t of ['touchstart', 'touchend', 'mousedown', 'mouseup']) el.addEventListener(t, stop, { passive: false });
  const close = el.querySelector('button')!;
  let gone = false;
  const dismiss = () => {
    gone = true;
    el.classList.remove('show');
    try {
      localStorage.setItem(TIP_DISMISSED_KEY, '1');
    } catch {
      /* ignore */
    }
  };
  close.addEventListener('pointerup', (e) => {
    e.stopPropagation();
    dismiss();
  });
  close.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && dismiss());

  const show = (on: boolean) => el.classList.toggle('show', on && !gone);
  const hook = () => {
    const menu = game.scene.getScene('Menu');
    if (!menu) {
      // Scenes are instantiated when the game fires 'ready' (after the scene manager's own listener).
      game.events.once('ready', hook);
      return;
    }
    const ev = menu.events;
    // Scene event names (Phaser.Scenes.Events) as literals: keeps this module Phaser-free for unit tests.
    ev.on('create', () => show(true));
    for (const e of ['shutdown', 'sleep', 'pause']) ev.on(e, () => show(false));
    ev.on('resume', () => show(true));
    ev.on('wake', () => show(true));
    if (menu.sys.isActive()) show(true);
  };
  hook();
}
