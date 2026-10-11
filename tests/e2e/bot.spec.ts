import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { CHARACTERS, availableLevels, harness, openGame, runBot, type BotResult } from './helpers';
import { LEVELS } from '../../src/game/data/levels';

/**
 * Automated platforming bot (src/game/debug/PlatformBot.ts — a route planner over the
 * level's tiles + a receding-horizon controller that simulates the real motor). It must
 * finish the test level and every registered level with every character; a failure comes
 * with the stuck coordinates, a screenshot and the bot's JSON (deaths, hurts, rewinds).
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
});

/**
 * The real levels: the bot must finish every registered level with every character.
 * Regular levels with damage on (deaths just rewind the bot); boss levels are beaten with
 * invulnerability, and a separate damage-on run must at least reach the boss arena.
 */
test.describe('platforming bot on the real levels', () => {
  test.describe.configure({ mode: 'parallel', timeout: 8 * 60_000 });

  for (const level of LEVELS) {
    const title = level.boss ? `${level.id}: every character beats the boss (invulnerable)` : `${level.id}: every character finishes with damage on`;
    test(title, async ({ page }, testInfo) => {
      await openGame(page);
      const exists = (await availableLevels(page)).find((l) => l.id === level.id)?.exists;
      test.skip(!exists, `${level.file} not built`);
      const failed: string[] = [];
      const lines: string[] = [];
      for (const character of CHARACTERS) {
        const r = await runBot(page, { levelId: level.id, character, invulnerable: !!level.boss, maxFrames: 60 * 300 });
        await report(page, testInfo, r);
        lines.push(summary(r));
        if (!r.completed) failed.push(summary(r));
      }
      await testInfo.attach(`bot-${level.id}-summary.txt`, { body: lines.join('\n'), contentType: 'text/plain' });
      expect(failed, failed.join('\n')).toEqual([]);
    });

    if (level.boss) {
      test(`${level.id}: every character reaches the boss arena with damage on`, async ({ page }, testInfo) => {
        await openGame(page);
        const exists = (await availableLevels(page)).find((l) => l.id === level.id)?.exists;
        test.skip(!exists, `${level.file} not built`);
        const failed: string[] = [];
        for (const character of CHARACTERS) {
          const r = await runBot(page, { levelId: level.id, character, invulnerable: false, stopAtBossArena: true, maxFrames: 60 * 240 });
          await report(page, testInfo, r);
          if (!r.reachedBossArena) failed.push(summary(r));
        }
        expect(failed, failed.join('\n')).toEqual([]);
      });
    }
  }
});
