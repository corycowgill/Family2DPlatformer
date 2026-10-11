import { test, expect, type Page } from '@playwright/test';
import { CHARACTERS, harness, openGame, startLevel, trackConsole, waitForScene } from './helpers';

/**
 * World 2 "The North Side": progression from World 1, world map region, the World 2 story
 * beat, the World 1 → World 2 hand-off in the ending, the World 2 ending, and THE OVERSEER
 * boss being beatable with stomps alone by every character (PlatformBot, invulnerable).
 */

type StoryWin = { __story?: { panel: number; storyId: string }; __ending?: { currentBeat: string; endingWorld: number } };
const endingBeat = (page: Page) => page.evaluate(() => (window as unknown as StoryWin).__ending?.currentBeat ?? '');

const W1_DONE = {
  version: 1,
  selectedCharacter: 'dad',
  unlocked: ['loop-1', 'loop-2', 'loop-3', 'loop-boss'],
  levels: Object.fromEntries(['loop-1', 'loop-2', 'loop-3', 'loop-boss'].map((id) => [id, { completed: true, bestTimeMs: 200_000, souvenirs: [], stars: 0 }])),
  totalCoins: 0,
  worldsCompleted: [1],
};

const setSave = (page: Page, data: unknown) => harness(page, (h, d) => h.setSave(d), data);
const startScene = (page: Page, key: string, data?: object) =>
  page.evaluate(
    ([k, d]) => {
      const g = window.__harness!.game;
      for (const s of g.scene.getScenes(true)) g.scene.stop(s.scene.key);
      g.registry.remove('mapIndex');
      g.scene.start(k as string, d as object | undefined);
    },
    [key, data] as const,
  );

test.describe('World 2: the North Side', () => {
  test('World 2 stays locked until the Loop is saved; an old World 1 save opens it with the cursor on 2-1', async ({ page }) => {
    const log = trackConsole(page);
    await openGame(page);
    await startScene(page, 'WorldMap');
    await waitForScene(page, 'WorldMap');
    let save = (await harness(page, (h) => h.getSave())) as { unlocked: string[] };
    expect(save.unlocked).not.toContain('north-1');

    // A save that beat the EL-iminator before World 2 existed: 2-1 unlocks retroactively.
    save = (await setSave(page, W1_DONE)) as { unlocked: string[] };
    expect(save.unlocked).toContain('north-1');
    await startScene(page, 'WorldMap');
    await waitForScene(page, 'WorldMap');
    await page.waitForTimeout(300);
    const texts = await harness(page, (h) => h.sceneTexts('WorldMap'));
    expect(texts).toEqual(expect.arrayContaining(['WORLD 2-1', 'LINCOLN PARK', 'NEW ADVENTURE!', 'WORLD 2 · THE NORTH SIDE', '2-4', 'BOSS']));
    // Walk up the path to 2-2 is blocked (locked), PLAY goes into 2-1 (no story under automation).
    await page.keyboard.press('Enter');
    await waitForScene(page, 'Level');
    expect((await harness(page, (h) => h.getState())).levelId).toBe('north-1');
    expect(log.errors, log.errors.join('\n')).toEqual([]);
  });

  test('?story: the World 2 story plays once when entering World 2, then the level starts', async ({ page }) => {
    await openGame(page, 'test&story');
    await setSave(page, W1_DONE);
    await startScene(page, 'WorldMap');
    await waitForScene(page, 'WorldMap');
    await page.waitForTimeout(350);
    await page.keyboard.press('Enter');
    await waitForScene(page, 'Story');
    await expect.poll(() => page.evaluate(() => (window as unknown as StoryWin).__story?.storyId)).toBe('world2');
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape');
    await waitForScene(page, 'Level');
    expect((await harness(page, (h) => h.getState())).levelId).toBe('north-1');
    expect(((await harness(page, (h) => h.getSave())) as { seenStories: string[] }).seenStories).toContain('world2-intro');
    // Seen once → straight into the level next time.
    await startScene(page, 'WorldMap');
    await waitForScene(page, 'WorldMap');
    await page.waitForTimeout(350);
    await page.keyboard.press('Enter');
    await waitForScene(page, 'Level');
    expect(await harness(page, (h) => h.isActive('Story'))).toBe(false);
  });

  test('beating 1-4: ending teaser says WORLD 2 UNLOCKED and the map opens on 2-1', async ({ page }) => {
    const log = trackConsole(page);
    await openGame(page);
    await harness(page, (h) => h.aliasMissingLevels());
    await startLevel(page, 'loop-boss', 'mom');
    await page.waitForTimeout(300);
    await harness(page, (h) => h.completeLevel());
    await waitForScene(page, 'Results', 10_000);
    const results = await harness(page, (h) => h.sceneTexts('Results'));
    expect(results).toContain('CONTINUE');
    expect(results).not.toContain('NEXT LEVEL');
    expect(((await harness(page, (h) => h.getSave())) as { unlocked: string[] }).unlocked).toContain('north-1');
    await page.waitForTimeout(400);
    await page.keyboard.press('Enter');
    await waitForScene(page, 'Ending');
    for (let i = 0; i < 8 && (await endingBeat(page)) !== 'teaser'; i++) {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
    }
    await expect.poll(() => harness(page, (h) => h.sceneTexts('Ending')), { timeout: 10_000 }).toEqual(expect.arrayContaining(['WORLD 2', 'UNLOCKED!', 'THE NORTH SIDE']));
    await page.keyboard.press('Escape');
    await waitForScene(page, 'WorldMap');
    await page.waitForTimeout(300);
    expect(await harness(page, (h) => h.sceneTexts('WorldMap'))).toEqual(expect.arrayContaining(['WORLD 2-1', 'LINCOLN PARK']));
    expect(log.errors, log.errors.join('\n')).toEqual([]);
  });

  test('beating 2-4: WORLD 2 CLEAR → W-flag ending → World 3 teaser → world map; Extras rewatch', async ({ page }) => {
    const log = trackConsole(page);
    await openGame(page);
    await setSave(page, { ...W1_DONE, unlocked: [...W1_DONE.unlocked, 'north-1', 'north-2', 'north-3', 'north-4'] });
    await startLevel(page, 'north-4', 'lupin');
    await page.waitForTimeout(300);
    await harness(page, (h) => h.completeLevel());
    await waitForScene(page, 'Results', 10_000);
    expect(await harness(page, (h) => h.sceneTexts('Results'))).toEqual(expect.arrayContaining(['WORLD 2 CLEAR!', 'CONTINUE']));
    await page.waitForTimeout(400);
    await page.keyboard.press('Enter');
    await waitForScene(page, 'Ending');
    await expect.poll(() => page.evaluate(() => (window as unknown as StoryWin).__ending?.endingWorld)).toBe(2);
    await expect.poll(() => harness(page, (h) => h.sceneTexts('Ending')), { timeout: 10_000 }).toContain('WRIGLEY IS SAVED!');
    for (let i = 0; i < 8 && (await endingBeat(page)) !== 'teaser'; i++) {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
    }
    await expect.poll(() => harness(page, (h) => h.sceneTexts('Ending')), { timeout: 10_000 }).toEqual(expect.arrayContaining(['WORLD 3', 'COMING SOON']));
    await page.keyboard.press('Escape');
    await waitForScene(page, 'WorldMap');
    const save = (await harness(page, (h) => h.getSave())) as { worldsCompleted: number[]; seenStories: string[] };
    expect(save.worldsCompleted).toEqual(expect.arrayContaining([1, 2]));
    expect(save.seenStories).toContain('world2-ending');
    await startScene(page, 'Extras');
    await waitForScene(page, 'Extras');
    expect(await harness(page, (h) => h.sceneTexts('Extras'))).toContain('WATCH: WORLD 2 ENDING');
    expect(log.errors, log.errors.join('\n')).toEqual([]);
  });

  test('every World 2 level loads and runs without errors', async ({ page }) => {
    const log = trackConsole(page);
    await openGame(page);
    for (const id of ['north-1', 'north-2', 'north-3', 'north-4']) {
      await startLevel(page, id, 'parker', { manual: true });
      await harness(page, (h) => h.stepFrames(90));
      const s = await harness(page, (h) => h.getState());
      expect(s.levelId).toBe(id);
      expect(s.grounded, id).toBe(true);
    }
    expect(log.errors, log.errors.join('\n')).toEqual([]);
  });
});

test.describe('THE OVERSEER', () => {
  test.describe.configure({ timeout: 300_000 });

  /**
   * The PlatformBot fights it stomp-only (no abilities), invulnerable, for every character:
   * it must stomp the open core in all three phases. Boss states are recorded through a
   * setAI hook so the test also proves each phase's signature attack ran.
   */
  test('is defeated by stomps alone by every character; all three phases and their attacks are seen', async ({ page }) => {
    const log = trackConsole(page);
    await openGame(page);
    await setSave(page, { ...W1_DONE, unlockedCharacters: ['grandma'] });
    const results: string[] = [];
    for (const character of CHARACTERS) {
      const res = await page.evaluate(async (ch) => {
        type B = { bossName?: string; aiState: string; phase: number; setAI(s: string): unknown };
        const h = window.__harness!;
        await h.startLevel('north-4', ch as never, { manual: true });
        const lv = (window as unknown as { __level: { ctx: { groups: { enemies: { getChildren(): unknown[] } } } } }).__level;
        const b0 = lv.ctx.groups.enemies.getChildren().find((e) => (e as B).bossName) as B;
        // Patch the Enemy prototype once (persists across level restarts).
        let proto = Object.getPrototypeOf(b0);
        while (proto && !Object.prototype.hasOwnProperty.call(proto, 'setAI')) proto = Object.getPrototypeOf(proto);
        const w = window as unknown as { __ovStates?: Set<string>; __ovPatched?: boolean };
        w.__ovStates = new Set();
        if (!w.__ovPatched) {
          w.__ovPatched = true;
          const orig = proto.setAI;
          proto.setAI = function (this: B, s: string) {
            if (this.bossName === 'The Overseer') w.__ovStates!.add(`${this.phase}:${s}`);
            return orig.call(this, s);
          };
        }
        const r = await h.bot({ levelId: 'north-4', character: ch as never, invulnerable: true, maxFrames: 60 * 300 });
        return { completed: r.completed, sim: r.simSeconds, states: [...w.__ovStates] };
      }, character);
      results.push(`${character}: ${res.completed ? 'beaten' : 'NOT beaten'} in ${res.sim.toFixed(1)} s`);
      expect(res.completed, `${character}: ${JSON.stringify(res)}`).toBe(true);
      for (const st of ['1:beamSweep', '1:vulnerable', '2:slamFall', '2:vulnerable', '3:laserSpin', '3:vulnerable']) expect(res.states, character).toContain(st);
    }
    console.log(`[overseer] ${results.join(' · ')}`);
    expect(log.errors, log.errors.join('\n')).toEqual([]);
  });
});
