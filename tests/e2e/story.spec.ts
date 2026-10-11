import { test, expect, type Page } from '@playwright/test';
import { getState, harness, openGame, startLevel, trackConsole, waitForScene } from './helpers';

/**
 * Story & presentation: opening comic (only with ?story under automation), level intro card,
 * boss intro beat, World 1 ending → world map, Extras rewatch.
 */

type StoryWin = { __story?: { panel: number; panelCount: number }; __ending?: { currentBeat: string } };
const storyPanel = (page: Page) => page.evaluate(() => (window as unknown as StoryWin).__story?.panel ?? -1);
const endingBeat = (page: Page) => page.evaluate(() => (window as unknown as StoryWin).__ending?.currentBeat ?? '');
const save = (page: Page) => harness(page, (h) => h.getSave()) as Promise<{ seenIntro: boolean; seenEnding: boolean }>;

test.describe('story & cutscenes', () => {
  test('?story: PLAY on a new save plays the opening story; panels advance; ESC skips to character select', async ({ page }) => {
    const log = trackConsole(page);
    await openGame(page, 'test&story');
    await waitForScene(page, 'Menu');
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter'); // PLAY
    await waitForScene(page, 'Story');
    await expect.poll(() => storyPanel(page)).toBe(0);
    expect(await harness(page, (h) => h.isActive('HUD'))).toBe(false);
    await page.waitForTimeout(400);
    // First press completes the typewriter, the second turns the page.
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');
    await expect.poll(() => storyPanel(page)).toBe(1);
    await page.keyboard.press('Escape'); // skip the rest
    await waitForScene(page, 'CharacterSelect');
    expect((await save(page)).seenIntro).toBe(true);

    // Seen once → PLAY goes straight to character select next time.
    await harness(page, (h) => h.game.scene.getScenes(true).forEach((s) => h.game.scene.stop(s.sys.settings.key)));
    await harness(page, (h) => h.game.scene.start('Menu'));
    await waitForScene(page, 'Menu');
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await waitForScene(page, 'CharacterSelect');
    expect(await harness(page, (h) => h.isActive('Story'))).toBe(false);
    expect(log.errors, log.errors.join('\n')).toEqual([]);
  });

  test('without ?story an automated browser never sees the story (PLAY → character select)', async ({ page }) => {
    await openGame(page);
    await waitForScene(page, 'Menu');
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await waitForScene(page, 'CharacterSelect');
    expect((await save(page)).seenIntro).toBe(false);
  });

  test('a tap on the canvas advances the story; the whole story can be clicked through', async ({ page }) => {
    await openGame(page, 'test&story');
    await waitForScene(page, 'Menu');
    await harness(page, (h) => h.game.scene.getScenes(true).forEach((s) => h.game.scene.stop(s.sys.settings.key)));
    await harness(page, (h) => h.game.scene.start('Story', { next: 'Menu' }));
    await waitForScene(page, 'Story');
    const box = (await page.locator('canvas').boundingBox())!;
    for (let i = 0; i < 20 && (await harness(page, (h) => h.isActive('Story'))); i++) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(250);
    }
    await waitForScene(page, 'Menu');
    expect((await save(page)).seenIntro).toBe(true);
  });

  test('level start shows the intro card with the level name and tagline', async ({ page }) => {
    await openGame(page);
    await harness(page, (h) => h.aliasMissingLevels());
    await startLevel(page, 'loop-2', 'mom');
    const texts = await harness(page, (h) => h.sceneTexts('HUD'));
    expect(texts).toEqual(expect.arrayContaining(['WORLD 1-2', 'THE ELEVATED TRACKS', 'MIND THE GAP - AND THE ROBOTS.']));
  });

  test('boss intro: letterbox name card, input held, then the fight HUD; timing unchanged', async ({ page }) => {
    const log = trackConsole(page);
    await openGame(page);
    const aliased = await harness(page, (h) => h.aliasMissingLevels());
    test.skip(aliased.includes('loop-boss'), 'boss map not built');
    await startLevel(page, 'loop-boss', 'dad', { invulnerable: true });
    const arena = await page.evaluate(() => {
      const lv = (window as unknown as { __level: { ctx: { groups: { enemies: { getChildren(): unknown[] } } } } }).__level;
      const b = lv.ctx.groups.enemies.getChildren().find((o) => (o as { bossName?: string }).bossName) as { arena: { x: number; bottom: number } };
      return { x: b.arena.x, bottom: b.arena.bottom };
    });
    await harness(page, (h, a) => h.teleport(a.x + 70, a.bottom - 4), arena);
    await page.waitForFunction(() => (window as unknown as { __level: { inCinematic: boolean } }).__level.inCinematic, undefined, { timeout: 10_000 });
    expect(await harness(page, (h) => h.sceneTexts('HUD'))).toEqual(expect.arrayContaining(['THE EL-IMINATOR', 'CTA LOOP LINE - OUT OF SERVICE']));
    // Input is held during the beat.
    const x0 = (await getState(page)).x;
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(300);
    await page.keyboard.up('ArrowRight');
    expect(Math.abs((await getState(page)).x - x0)).toBeLessThan(6);
    // Control returns and the boss bar appears.
    await page.waitForFunction(() => !(window as unknown as { __level: { inCinematic: boolean } }).__level.inCinematic, undefined, { timeout: 20_000 }); // level time: slow under load
    await expect.poll(() => harness(page, (h) => h.sceneTexts('HUD'))).toContain('THE EL-IMINATOR');
    expect(log.errors, log.errors.join('\n')).toEqual([]);
  });

  test('boss intro can be skipped with JUMP', async ({ page }) => {
    await openGame(page);
    const aliased = await harness(page, (h) => h.aliasMissingLevels());
    test.skip(aliased.includes('loop-boss'), 'boss map not built');
    await startLevel(page, 'loop-boss', 'dad', { invulnerable: true });
    await page.evaluate(() => {
      const w = window as unknown as { __level: { ctx: { groups: { enemies: { getChildren(): unknown[] } } } }; __harness: { teleport(x: number, y: number): void } };
      const b = w.__level.ctx.groups.enemies.getChildren().find((o) => (o as { bossName?: string }).bossName) as { arena: { x: number; bottom: number } };
      w.__harness.teleport(b.arena.x + 70, b.arena.bottom - 4);
    });
    await page.waitForFunction(() => (window as unknown as { __level: { inCinematic: boolean } }).__level.inCinematic, undefined, { timeout: 10_000 });
    await page.keyboard.down('Space');
    await page.waitForFunction(() => !(window as unknown as { __level: { inCinematic: boolean } }).__level.inCinematic, undefined, { timeout: 5_000 });
    await page.keyboard.up('Space');
  });

  test('beating the boss: Results → CONTINUE → ending (flag, credits, teaser) → world map; Extras unlocks rewatch', async ({ page }) => {
    const log = trackConsole(page);
    await openGame(page);
    await harness(page, (h) => h.aliasMissingLevels());
    await startLevel(page, 'loop-boss', 'parker');
    await page.waitForTimeout(300);
    await harness(page, (h) => h.completeLevel());
    await waitForScene(page, 'Results', 10_000);
    expect(await harness(page, (h) => h.sceneTexts('Results'))).toContain('CONTINUE');
    await page.waitForTimeout(400);
    await page.keyboard.press('Enter'); // CONTINUE (first item)
    await waitForScene(page, 'Ending');
    await expect.poll(() => endingBeat(page)).toBe('flag');
    expect((await save(page)).seenEnding).toBe(true);
    // Advance: finish caption / raise flag → credits → teaser.
    for (let i = 0; i < 6 && (await endingBeat(page)) === 'flag'; i++) {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(250);
    }
    await expect.poll(() => endingBeat(page)).toBe('credits');
    await page.keyboard.press('Enter');
    await expect.poll(() => endingBeat(page)).toBe('teaser');
    await expect.poll(() => harness(page, (h) => h.sceneTexts('Ending')), { timeout: 10_000 }).toContain('COMING SOON');
    await page.keyboard.press('Escape');
    await waitForScene(page, 'WorldMap');

    // Extras now offers both rewatches.
    await harness(page, (h) => h.game.scene.getScenes(true).forEach((s) => h.game.scene.stop(s.sys.settings.key)));
    await harness(page, (h) => h.game.scene.start('Extras'));
    await waitForScene(page, 'Extras');
    const texts = await harness(page, (h) => h.sceneTexts('Extras'));
    // The save has progress, so the opening story is watchable too (first row).
    expect(texts).toEqual(expect.arrayContaining(['WATCH: OPENING STORY', 'WATCH: WORLD 1 ENDING']));
    await page.waitForTimeout(300);
    await page.keyboard.press('ArrowDown'); // → ending
    await page.keyboard.press('Enter');
    await waitForScene(page, 'Ending');
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape');
    await waitForScene(page, 'Extras');
    expect(log.errors, log.errors.join('\n')).toEqual([]);
  });
});
