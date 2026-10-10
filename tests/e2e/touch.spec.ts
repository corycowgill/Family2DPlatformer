import { test, expect, type Page } from '@playwright/test';
import { gameToPage, getState, harness, openGame, startLevel } from './helpers';

/**
 * Mobile project only (tagged @touch): Pixel 7 landscape with hasTouch. Touch buttons are
 * drawn in the HUD at fixed logical (480x270) positions — mirrors TOUCH_LAYOUT in
 * src/game/ui/TouchControls.ts and the HUD pause button (HUDScene).
 */
const BUTTONS = {
  left: { x: 28, y: 270 - 30 },
  right: { x: 78, y: 270 - 30 },
  jump: { x: 480 - 30, y: 270 - 34 },
  attack: { x: 480 - 76, y: 270 - 22 },
  pause: { x: 480 - 13, y: 13 },
};

/** Real touch events through CDP, multi-touch capable. Returns a release function. */
async function touchDown(page: Page, points: { x: number; y: number }[]): Promise<() => Promise<void>> {
  const cdp = await page.context().newCDPSession(page);
  const touchPoints = [];
  for (const [i, p] of points.entries()) {
    const pp = await gameToPage(page, p.x, p.y);
    touchPoints.push({ x: pp.x, y: pp.y, id: i, radiusX: 4, radiusY: 4, force: 1 });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints });
  return async () => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  };
}

async function touchHold(page: Page, points: { x: number; y: number }[], ms: number): Promise<void> {
  const release = await touchDown(page, points);
  await page.waitForTimeout(ms);
  await release();
}

test.describe('touch controls @touch', () => {
  test('touch buttons appear on a touch device', async ({ page }) => {
    await openGame(page);
    await startLevel(page, 'test', 'dad');
    expect(await page.evaluate(() => 'ontouchstart' in window || navigator.maxTouchPoints > 0)).toBe(true);
    expect(await harness(page, (h) => h.touchControlsVisible())).toBe(true);
  });

  test('holding the ▶ button moves the player right, ◀ moves left', async ({ page }) => {
    await openGame(page);
    await startLevel(page, 'test', 'dad');
    await page.waitForTimeout(400);
    const s0 = await getState(page);
    let release = await touchDown(page, [BUTTONS.right]);
    await page.waitForFunction((x) => window.__harness!.getState().x > x + 30, s0.x, { timeout: 15_000 });
    await release();
    await page.waitForTimeout(300);
    const s2 = await getState(page);
    release = await touchDown(page, [BUTTONS.left]);
    await page.waitForFunction((x) => window.__harness!.getState().x < x - 20, s2.x, { timeout: 15_000 });
    await release();
    // Releasing stops the player (no stuck virtual button).
    await page.waitForTimeout(400);
    const a = await getState(page);
    await page.waitForTimeout(300);
    expect(Math.abs((await getState(page)).x - a.x)).toBeLessThan(2);
  });

  test('jump button jumps while ▶ is held (multi-touch)', async ({ page }) => {
    await openGame(page);
    await startLevel(page, 'test', 'dad');
    await page.waitForTimeout(400);
    const s0 = await getState(page);
    // Hold both until the player has risen 20 px (wall-clock independent).
    const release = await touchDown(page, [BUTTONS.right, BUTTONS.jump]);
    await page.waitForFunction((y) => window.__harness!.getState().y < y - 20, s0.y, { timeout: 15_000 });
    await release();
    expect((await getState(page)).x).toBeGreaterThan(s0.x + 10);
  });

  test('pause button opens the pause menu', async ({ page }) => {
    await openGame(page);
    await startLevel(page, 'test', 'dad');
    await page.waitForTimeout(300);
    await touchHold(page, [BUTTONS.pause], 150);
    await page.waitForFunction(() => window.__harness!.isActive('Pause'));
  });
});
