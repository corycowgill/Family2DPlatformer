import { test, expect } from '@playwright/test';
import { CHARACTERS, getState, harness, openGame, setInput, startLevel, trackConsole } from './helpers';

test.describe('boot', () => {
  test('game loads to the menu without console errors @smoke', async ({ page }) => {
    const log = trackConsole(page);
    await openGame(page);
    await expect(page.locator('canvas')).toBeVisible();
    await page.waitForFunction(() => window.__harness!.isActive('Menu'));
    // Let a few frames render.
    await page.waitForTimeout(500);
    expect(log.errors, [...log.errors, ...log.failedRequests].join('\n')).toEqual([]);
  });

  test('test level starts and runs without console errors @smoke', async ({ page }) => {
    const log = trackConsole(page);
    await openGame(page);
    const s = await startLevel(page, 'test', 'dad');
    expect(s.levelId).toBe('test');
    expect(s.mode).toBe('normal');
    expect(s.scenes).toContain('HUD');
    await page.waitForTimeout(1000);
    const after = await getState(page);
    // (not asserting `grounded`: it flickers on flat ground — known defect, see docs/QA.md)
    expect(after.mode).toBe('normal');
    expect(after.y).toBeCloseTo(240, 0);
    expect(log.errors, [...log.errors, ...log.failedRequests].join('\n')).toEqual([]);
  });
});

test.describe('debug overlay', () => {
  test('?debug: level-select hotkeys, overlay text, restart hotkey', async ({ page }) => {
    const log = trackConsole(page);
    await openGame(page, 'debug');
    await page.keyboard.press('Digit0');
    await page.waitForFunction(() => window.__harness!.getState().levelId === 'test');
    await page.waitForFunction(() => window.__harness!.sceneTexts('Level').some((t) => t.includes('bodies')));
    const texts = await harness(page, (h) => h.sceneTexts('Level'));
    expect(texts.some((t) => t.startsWith('fps'))).toBe(true); // LevelScene's own debug line
    expect(await harness(page, (h) => h.level()!.physics.world.drawDebug)).toBe(true);
    await harness(page, (h) => h.teleport(400, 200));
    await page.keyboard.press('KeyR');
    await page.waitForFunction(() => window.__harness!.getState().x < 100);
    expect(log.errors, log.errors.join('\n')).toEqual([]);
  });
});

test.describe('characters', () => {
  for (const id of CHARACTERS) {
    test(`${id} can start a level and move`, async ({ page }) => {
      const log = trackConsole(page);
      await openGame(page);
      const s0 = await startLevel(page, 'test', id, { manual: true });
      expect(s0.character).toBe(id);
      await harness(page, (h) => h.stepFrames(30));
      const landed = await getState(page);
      expect(landed.y).toBeCloseTo(240, 0); // standing on the ground row
      await setInput(page, { right: true });
      await harness(page, (h) => h.stepFrames(45));
      const moved = await getState(page);
      expect(moved.x).toBeGreaterThan(landed.x + 40);
      await setInput(page, { jump: true });
      await harness(page, (h) => h.stepFrames(10));
      const jumped = await getState(page);
      expect(jumped.y).toBeLessThan(moved.y - 10);
      expect(log.errors, [...log.errors, ...log.failedRequests].join('\n')).toEqual([]);
    });
  }
});
