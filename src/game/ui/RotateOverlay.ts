import type Phaser from 'phaser';

/**
 * "Rotate your device" overlay for touch phones held in portrait. Pure DOM/CSS so it
 * works regardless of canvas scaling; pauses a running level while visible.
 */
const QUERY = '(orientation: portrait) and (pointer: coarse)';

export function installRotateOverlay(game: Phaser.Game): void {
  if (typeof document === 'undefined' || document.getElementById('rotate-overlay')) return;
  const style = document.createElement('style');
  style.textContent = `
    #rotate-overlay { position: fixed; inset: 0; z-index: 50; display: none; flex-direction: column; gap: 18px;
      align-items: center; justify-content: center; background: #0b1730; color: #ffd25a;
      font: bold 18px/1.3 monospace; text-align: center; letter-spacing: 1px; padding: 24px; }
    #rotate-overlay small { color: #cfe3ff; font-weight: normal; font-size: 14px; }
    #rotate-overlay .phone { width: 46px; height: 78px; border: 4px solid #cfe3ff; border-radius: 8px; position: relative;
      animation: cfa-rot 2.2s ease-in-out infinite; }
    #rotate-overlay .phone::after { content: ''; position: absolute; left: 50%; bottom: 4px; width: 8px; height: 8px;
      margin-left: -4px; border-radius: 50%; background: #cfe3ff; }
    @keyframes cfa-rot { 0%, 25% { transform: rotate(0deg); } 55%, 100% { transform: rotate(-90deg); } }
    @media ${QUERY} { #rotate-overlay { display: flex; } }
    @media (prefers-reduced-motion: reduce) { #rotate-overlay .phone { animation: none; transform: rotate(-90deg); } }
  `;
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.id = 'rotate-overlay';
  el.setAttribute('role', 'alert');
  el.innerHTML = '<div class="phone"></div><div>ROTATE YOUR DEVICE</div><small>Chicago Family Adventure plays in landscape</small>';
  document.body.appendChild(el);

  const mq = window.matchMedia?.(QUERY);
  const onChange = () => {
    if (!mq?.matches) return;
    const lv = game.scene.getScene('Level') as (Phaser.Scene & { pauseGame?: () => void }) | null;
    if (lv && lv.sys.isActive() && typeof lv.pauseGame === 'function') lv.pauseGame();
  };
  mq?.addEventListener?.('change', onChange);
}
