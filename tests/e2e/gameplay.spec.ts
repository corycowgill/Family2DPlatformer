import { test, expect } from '@playwright/test';
import { getState, harness, holdKey, openGame, setInput, startLevel, trackConsole, waitForScene } from './helpers';

test.describe('menus → level', () => {
  test('menu → character select → world map → level start via keyboard @smoke', async ({ page }, testInfo) => {
    const log = trackConsole(page);
    await openGame(page);
    const aliased = await harness(page, (h) => h.aliasMissingLevels());
    if (aliased.length) testInfo.annotations.push({ type: 'info', description: `maps missing, using test.json for: ${aliased.join(', ')}` });

    await waitForScene(page, 'Menu');
    await page.keyboard.press('Enter'); // Play
    await waitForScene(page, 'CharacterSelect');
    await page.keyboard.press('ArrowRight'); // dad → mom
    await page.keyboard.press('Enter');
    await waitForScene(page, 'WorldMap');
    await page.keyboard.press('Enter'); // first unlocked level
    await waitForScene(page, 'Level');
    await waitForScene(page, 'HUD');
    const s = await getState(page);
    expect(s.levelId).toBe('loop-1');
    expect(s.character).toBe('mom');
    const save = (await harness(page, (h) => h.getSave())) as { selectedCharacter: string };
    expect(save.selectedCharacter).toBe('mom');
    expect(log.errors, log.errors.join('\n')).toEqual([]);
  });

  test('player moves on keyboard input', async ({ page }) => {
    await openGame(page);
    await startLevel(page, 'test', 'dad');
    await page.waitForTimeout(400);
    const s0 = await getState(page);
    await page.keyboard.down('ArrowRight');
    await page.waitForFunction((x) => window.__harness!.getState().x > x + 30, s0.x, { timeout: 15_000 });
    await page.keyboard.up('ArrowRight');
    const s1 = await getState(page);
    await page.keyboard.down('Space');
    await page.waitForFunction((y) => window.__harness!.getState().y < y - 5, s1.y, { timeout: 15_000 });
    await page.keyboard.up('Space');
  });
});

test.describe('pause', () => {
  test('Esc pauses and resumes; held keys do not stick through a pause', async ({ page }) => {
    await openGame(page);
    await startLevel(page, 'test', 'dad');
    await page.waitForTimeout(400);
    await holdKey(page, 'Escape');
    await waitForScene(page, 'Pause');
    const frozen = await getState(page);
    expect(await harness(page, (h) => h.game.scene.isPaused('Level'))).toBe(true);
    await page.waitForTimeout(500);
    expect((await getState(page)).levelTimeMs).toBe(frozen.levelTimeMs);

    await holdKey(page, 'Escape');
    await page.waitForFunction(() => !window.__harness!.isActive('Pause'));
    await page.waitForFunction(() => window.__harness!.isActive('Level'));
    await page.waitForTimeout(300);
    expect((await getState(page)).levelTimeMs).toBeGreaterThan(frozen.levelTimeMs);

    // Pause again while running right, release during the pause, resume: player must stop.
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(300);
    await holdKey(page, 'Escape');
    await waitForScene(page, 'Pause');
    await page.keyboard.up('ArrowRight');
    await holdKey(page, 'Escape');
    await page.waitForFunction(() => window.__harness!.isActive('Level'));
    await page.waitForTimeout(500);
    const a = await getState(page);
    await page.waitForTimeout(400);
    const b = await getState(page);
    expect(Math.abs(b.x - a.x)).toBeLessThan(2);

    // And Esc pauses again on the first press after a resume.
    await holdKey(page, 'Escape');
    await waitForScene(page, 'Pause');
  });

  test('pause menu "Restart Level" and "Quit to Map" work', async ({ page }) => {
    await openGame(page);
    await harness(page, (h) => h.aliasMissingLevels());
    await startLevel(page, 'loop-1', 'dad');
    const start = await getState(page);
    await setInput(page, { right: true });
    await page.waitForFunction((x) => window.__harness!.getState().x > x + 60, start.x, { timeout: 15_000 });
    await setInput(page, null);
    const moved = await getState(page);
    await holdKey(page, 'Escape');
    await waitForScene(page, 'Pause');
    await page.keyboard.press('ArrowDown'); // Resume → Restart Level
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__harness!.isActive('Level') && !window.__harness!.isActive('Pause'));
    await page.waitForFunction((x) => window.__harness!.getState().x < x - 40, moved.x, { timeout: 15_000 });
    expect(await harness(page, (h) => h.isActive('HUD'))).toBe(true);

    await holdKey(page, 'Escape');
    await waitForScene(page, 'Pause');
    for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowDown'); // last item: Quit to Map
    await page.keyboard.press('Enter');
    await waitForScene(page, 'WorldMap');
    expect(await harness(page, (h) => h.scenes())).toEqual(['WorldMap']);
  });
});

test.describe('death & respawn', () => {
  test('falling into a pit costs a life and restarts the level', async ({ page }) => {
    await openGame(page);
    const s0 = await startLevel(page, 'test', 'dad');
    await harness(page, (h) => h.teleport(32 * 16 + 8, 180)); // pit at columns 31..33
    await page.waitForFunction(() => window.__harness!.getState().mode === 'dead');
    expect((await getState(page)).lives).toBe(s0.lives - 1);
    expect(await harness(page, (h) => h.sceneTexts('HUD'))).toContain(`x${s0.lives - 1}`);
    await page.waitForFunction(() => {
      const s = window.__harness!.getState();
      return s.levelId === 'test' && s.mode === 'normal' && s.x < 100;
    }, undefined, { timeout: 10_000 });
    const s1 = await getState(page);
    expect(s1.lives).toBe(s0.lives - 1);
    expect(s1.health).toBe(3);
    expect(await harness(page, (h) => h.sceneTexts('HUD'))).toContain(`x${s0.lives - 1}`);
  });

  test('respawns at the last checkpoint reached', async ({ page }) => {
    await openGame(page);
    await startLevel(page, 'test', 'dad');
    const cp = await harness(page, (h) => h.teleportToCheckpoint(0));
    await page.waitForFunction(() => window.__harness!.getState().checkpoint === 0);
    await harness(page, (h) => h.killPlayer());
    await page.waitForFunction(() => window.__harness!.getState().mode === 'dead');
    await page.waitForFunction(() => window.__harness!.getState().mode === 'normal', undefined, { timeout: 10_000 });
    const s = await getState(page);
    expect(Math.abs(s.x - cp.x)).toBeLessThan(4);
  });

  test('losing the last life shows GAME OVER and resets lives', async ({ page }) => {
    await openGame(page);
    await startLevel(page, 'test', 'dad');
    await harness(page, (h) => {
      h.setLives(1);
      h.killPlayer();
    });
    await waitForScene(page, 'Results', 10_000);
    expect(await harness(page, (h) => h.sceneTexts('Results'))).toContain('GAME OVER');
    expect((await getState(page)).lives).toBe(5);
    await page.keyboard.press('Enter'); // Try Again
    await waitForScene(page, 'Level');
    await page.waitForFunction(() => window.__harness!.getState().mode === 'normal');
  });

  test('hazards hurt and grant temporary invulnerability', async ({ page }) => {
    await openGame(page);
    await startLevel(page, 'test', 'dad', { manual: true });
    // Spikes at columns 88..89, row 14 of test.json.
    await harness(page, async (h) => {
      h.teleport(88 * 16 + 8, 14 * 16 + 15);
      await h.stepFrames(3);
    });
    const hit = await getState(page);
    expect(hit.health).toBe(2);
    await harness(page, (h) => h.stepFrames(20));
    expect((await getState(page)).health).toBe(2); // still invulnerable
  });
});

test.describe('completion & save', () => {
  test('completing a level shows Results, unlocks the next level and persists across reload', async ({ page }, testInfo) => {
    const log = trackConsole(page);
    await openGame(page);
    const aliased = await harness(page, (h) => h.aliasMissingLevels());
    if (aliased.length) testInfo.annotations.push({ type: 'info', description: `maps missing, using test.json for: ${aliased.join(', ')}` });
    await startLevel(page, 'loop-1', 'brennan');
    await page.waitForTimeout(300);
    await harness(page, (h) => h.completeLevel());
    expect((await getState(page)).finished).toBe(true);
    await waitForScene(page, 'Results', 10_000);
    expect(await harness(page, (h) => h.sceneTexts('Results'))).toContain('LEVEL CLEAR!');
    type Save = { unlocked: string[]; levels: Record<string, { completed: boolean; bestTimeMs?: number }> };
    const save = (await harness(page, (h) => h.getSave())) as Save;
    expect(save.unlocked).toContain('loop-2');
    expect(save.levels['loop-1'].completed).toBe(true);
    expect(save.levels['loop-1'].bestTimeMs).toBeGreaterThan(0);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('cfa-save') ?? 'null'));
    expect(stored.unlocked).toContain('loop-2');

    // "Next Level" starts loop-2.
    await page.keyboard.press('Enter');
    await waitForScene(page, 'Level');
    await page.waitForFunction(() => window.__harness!.getState().levelId === 'loop-2');

    // Reload: progress survives, Continue is enabled and the map shows loop-2 unlocked.
    await page.reload();
    await page.waitForFunction(() => !!window.__harness);
    await page.evaluate(() => window.__harness!.ready());
    const after = (await harness(page, (h) => h.getSave())) as Save & { selectedCharacter: string };
    expect(after.unlocked).toContain('loop-2');
    expect(after.levels['loop-1'].completed).toBe(true);
    await waitForScene(page, 'Menu');
    await page.keyboard.press('ArrowDown'); // Play → Continue (enabled when there is progress)
    await page.keyboard.press('Enter');
    await waitForScene(page, 'WorldMap');
    const mapTexts = await harness(page, (h) => h.sceneTexts('WorldMap'));
    expect(mapTexts.some((t) => t.startsWith('1-1') && t.includes('✓'))).toBe(true);
    expect(log.errors, log.errors.join('\n')).toEqual([]);
  });

  test('corrupted save in localStorage does not break boot', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('cfa-save', '{"version":1,"unlocked":"oops",'));
    const log = trackConsole(page);
    await page.goto('./?test');
    await page.waitForFunction(() => !!window.__harness);
    await page.evaluate(() => window.__harness!.ready());
    await waitForScene(page, 'Menu');
    const save = (await harness(page, (h) => h.getSave())) as { unlocked: string[] };
    expect(save.unlocked).toEqual(['loop-1']);
    expect(log.errors).toEqual([]);
  });
});

test.describe('known defects (expected to fail until fixed)', () => {
  test('player stays grounded while standing/running on flat ground', async ({ page }) => {
    test.fail(true, 'DEFECT: grounded flickers every other frame on flat ground (Player sets vy=0 with gravity off → body leaves contact) — see docs/QA.md');
    await openGame(page);
    await startLevel(page, 'test', 'dad', { manual: true });
    const flips = await harness(page, async (h) => {
      await h.stepFrames(40);
      h.setInput({ right: true, run: true });
      let prev = h.getState().grounded;
      let n = 0;
      for (let i = 0; i < 60; i++) {
        await h.stepFrames(1);
        const g = h.getState().grounded;
        if (g !== prev) n++;
        prev = g;
      }
      return n;
    });
    expect(flips).toBe(0);
  });
});
