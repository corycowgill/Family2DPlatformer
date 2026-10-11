import { test, expect, type Page } from '@playwright/test';
import { getState, harness, openGame, setInput, startLevel, stepFrames, trackConsole, waitForScene } from './helpers';

/**
 * Assist mode & accessibility options (SettingsScene → SaveSystem → LevelScene/Player).
 * The test level has 3-tile pits at tile columns 31-33 and 61-63 (ground top at y = 240).
 */

type SettingsLike = Record<string, unknown>;
const settings = (page: Page) => harness(page, (h) => (h.getSave() as { settings: SettingsLike }).settings);
const GOLD = 0xffd25a;

/** Is the menu row labelled `label` currently selected (gold) in scene `key`? */
const rowSelected = (page: Page, key: string, label: string) =>
  harness(
    page,
    (h, a) => {
      const s = h.game.scene.getScene(a.key);
      const row = s.children.list.find((o) => {
        const t = o as Phaser.GameObjects.BitmapText;
        return t.text === a.label && t.originX === 0;
      }) as Phaser.GameObjects.BitmapText | undefined;
      return !!row && row.tintTopLeft === a.gold;
    },
    { key, label, gold: GOLD },
  );

/** Move the keyboard selection down to `label` (at most 14 rows). */
async function selectRow(page: Page, key: string, label: string): Promise<void> {
  for (let i = 0; i < 14 && !(await rowSelected(page, key, label)); i++) {
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(60);
  }
  expect(await rowSelected(page, key, label), `row ${label} selected`).toBe(true);
}

async function press(page: Page, key: string): Promise<void> {
  await page.keyboard.press(key);
  await page.waitForTimeout(80);
}

/** Title text of the Settings page currently shown. */
const settingsTitle = (page: Page) => harness(page, (h) => h.sceneTexts('Settings').find((t) => ['SETTINGS', 'ASSIST MODE', 'ACCESSIBILITY'].includes(t)) ?? '');

test.describe('assist mode & accessibility', () => {
  test('toggled in the Settings scene and persisted across a reload', async ({ page }) => {
    const log = trackConsole(page);
    await openGame(page);
    await waitForScene(page, 'Menu');
    await page.waitForTimeout(300);
    // PLAY, (CONTINUE disabled on a fresh save), CHARACTER SELECT, COLLECTION, SETTINGS
    for (let i = 0; i < 3; i++) await press(page, 'ArrowDown');
    await press(page, 'Enter');
    await waitForScene(page, 'Settings');
    await page.waitForTimeout(300);
    expect(await settingsTitle(page)).toBe('SETTINGS');

    // ── Assist page ──
    await selectRow(page, 'Settings', 'ASSIST MODE');
    await press(page, 'Enter');
    await expect.poll(() => settingsTitle(page)).toBe('ASSIST MODE');
    await page.waitForTimeout(200);
    expect(await rowSelected(page, 'Settings', 'GAME SPEED')).toBe(true);
    await press(page, 'ArrowRight'); // 100% → 85%
    await press(page, 'ArrowRight'); // → 70%
    await expect.poll(async () => (await settings(page)).gameSpeed).toBe(0.7);
    for (const [label, key] of [
      ['EXTRA HEARTS (+2)', 'extraHearts'],
      ['INFINITE LIVES', 'infiniteLives'],
      ['SAFETY NET (PITS)', 'safetyNet'],
    ] as const) {
      await selectRow(page, 'Settings', label);
      await press(page, 'Enter');
      await expect.poll(async () => (await settings(page))[key]).toBe(true);
    }
    expect((await harness(page, (h) => h.sceneTexts('Settings'))).join(' ')).toContain('70%');
    await press(page, 'Escape'); // back to the main page, on ASSIST MODE
    await expect.poll(() => settingsTitle(page)).toBe('SETTINGS');
    await page.waitForTimeout(200);
    expect(await rowSelected(page, 'Settings', 'ASSIST MODE')).toBe(true);

    // ── Accessibility page ──
    await selectRow(page, 'Settings', 'ACCESSIBILITY');
    await press(page, 'Enter');
    await expect.poll(() => settingsTitle(page)).toBe('ACCESSIBILITY');
    await page.waitForTimeout(200);
    await press(page, 'Enter'); // SCREEN SHAKE → OFF
    await expect.poll(async () => (await settings(page)).screenShake).toBe(false);
    for (const [label, key] of [
      ['REDUCE FLASHING', 'reduceFlashing'],
      ['HIGH-CONTRAST OUTLINE', 'highContrast'],
    ] as const) {
      await selectRow(page, 'Settings', label);
      await press(page, 'Enter');
      await expect.poll(async () => (await settings(page))[key]).toBe(true);
    }

    const before = await settings(page);
    expect(before).toMatchObject({
      gameSpeed: 0.7, extraHearts: true, infiniteLives: true, safetyNet: true, bossSkip: false, autoRun: false,
      screenShake: false, reduceFlashing: true, highContrast: true,
    });

    await page.reload();
    await page.waitForFunction(() => !!window.__harness);
    await page.evaluate(() => window.__harness!.ready());
    expect(await settings(page)).toEqual(before);
    const raw = await page.evaluate(() => JSON.parse(localStorage.getItem('cfa-save') ?? '{}').settings);
    expect(raw).toMatchObject({ gameSpeed: 0.7, safetyNet: true, highContrast: true });

    // The options apply in a level: +2 hearts; outlines and reduced flashing don't break anything.
    await startLevel(page, 'test', 'dad', { manual: true });
    expect((await getState(page)).health).toBe(5);
    await stepFrames(page, 30);
    expect(log.errors, log.errors.join('\n')).toEqual([]);
  });

  test('safety net: a pit fall costs one heart and returns the hero to safe ground', async ({ page }) => {
    await openGame(page);
    await harness(page, (h) => h.setSettings({ safetyNet: true }));
    await startLevel(page, 'test', 'dad', { manual: true });
    await stepFrames(page, 40); // stand still: the start is now known safe ground
    const s0 = await getState(page);
    expect(s0.grounded).toBe(true);
    expect(s0.health).toBe(3);

    // Walk right into the first pit (tile columns 31-33, x 496..544).
    await harness(page, (h) => h.teleport(470, 239));
    await stepFrames(page, 30);
    await setInput(page, { right: true });
    let rescued = false;
    for (let i = 0; i < 40 && !rescued; i++) {
      await stepFrames(page, 5);
      const s = await getState(page);
      if (s.health < 3) rescued = true;
      if (s.x > 500) await setInput(page, {});
    }
    await setInput(page, {});
    await stepFrames(page, 20);
    const s1 = await getState(page);
    expect(rescued, 'fell into the pit').toBe(true);
    expect(s1.mode).not.toBe('dead');
    expect(s1.deaths).toBe(0);
    expect(s1.health).toBe(2);
    expect(s1.lives).toBe(s0.lives);
    expect(s1.grounded).toBe(true);
    expect(s1.x, 'back on the ground left of the pit').toBeLessThan(496);
    expect(s1.y).toBeLessThanOrEqual(241);

    // Control: without the safety net the same fall is a death.
    await harness(page, (h) => h.setSettings({ safetyNet: false }));
    await startLevel(page, 'test', 'dad', { manual: true });
    await stepFrames(page, 10);
    await harness(page, (h) => h.teleport(520, 200));
    await stepFrames(page, 90);
    expect((await getState(page)).mode).toBe('dead');
  });

  test('infinite lives: dying keeps the lives count unchanged', async ({ page }) => {
    await openGame(page);
    await harness(page, (h) => h.setSettings({ infiniteLives: true }));
    await startLevel(page, 'test', 'dad', { manual: true });
    const lives = (await getState(page)).lives;
    for (let d = 0; d < 2; d++) {
      await harness(page, (h) => h.killPlayer());
      await stepFrames(page, 2);
      expect((await getState(page)).lives).toBe(lives);
      await stepFrames(page, 120); // death delay + fade → level restarts
      const s = await getState(page);
      expect(s.mode).not.toBe('dead');
      expect(s.lives).toBe(lives);
    }
    expect(await harness(page, (h) => h.sceneTexts('HUD'))).toContain(`x${lives}`);

    // Control: with it off a death costs a life.
    await harness(page, (h) => h.setSettings({ infiniteLives: false }));
    await startLevel(page, 'test', 'dad', { manual: true });
    await harness(page, (h) => h.killPlayer());
    await stepFrames(page, 2);
    expect((await getState(page)).lives).toBe(lives - 1);
  });

  test('game speed: same fixed-step jump arc, less game time per frame', async ({ page }) => {
    await openGame(page);
    const jump = async (speed: number) => {
      await harness(page, (h, s) => h.setSettings({ gameSpeed: s as 1 }), speed);
      await startLevel(page, 'test', 'dad', { manual: true });
      await stepFrames(page, 20);
      // Hold jump until landing, stepping 60 Hz rendered frames inside the page.
      return harness(page, async (h) => {
        const s0 = h.getState();
        h.setInput({ jump: true });
        let minY = s0.y;
        let frames = 0;
        for (; frames < 200; frames++) {
          await h.stepFrames(1);
          const s = h.getState();
          minY = Math.min(minY, s.y);
          if (frames > 5 && s.grounded) break;
        }
        h.setInput({});
        return { peak: s0.y - minY, frames, t: h.getState().levelTimeMs - s0.levelTimeMs };
      });
    };
    const normal = await jump(1);
    const slow = await jump(0.7);
    expect(normal.peak).toBeGreaterThan(40);
    expect(slow.peak).toBeCloseTo(normal.peak, 0);
    // The arc takes ~1/0.7 as many rendered frames but about the same game time.
    expect(slow.frames / normal.frames).toBeGreaterThan(1.3);
    expect(slow.frames / normal.frames).toBeLessThan(1.6);
    expect(Math.abs(slow.t - normal.t)).toBeLessThan(60);
  });

  test('boss skip: offered after 3 deaths on a boss level, skipping clears it without a medal', async ({ page }) => {
    await openGame(page);
    const aliased = await harness(page, (h) => h.aliasMissingLevels());
    expect(aliased).not.toContain('loop-boss');
    await harness(page, (h) => h.setSettings({ bossSkip: true }));
    await startLevel(page, 'loop-boss', 'dad', { manual: true });
    for (let d = 1; d <= 3; d++) {
      await harness(page, (h) => h.killPlayer());
      await stepFrames(page, 120); // death delay + fade → restart
      if (d < 3) {
        await stepFrames(page, 90);
        expect(await harness(page, (h) => h.isActive('Pause')), `no prompt after ${d} deaths`).toBe(false);
      }
    }
    await stepFrames(page, 90); // the prompt pauses the level
    await waitForScene(page, 'Pause');
    expect((await harness(page, (h) => h.sceneTexts('Pause'))).join('|')).toContain('TOUGH BOSS?');
    await page.waitForTimeout(250);
    await press(page, 'ArrowDown'); // KEEP TRYING → SKIP BOSS
    await press(page, 'Enter');
    await page.waitForFunction(() => !window.__harness!.isActive('Pause'));
    await stepFrames(page, 200); // celebration + fade
    await waitForScene(page, 'Results', 20_000);
    await expect.poll(async () => (await harness(page, (h) => h.sceneTexts('Results'))).join('|')).toContain('BOSS SKIPPED');
    const save = (await harness(page, (h) => h.getSave())) as { levels: Record<string, { completed: boolean; medal?: string; bestTimeMs?: number }> };
    expect(save.levels['loop-boss'].completed).toBe(true);
    expect(save.levels['loop-boss'].medal).toBeUndefined();
    expect(save.levels['loop-boss'].bestTimeMs).toBeUndefined();
  });

  test('assisted clear: ASSIST tag on Results and no gold medal', async ({ page }) => {
    await openGame(page);
    const aliased = await harness(page, (h) => h.aliasMissingLevels());
    expect(aliased).not.toContain('loop-1');
    await harness(page, (h) => h.setSettings({ extraHearts: true }));
    await startLevel(page, 'loop-1', 'dad');
    await harness(page, (h) => h.completeLevel()); // instant clear = a gold time
    await waitForScene(page, 'Results', 20_000);
    await expect.poll(async () => (await harness(page, (h) => h.sceneTexts('Results'))).join('|')).toContain('ASSIST');
    const save = (await harness(page, (h) => h.getSave())) as { levels: Record<string, { medal?: string }> };
    expect(save.levels['loop-1'].medal).toBe('silver');
    const texts = await harness(page, (h) => h.sceneTexts('Results'));
    expect(texts).toContain('SILVER');
    expect(texts).not.toContain('GOLD');
  });
});
