import { test, expect, type Page } from '@playwright/test';
import { getState, harness, openGame, startLevel, trackConsole, waitForScene } from './helpers';

/**
 * Rewards & replay: secret hero (Grandma), costumes, time-trial medals, Collection screen.
 * Progress is set up with h.setSave (sanitised like a real save, retroactive unlocks applied).
 */

interface Save {
  selectedCharacter: string;
  costumes: Record<string, string>;
  unlocks: string[];
  newUnlocks: string[];
  unlockedCharacters: string[];
  levels: Record<string, { completed: boolean; medal?: string; bestTimeMs?: number }>;
}

const cleared = (ids: string[], extra: Record<string, unknown> = {}) => ({
  version: 1,
  selectedCharacter: 'dad',
  unlocked: ['loop-1', 'loop-2', 'loop-3', 'loop-boss'],
  levels: Object.fromEntries(ids.map((id) => [id, { completed: true, bestTimeMs: 200_000, souvenirs: [], stars: 0 }])),
  totalCoins: 0,
  worldsCompleted: [],
  ...extra,
});

const getSave = (page: Page) => harness(page, (h) => h.getSave()) as Promise<Save>;
const setSave = (page: Page, data: unknown) => harness(page, (h, d) => h.setSave(d), data);

async function openSelect(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = window.__harness!.game;
    for (const s of g.scene.getScenes(true)) g.scene.stop(s.scene.key);
    g.scene.start('CharacterSelect', { next: 'Menu' });
  });
  await waitForScene(page, 'CharacterSelect');
  await page.waitForTimeout(250); // nav grace period
}

const selectTexts = (page: Page) => harness(page, (h) => h.sceneTexts('CharacterSelect').join(' | '));

test.describe('rewards & replay', () => {
  test('Grandma is a locked silhouette until the boss is beaten, then a popup unlocks her', async ({ page }) => {
    const log = trackConsole(page);
    await openGame(page);
    await setSave(page, cleared(['loop-1', 'loop-2', 'loop-3']));
    await openSelect(page);
    await page.keyboard.press('ArrowLeft'); // dad → grandma (wraps)
    await expect.poll(() => selectTexts(page)).toContain('BEAT THE BOSS IN 1-4');
    expect(await selectTexts(page)).toContain('???');
    await page.keyboard.press('Enter'); // locked: nothing happens
    await page.waitForTimeout(1200);
    expect(await harness(page, (h) => h.isActive('CharacterSelect'))).toBe(true);
    expect((await getSave(page)).selectedCharacter).toBe('dad');

    // Beat the boss → retroactive unlock, celebrated on the next visit.
    await setSave(page, cleared(['loop-1', 'loop-2', 'loop-3', 'loop-boss'], { worldsCompleted: [1] }));
    expect((await getSave(page)).unlockedCharacters).toEqual(['grandma']);
    await openSelect(page);
    await waitForScene(page, 'Unlock');
    expect(await harness(page, (h) => h.sceneTexts('Unlock').join(' '))).toContain('GRANDMA JOINS THE FAMILY!');
    await page.waitForTimeout(400);
    await page.keyboard.press('Enter');
    await expect.poll(() => harness(page, (h) => h.isActive('Unlock'))).toBe(false);
    expect(await harness(page, (h) => h.isActive('CharacterSelect'))).toBe(true);
    expect((await getSave(page)).newUnlocks).not.toContain('char:grandma');
    await page.waitForTimeout(300);
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => selectTexts(page)).toContain('FRYING PAN SPIN');
    await page.keyboard.press('Enter');
    await waitForScene(page, 'Menu');
    expect((await getSave(page)).selectedCharacter).toBe('grandma');
    // A second visit doesn't celebrate again.
    await openSelect(page);
    await page.waitForTimeout(900);
    expect(await harness(page, (h) => h.isActive('Unlock'))).toBe(false);
    expect(log.errors, log.errors.join('\n')).toEqual([]);
  });

  test('costume picker: unlocked outfits are worn (and persist), locked ones show the hint', async ({ page }) => {
    await openGame(page);
    const aliased = await harness(page, (h) => h.aliasMissingLevels());
    expect(aliased).toEqual([]);
    await setSave(page, cleared(['loop-1', 'loop-2'])); // tier 1 only
    await openSelect(page);
    await page.keyboard.press('ArrowDown'); // classic → flame tee (tier 1)
    await expect.poll(async () => (await getSave(page)).costumes.dad).toBe('flame');
    expect(await selectTexts(page)).toContain('FLAME TEE');
    await page.keyboard.press('ArrowDown'); // raccoon (tier 2, locked)
    await expect.poll(() => selectTexts(page)).toContain('FIND 6 SOUVENIRS');
    await page.keyboard.press('ArrowDown'); // hard hat (tier 3, locked)
    await expect.poll(() => selectTexts(page)).toContain('WIN 3 GOLD MEDALS');
    expect((await getSave(page)).costumes.dad).toBe('flame'); // locked outfits are never saved
    await page.keyboard.press('Enter'); // confirm keeps the last wearable outfit
    await waitForScene(page, 'Menu');

    // In a level the player wears the costume atlas (same anims).
    await startLevel(page, 'loop-1', 'dad');
    const tex = await page.evaluate(() => {
      const lv = window.__harness!.level() as unknown as { player: { texture: { key: string }; anims: { currentAnim?: { key: string } } } };
      return { key: lv.player.texture.key, anim: lv.player.anims.currentAnim?.key ?? '' };
    });
    expect(tex.key).toBe('dad-flame');
    expect(tex.anim.startsWith('dad-flame:')).toBe(true);
  });

  test('time-trial medal: Results shows it, the save keeps the best, 3 golds unlock outfits III', async ({ page }) => {
    const log = trackConsole(page);
    await openGame(page);
    await setSave(page, {
      ...cleared(['loop-1', 'loop-2']),
      levels: {
        'loop-1': { completed: true, bestTimeMs: 30_000, souvenirs: [], stars: 0, medal: 'gold' },
        'loop-2': { completed: true, bestTimeMs: 40_000, souvenirs: [], stars: 0, medal: 'gold' },
      },
    });
    await startLevel(page, 'loop-3', 'parker');
    await page.evaluate(() => {
      (window.__harness!.level() as unknown as { levelTime: number }).levelTime = 20_000;
      window.__harness!.completeLevel();
    });
    await waitForScene(page, 'Results', 15_000);
    const texts = await harness(page, (h) => h.sceneTexts('Results').join(' | '));
    expect(texts).toContain('GOLD');
    expect(texts).toContain('NEW MEDAL!');
    const save = await getSave(page);
    expect(save.levels['loop-3'].medal).toBe('gold');
    expect(save.unlocks).toContain('costume:parker-propeller');
    // the unlock popup follows the tally
    await waitForScene(page, 'Unlock', 15_000);
    expect(await harness(page, (h) => h.sceneTexts('Unlock').join(' '))).toContain('NEW OUTFIT');
    expect(log.errors, log.errors.join('\n')).toEqual([]);
  });

  test('Collection screen lists souvenirs, medals and the unlock table', async ({ page }) => {
    await openGame(page);
    await setSave(page, cleared(['loop-1']));
    await page.evaluate(() => {
      const g = window.__harness!.game;
      for (const s of g.scene.getScenes(true)) g.scene.stop(s.scene.key);
      g.scene.start('Menu');
    });
    await waitForScene(page, 'Menu');
    await page.waitForTimeout(300);
    // with progress the cursor starts on CONTINUE → CHARACTER SELECT → COLLECTION
    for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await waitForScene(page, 'Collection');
    const t = await harness(page, (h) => h.sceneTexts('Collection').join(' | '));
    for (const s of ['COLLECTION', 'WELCOME TO THE LOOP', 'OUTFITS I', 'CLEAR 1-2', 'WIN 3 GOLD MEDALS', 'BEAT THE BOSS IN 1-4', 'CHICAGO STARS']) {
      expect(t).toContain(s);
    }
    await page.keyboard.press('Escape');
    await waitForScene(page, 'Menu');
  });

  test('Grandma: Frying Pan Spin bonks both sides; once per jump it slows the fall', async ({ page }) => {
    await openGame(page);
    await startLevel(page, 'test', 'grandma', { manual: true });
    await harness(page, (h) => h.stepFrames(20));
    const hits = await harness(page, async (h) => {
      h.setInvulnerable(true);
      const st = h.getState();
      h.spawnEnemy('rat', st.x - 16, st.y);
      h.spawnEnemy('rat', st.x + 16, st.y);
      await h.stepFrames(2);
      const before = h.getState().enemies;
      h.setInput({ attack: true });
      await h.stepFrames(2);
      h.setInput(null);
      await h.stepFrames(40);
      return { before, after: h.getState().enemies };
    });
    expect(hits.before).toBeGreaterThanOrEqual(2);
    expect(hits.after).toBeLessThanOrEqual(hits.before - 2);

    // Hover: jump, spin at the apex → fall speed capped while spinning; a second spin in the same jump doesn't hover.
    const fall = await harness(page, async (h) => {
      await h.stepFrames(60); // cooldown over
      h.setInput({ jump: true });
      await h.stepFrames(30);
      h.setInput(null);
      await h.stepFrames(4);
      h.setInput({ attack: true });
      await h.stepFrames(1);
      h.setInput(null);
      const vys: number[] = [];
      for (let i = 0; i < 18; i++) {
        await h.stepFrames(1);
        vys.push(h.getState().vy);
      }
      return { vys, grounded: h.getState().grounded };
    });
    expect(fall.grounded).toBe(false);
    expect(Math.max(...fall.vys)).toBeLessThanOrEqual(46);
    expect(await getState(page).then((s) => s.character)).toBe('grandma');
  });
});
