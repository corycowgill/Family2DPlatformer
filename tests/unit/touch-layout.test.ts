import { describe, expect, it } from 'vitest';
import {
  actionAt, actionSlide, btnRect, computeTouchLayout, dpadDirs, radiusRatio, rectsOverlap, type TouchLayout,
} from '../../src/game/platform/touchLayout';
import { isIOS, isStandalone, isAndroid } from '../../src/game/platform/device';
import { shouldOfferHomeScreenTip } from '../../src/game/platform/homeScreenTip';
import { pixelButtonSvg, textRects } from '../../src/game/platform/pixelSvg';

const IPHONE14 = { w: 844, h: 390, safe: { top: 0, right: 47, bottom: 21, left: 47 } };
const IPHONE_PRO_MAX = { w: 932, h: 430, safe: { top: 0, right: 59, bottom: 21, left: 59 } };
const IPAD = { w: 1024, h: 768, safe: { top: 24, right: 0, bottom: 20, left: 0 } };
const PIXEL = { w: 863, h: 360, safe: { top: 0, right: 0, bottom: 0, left: 0 } };

/** Canvas rect for a 16:9 FIT-scaled game. */
function canvasRect(v: { w: number; h: number }) {
  const scale = Math.min(v.w / 480, v.h / 270);
  const w = 480 * scale;
  const h = 270 * scale;
  return { x: (v.w - w) / 2, y: (v.h - h) / 2, w, h };
}

describe('touch layout', () => {
  for (const [name, v] of Object.entries({ IPHONE14, IPHONE_PRO_MAX, IPAD, PIXEL })) {
    it(`${name}: thumb-sized, on screen, inside the safe area, clear of the play centre`, () => {
      const L = computeTouchLayout(v);
      expect(L.s).toBeGreaterThanOrEqual(56);
      for (const [id, b] of Object.entries(L.buttons)) {
        const r = btnRect(b);
        expect(r.x, id).toBeGreaterThanOrEqual(0);
        expect(r.y, id).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w, id).toBeLessThanOrEqual(v.w);
        expect(r.y + r.h, id).toBeLessThanOrEqual(v.h - v.safe.bottom);
        expect(b.size, id).toBeGreaterThanOrEqual(44);
      }
      // The middle 50% x 60% of the canvas stays free.
      const c = canvasRect(v);
      const centre = { x: c.x + c.w * 0.25, y: c.y + c.h * 0.2, w: c.w * 0.5, h: c.h * 0.6 };
      expect(rectsOverlap(L.leftZone, centre)).toBe(false);
      expect(rectsOverlap(L.rightZone, centre)).toBe(false);
      for (const [id, b] of Object.entries(L.buttons)) expect(rectsOverlap(btnRect(b), centre), id).toBe(false);
      // Buttons within a cluster don't overlap each other.
      const ids = ['left', 'right', 'down', 'jump', 'attack', 'run'] as const;
      for (const a of ids) for (const b of ids) {
        if (a >= b) continue;
        const A = L.buttons[a];
        const B = L.buttons[b];
        expect(Math.hypot(A.cx - B.cx, A.cy - B.cy), `${a}/${b}`).toBeGreaterThanOrEqual((A.size + B.size) / 2 - 1);
      }
    });
  }

  it('wide phones keep most of each cluster in the letterbox bars', () => {
    const L = computeTouchLayout(IPHONE14);
    const c = canvasRect(IPHONE14);
    // Clusters overlap the canvas by less than a fifth of its width on either side.
    expect(L.buttons.right.cx + L.buttons.right.size / 2 - c.x).toBeLessThan(c.w * 0.18);
    expect(c.x + c.w - (L.buttons.attack.cx - L.buttons.attack.size / 2)).toBeLessThan(c.w * 0.15);
    // Pause sits (mostly) in the right bar.
    expect(L.buttons.pause.cx).toBeGreaterThan(c.x + c.w);
  });
});

describe('d-pad hit test (slide between directions)', () => {
  const L: TouchLayout = computeTouchLayout(IPHONE14);
  const { left, right, down } = L.buttons;
  it('button centres map to their direction', () => {
    expect(dpadDirs(L, left.cx, left.cy)).toEqual(['left']);
    expect(dpadDirs(L, right.cx, right.cy)).toEqual(['right']);
    expect(dpadDirs(L, down.cx, down.cy)).toEqual(['down']);
  });
  it('far outside still resolves (thumb slid off), up folds onto left/right', () => {
    expect(dpadDirs(L, 2, left.cy)).toEqual(['left']);
    expect(dpadDirs(L, right.cx + 80, right.cy - 60)).toEqual(['right']);
    expect(dpadDirs(L, left.cx, left.cy - 70)).toEqual(['left']);
  });
  it('diagonals below the row press down + direction (Lupin crawl)', () => {
    expect(dpadDirs(L, down.cx - down.size * 0.6, down.cy - 4).sort()).toEqual(['down', 'left']);
    expect(dpadDirs(L, down.cx + down.size * 0.6, down.cy - 4).sort()).toEqual(['down', 'right']);
  });
  it('dead zone keeps the previous direction', () => {
    expect(dpadDirs(L, L.dpad.cx + 1, L.dpad.cy, ['left'])).toEqual(['left']);
    expect(dpadDirs(L, L.dpad.cx - 1, L.dpad.cy)).toEqual(['left']);
  });
});

describe('action buttons', () => {
  const L = computeTouchLayout(IPHONE14);
  const { jump, attack, run } = L.buttons;
  it('new touches pick the nearest button with fat-finger tolerance', () => {
    expect(actionAt(L, jump.cx, jump.cy)).toBe('jump');
    expect(actionAt(L, attack.cx, attack.cy)).toBe('attack');
    expect(actionAt(L, run.cx, run.cy)).toBe('run');
    expect(actionAt(L, jump.cx + jump.size * 0.6, jump.cy)).toBe('jump');
    expect(actionAt(L, jump.cx - 300, jump.cy - 200)).toBeNull();
  });
  it('slides between JUMP and ABILITY, releases when slid far away, RUN never slides', () => {
    expect(actionSlide(L, attack.cx, attack.cy, 'jump')).toBe('attack');
    expect(actionSlide(L, jump.cx, jump.cy, 'attack')).toBe('jump');
    // Wobble just outside the rim keeps the current button.
    expect(actionSlide(L, jump.cx, jump.cy - jump.size * 0.7, 'jump')).toBe('jump');
    expect(actionSlide(L, jump.cx - 300, jump.cy - 200, 'jump')).toBeNull();
    expect(actionSlide(L, jump.cx, jump.cy, 'run')).toBe('run');
    expect(radiusRatio(jump, jump.cx + jump.size / 2, jump.cy)).toBeCloseTo(1);
  });
});

describe('platform detection', () => {
  const base = { platform: 'iPhone', maxTouchPoints: 5 };
  it('iOS incl. iPadOS desktop UA', () => {
    expect(isIOS({ ...base, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' })).toBe(true);
    expect(isIOS({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true);
    expect(isIOS({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false);
    expect(isIOS({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7)', platform: 'Linux', maxTouchPoints: 5 })).toBe(false);
    expect(isAndroid({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7)', platform: 'Linux', maxTouchPoints: 5 })).toBe(true);
  });
  it('standalone + home-screen tip rule', () => {
    expect(isStandalone({ ...base, userAgent: '', standalone: true })).toBe(true);
    expect(isStandalone({ ...base, userAgent: '', displayModeApp: true })).toBe(true);
    expect(isStandalone({ ...base, userAgent: '' })).toBe(false);
    expect(shouldOfferHomeScreenTip({ ios: true, standalone: false, dismissed: false })).toBe(true);
    expect(shouldOfferHomeScreenTip({ ios: true, standalone: true, dismissed: false })).toBe(false);
    expect(shouldOfferHomeScreenTip({ ios: true, standalone: false, dismissed: true })).toBe(false);
    expect(shouldOfferHomeScreenTip({ ios: false, standalone: false, dismissed: false })).toBe(false);
  });
});

describe('pixel svg', () => {
  it('renders glyph runs and a button', () => {
    const t = textRects('RUN');
    expect(t.w).toBe(17);
    expect(t.h).toBe(7);
    expect(t.rects.length).toBeGreaterThan(10);
    const svg = pixelButtonSvg(20, '▶', 2);
    expect(svg).toContain('class="ring"');
    expect(svg).toContain('class="glyph"');
  });
});
