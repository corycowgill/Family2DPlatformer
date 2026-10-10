import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { CHARACTERS, availableLevels, harness, openGame, runBot, warn, type BotResult } from './helpers';

/**
 * Automated platforming bot. It must finish the test level with every character.
 * For the real levels (whatever exists on disk among LEVELS) a bot failure is reported
 * as a warning with the stuck coordinates and a screenshot — not as a test failure,
 * because a heuristic bot failing is not proof that a level is impossible.
 */

function summary(r: BotResult): string {
  const where = r.stuckAt ? ` stuck at (${Math.round(r.stuckAt.x)}, ${Math.round(r.stuckAt.y)}) [${r.stuckAt.reason}]` : '';
  return `${r.levelId}/${r.character}: ${r.completed ? 'COMPLETED' : 'FAILED'} in ${r.simSeconds.toFixed(1)}s sim, progress ${(r.progress * 100).toFixed(0)}%, maxX ${r.maxX}/${r.goalX ?? r.levelWidth}, deaths ${r.deaths}, rewinds ${r.rewinds}${where}`;
}

async function report(page: Page, testInfo: TestInfo, r: BotResult): Promise<void> {
  console.log(`[bot] ${summary(r)}`);
  await testInfo.attach(`bot-${r.levelId}-${r.character}.json`, { body: JSON.stringify(r, null, 2), contentType: 'application/json' });
  if (!r.completed) {
    if (r.stuckAt) {
      await harness(page, (h, at) => h.teleport(at.x, at.y), r.stuckAt);
      await page.waitForTimeout(150);
    }
    await testInfo.attach(`stuck-${r.levelId}-${r.character}.png`, { body: await page.screenshot(), contentType: 'image/png' });
  }
}

test.describe('platforming bot', () => {
  test.describe.configure({ timeout: 180_000 });

  for (const character of CHARACTERS) {
    test(`completes the test level as ${character} (damage on)`, async ({ page }, testInfo) => {
      await openGame(page);
      const r = await runBot(page, { levelId: 'test', character, invulnerable: false });
      await report(page, testInfo, r);
      expect(r.completed, summary(r)).toBe(true);
    });
  }

  test('clears a widened 6-tile gap (needs a running jump)', async ({ page }, testInfo) => {
    await openGame(page);
    const r = await harness(page, async (h) => {
      await h.startLevel('test', 'mom', { manual: true });
      h.editTiles('ground', 58, 15, 6, 2, -1); // test.json gap at 61..63 → 58..63
      return h.bot({ noRestart: true, invulnerable: true });
    });
    await report(page, testInfo, r);
    expect(r.completed, summary(r)).toBe(true);
  });

  test('reports stuck coordinates (and retries) on an impassable wall', async ({ page }, testInfo) => {
    await openGame(page);
    const r = await harness(page, async (h) => {
      await h.startLevel('test', 'dad', { manual: true });
      h.editTiles('ground', 50, 3, 1, 12, 41); // 12-tile STEEL_BLOCK wall at x = 800..816
      return h.bot({ noRestart: true, invulnerable: true, maxAttemptsPerSection: 3, stuckFrames: 120 });
    });
    await report(page, testInfo, r);
    expect(r.completed).toBe(false);
    expect(r.stuckAt).toBeDefined();
    expect(r.stuckAt!.reason).toBe('stuck');
    expect(r.stuckAt!.x).toBeGreaterThan(760);
    expect(r.stuckAt!.x).toBeLessThan(800);
    expect(r.rewinds).toBe(3);
    expect(r.failures[0].attempts).toBe(4);
  });

  test('traverses every registered level that exists (warn only)', async ({ page }, testInfo) => {
    await openGame(page);
    const levels = (await availableLevels(page)).filter((l) => l.exists && l.id !== 'test');
    if (levels.length === 0) {
      testInfo.annotations.push({ type: 'info', description: 'No LEVELS map files exist yet — only the test level was checked.' });
      return;
    }
    const results: string[] = [];
    for (const l of levels) {
      if (l.boss) {
        testInfo.annotations.push({ type: 'info', description: `${l.id}: boss level — bot only checks it loads` });
        await harness(page, (h, id) => h.startLevel(id, 'dad', { manual: true }), l.id);
        continue;
      }
      for (const character of CHARACTERS) {
        const r = await runBot(page, { levelId: l.id, character, invulnerable: true, maxFrames: 60 * 240 });
        await report(page, testInfo, r);
        results.push(summary(r));
        if (!r.completed) warn(testInfo, `bot could not finish ${summary(r)}`);
      }
    }
    await testInfo.attach('bot-summary.txt', { body: results.join('\n'), contentType: 'text/plain' });
  });
});
