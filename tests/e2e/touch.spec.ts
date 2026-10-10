import { test, expect, type Page, type CDPSession } from '@playwright/test';
import { gameToPage, getState, harness, openGame, startLevel, waitForScene } from './helpers';

/**
 * Touch controls (@touch): run by the `mobile` (Pixel 7 landscape) and `iphone` (iPhone 14
 * landscape, Chromium emulation with an iOS UA) projects. The on-screen controls are a DOM
 * overlay (src/game/ui/TouchControls.ts); buttons are located by their `data-btn` element.
 * Touches go through CDP Input.dispatchTouchEvent — real, multi-touch browser touch events.
 */

type Pt = { x: number; y: number };
type Btn = 'left' | 'right' | 'down' | 'jump' | 'attack' | 'run' | 'pause';

/** Multi-touch driver: touchStart/touchMove send every active point; touchEnd the released one. */
class Fingers {
  private pts = new Map<number, Pt>();
  private constructor(private cdp: CDPSession) {}
  static async on(page: Page): Promise<Fingers> {
    return new Fingers(await page.context().newCDPSession(page));
  }
  private list() {
    return [...this.pts].map(([id, p]) => ({ x: p.x, y: p.y, id, radiusX: 6, radiusY: 6, force: 1 }));
  }
  async down(id: number, p: Pt) {
    this.pts.set(id, p);
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: this.list() });
  }
  async move(id: number, p: Pt) {
    this.pts.set(id, p);
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: this.list() });
  }
  async up(id: number) {
    // CDP touchEnd lists the points being RELEASED; the others stay down.
    const p = this.list().filter((t) => t.id === id);
    this.pts.delete(id);
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: p });
  }
  async cancel() {
    this.pts.clear();
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  }
  async tap(p: Pt, ms = 80) {
    await this.down(99, p);
    await new Promise((r) => setTimeout(r, ms));
    await this.up(99);
  }
}

async function btn(page: Page, id: Btn): Promise<Pt & { w: number; h: number }> {
  const box = await page.locator(`#touch-controls [data-btn="${id}"]`).boundingBox();
  expect(box, id).not.toBeNull();
  return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2, w: box!.width, h: box!.height };
}

const controlsVisible = (page: Page) => harness(page, (h) => h.touchControlsVisible());
const pressed = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll('#touch-controls .tc-btn.pressed')].map((e) => (e as HTMLElement).dataset.btn).sort());

async function play(page: Page, character = 'dad') {
  await openGame(page);
  await startLevel(page, 'test', character);
  await expect.poll(() => controlsVisible(page)).toBe(true);
  await page.waitForTimeout(300);
}

test.describe('touch controls @touch', () => {
  test('overlay shows in gameplay only, sits at the screen edges and leaves the middle free', async ({ page }) => {
    await openGame(page);
    expect(await controlsVisible(page)).toBe(false); // title screen
    await startLevel(page, 'test', 'dad');
    await expect.poll(() => controlsVisible(page)).toBe(true);
    // No leftover in-canvas Phaser touch buttons; the HUD's canvas pause hides (DOM one replaces it).
    const canvas = (await page.locator('canvas').boundingBox())!;
    const vw = page.viewportSize()!.width;
    const bars = canvas.x > 40;
    for (const id of ['left', 'right', 'down', 'jump', 'attack', 'run', 'pause'] as Btn[]) {
      const b = await btn(page, id);
      expect(Math.min(b.w, b.h), `${id} size`).toBeGreaterThanOrEqual(id === 'run' || id === 'pause' ? 44 : 52);
      // Central gameplay area (middle 50% x 60% of the canvas) is never covered.
      const cx0 = canvas.x + canvas.width * 0.25;
      const cx1 = canvas.x + canvas.width * 0.75;
      const cy0 = canvas.y + canvas.height * 0.2;
      const cy1 = canvas.y + canvas.height * 0.8;
      const overlaps = b.x + b.w / 2 > cx0 && b.x - b.w / 2 < cx1 && b.y + b.h / 2 > cy0 && b.y - b.h / 2 < cy1;
      expect(overlaps, `${id} overlaps the centre`).toBe(false);
    }
    if (bars) {
      // Wide phone: each cluster starts in its letterbox bar.
      expect((await btn(page, 'left')).x).toBeLessThan(canvas.x + 10);
      expect((await btn(page, 'jump')).x).toBeGreaterThan(canvas.x + canvas.width - 10);
      expect((await btn(page, 'pause')).x).toBeGreaterThan(canvas.x + canvas.width - 5);
      expect((await btn(page, 'jump')).x).toBeLessThan(vw);
    }
  });

  test('holding ▶ moves right; sliding to ◀ without lifting turns around; release stops', async ({ page }) => {
    await play(page);
    const f = await Fingers.on(page);
    const s0 = await getState(page);
    await f.down(1, await btn(page, 'right'));
    await page.waitForFunction((x) => window.__harness!.getState().x > x + 30, s0.x, { timeout: 15_000 });
    expect(await pressed(page)).toEqual(['right']);
    // Slide the same finger to ◀ (no touchend in between).
    await f.move(1, await btn(page, 'left'));
    await page.waitForFunction(() => window.__harness!.getState().vx < -20, undefined, { timeout: 15_000 });
    expect(await pressed(page)).toEqual(['left']);
    // ...and down to ▼ (crouch): no horizontal input any more.
    await f.move(1, await btn(page, 'down'));
    expect(await pressed(page)).toEqual(['down']);
    await f.up(1);
    expect(await pressed(page)).toEqual([]);
    await page.waitForTimeout(500);
    const a = await getState(page);
    await page.waitForTimeout(300);
    expect(Math.abs((await getState(page)).x - a.x)).toBeLessThan(2);
  });

  test('▶ + JUMP + ABILITY at the same time (three fingers)', async ({ page }) => {
    await play(page);
    const f = await Fingers.on(page);
    const s0 = await getState(page);
    await f.down(1, await btn(page, 'right'));
    await f.down(2, await btn(page, 'jump'));
    await page.waitForFunction((y) => window.__harness!.getState().y < y - 20, s0.y, { timeout: 15_000 });
    await f.down(3, await btn(page, 'attack'));
    expect(await pressed(page)).toEqual(['attack', 'jump', 'right']);
    // Lift only the jump finger: the others stay held.
    await f.up(2);
    expect(await pressed(page)).toEqual(['attack', 'right']);
    await f.up(3);
    await f.up(1);
    expect(await pressed(page)).toEqual([]);
    expect((await getState(page)).x).toBeGreaterThan(s0.x + 10);
  });

  test('touchcancel (iOS system gesture) releases every button', async ({ page }) => {
    await play(page);
    const f = await Fingers.on(page);
    await f.down(1, await btn(page, 'right'));
    await f.down(2, await btn(page, 'jump'));
    await expect.poll(() => pressed(page)).toEqual(['jump', 'right']);
    await f.cancel();
    expect(await pressed(page)).toEqual([]);
    await page.waitForTimeout(700);
    const a = await getState(page);
    await page.waitForTimeout(300);
    expect(Math.abs((await getState(page)).x - a.x)).toBeLessThan(2);
  });

  test('RUN is a latching toggle and makes the player faster', async ({ page }) => {
    await play(page);
    const f = await Fingers.on(page);
    const isOn = () => page.locator('#touch-controls [data-btn="run"]').evaluate((e) => e.classList.contains('on'));
    expect(await isOn()).toBe(false);
    const start = await getState(page);
    const speed = async () => {
      await harness(page, (h, p) => h.teleport(p.x, p.y), { x: start.x, y: start.y });
      await page.waitForTimeout(300);
      await f.down(1, await btn(page, 'right'));
      await page.waitForTimeout(1200);
      const v = Math.abs((await getState(page)).vx);
      await f.up(1);
      await page.waitForTimeout(600);
      return v;
    };
    const walk = await speed();
    await f.tap(await btn(page, 'run'));
    expect(await isOn()).toBe(true); // stays on after lifting
    expect(await page.evaluate(() => localStorage.getItem('cfa-touch-run'))).toBe('1');
    const run = await speed();
    expect(run).toBeGreaterThan(walk + 10);
    await f.tap(await btn(page, 'run'));
    expect(await isOn()).toBe(false);
  });

  test('pause button pauses; controls hide on the pause menu; tapping RESUME in the canvas resumes', async ({ page }) => {
    await play(page);
    const f = await Fingers.on(page);
    await f.tap(await btn(page, 'pause'), 120);
    await waitForScene(page, 'Pause');
    await expect.poll(() => controlsVisible(page)).toBe(false);
    // Canvas taps (Phaser input) still work under the mobile hardening: RESUME is the first item.
    await page.waitForTimeout(300);
    await f.tap(await gameToPage(page, 240, 106), 120);
    await page.waitForFunction(() => !window.__harness!.isActive('Pause'), undefined, { timeout: 10_000 });
    await expect.poll(() => controlsVisible(page)).toBe(true);
  });

  test('app backgrounded (visibilitychange hidden) opens the pause menu', async ({ page }) => {
    await play(page);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitForScene(page, 'Pause');
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(300);
    // Still paused after returning: the player resumes from the menu.
    expect(await harness(page, (h) => h.isActive('Pause'))).toBe(true);
    expect(await controlsVisible(page)).toBe(false);
  });

  test('portrait: rotate overlay pauses and the controls hide', async ({ page }) => {
    await play(page);
    const vp = page.viewportSize()!;
    await page.setViewportSize({ width: vp.height, height: vp.width });
    await expect(page.locator('#rotate-overlay')).toBeVisible();
    await waitForScene(page, 'Pause');
    await expect.poll(() => controlsVisible(page)).toBe(false);
    await page.setViewportSize(vp);
    await expect(page.locator('#rotate-overlay')).toBeHidden();
  });

  test('keyboard use hides the overlay (auto), touching brings it back', async ({ page }) => {
    await play(page);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => controlsVisible(page)).toBe(false);
    // Touch anywhere on the screen switches back to touch controls.
    const f = await Fingers.on(page);
    await f.tap(await gameToPage(page, 240, 60));
    await expect.poll(() => controlsVisible(page)).toBe(true);
  });

  test('web app manifest and icons are served', async ({ page, request }) => {
    await openGame(page);
    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
    const iconHref = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
    expect(manifestHref).toMatch(/^\.\//); // relative: works from a subpath (GitHub Pages)
    const base = page.url();
    const m = await request.get(new URL(manifestHref!, base).href);
    expect(m.status()).toBe(200);
    const manifest = await m.json();
    expect(manifest.short_name).toBe('Chicago Family');
    expect(manifest.orientation).toBe('landscape');
    for (const icon of manifest.icons as { src: string }[]) {
      expect((await request.get(new URL(icon.src, new URL(manifestHref!, base)).href)).status(), icon.src).toBe(200);
    }
    expect((await request.get(new URL(iconHref!, base).href)).status()).toBe(200);
    expect(await page.locator('meta[name="apple-mobile-web-app-capable"]').getAttribute('content')).toBe('yes');
  });
});

test.describe('iPhone @touch @iphone', () => {
  /** Notch / home-indicator insets of an iPhone 14 in landscape (CSS env() can't be emulated). */
  const SAFE = { left: 47, right: 47, bottom: 21, top: 0 };
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((s) => {
      // Before the app's module script runs (readyState 'interactive' precedes deferred scripts).
      document.addEventListener('readystatechange', () => {
        const r = document.documentElement.style;
        for (const [k, v] of Object.entries(s)) r.setProperty(`--cfa-safe-${k}`, `${v}px`);
      }, { once: true });
    }, SAFE);
  });

  test('title screen shows the Add-to-Home-Screen tip once; dismissal persists', async ({ page }, testInfo) => {
    await openGame(page);
    await waitForScene(page, 'Menu');
    const tip = page.locator('#a2hs-tip');
    await expect(tip).toBeVisible();
    await page.waitForTimeout(600);
    await page.screenshot({ path: testInfo.outputPath('iphone-title-tip.png') });
    const close = (await tip.locator('button').boundingBox())!;
    const f = await Fingers.on(page);
    await f.tap({ x: close.x + close.width / 2, y: close.y + close.height / 2 });
    await expect(tip).toBeHidden();
    expect(await harness(page, (h) => h.isActive('Menu'))).toBe(true); // the tap didn't hit the menu
    await page.reload();
    await page.waitForFunction(() => !!window.__harness);
    await page.evaluate(() => window.__harness!.ready());
    await waitForScene(page, 'Menu');
    await page.waitForTimeout(300);
    expect(await page.locator('#a2hs-tip.show').count()).toBe(0);
  });

  test('controls respect the safe area and stay in the bars (screenshot)', async ({ page }, testInfo) => {
    await play(page, 'lupin');
    const vp = page.viewportSize()!;
    const left = await btn(page, 'left');
    const jump = await btn(page, 'jump');
    const down = await btn(page, 'down');
    expect(left.x - left.w / 2).toBeGreaterThanOrEqual(SAFE.left * 0.75 - 1);
    expect(vp.width - (jump.x + jump.w / 2)).toBeGreaterThanOrEqual(SAFE.right * 0.75 - 1);
    expect(vp.height - (down.y + down.h / 2)).toBeGreaterThanOrEqual(SAFE.bottom);
    await page.screenshot({ path: testInfo.outputPath('iphone-gameplay.png') });
    // Pressed-state screenshot: ▶ + JUMP held.
    const f = await Fingers.on(page);
    await f.down(1, await btn(page, 'right'));
    await f.down(2, jump);
    await page.waitForTimeout(250);
    await page.screenshot({ path: testInfo.outputPath('iphone-gameplay-pressed.png') });
    await f.cancel();
  });

  test('Lupin crawls: ↘ diagonal on the d-pad presses ▼ and ▶ together', async ({ page }) => {
    await play(page, 'lupin');
    const f = await Fingers.on(page);
    const down = await btn(page, 'down');
    await f.down(1, { x: down.x + down.w * 0.62, y: down.y - 4 });
    expect(await pressed(page)).toEqual(['down', 'right']);
    await f.up(1);
  });
});
