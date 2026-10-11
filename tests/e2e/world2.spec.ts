import { test, expect, type Page } from '@playwright/test';
import { CHARACTERS, harness, openGame, startLevel, trackConsole, waitForScene } from './helpers';

/**
 * World 2 "The North Side": progression from World 1, world map region, the World 2 story
 * beat, the World 1 → World 2 hand-off in the ending, the World 2 ending, and THE OVERSEER
 * boss being beatable with stomps alone by every character (scripted, deterministic).
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

  test('every placeholder level loads and runs without errors', async ({ page }) => {
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
   * Scripted stomp-only run (manual stepping, seeded): dodge to the safe side during the
   * telegraphs, jump shockwaves, and hop onto the core whenever it is open. No abilities.
   * Invulnerable so the test checks the fight's progression (every window can be stomped),
   * not the script's dodging.
   */
  for (const character of CHARACTERS) {
    test(`can be defeated with stomps alone as ${character}`, async ({ page }) => {
      const log = trackConsole(page);
      await openGame(page);
      await setSave(page, { ...W1_DONE, unlockedCharacters: ['grandma'] });
      await startLevel(page, 'north-4', character, { manual: true, seed: 7 });
      await harness(page, (h) => h.setInvulnerable(true));
      const res = await page.evaluate(async () => {
        type B = {
          bossName: string; dead: boolean; started: boolean; aiState: string; stateTime: number; vulnerable: boolean; x: number; hp: number; phase: number;
          arena: { x: number; right: number; width: number; bottom: number }; corePos: { x: number; y: number };
          plan?: { zoneMin: number }; slamX: number; laserZone: number; attacks: number;
        };
        const h = window.__harness!;
        const L = (window as unknown as { __level: { player: { x: number; grounded: boolean; body: { velocity: { x: number } } }; ctx: { groups: { enemies: { getChildren(): unknown[] }; enemyProjectiles: { getChildren(): unknown[] } } } } }).__level;
        const boss = () => L.ctx.groups.enemies.getChildren().find((e) => (e as B).bossName) as B | undefined;
        const b0 = boss()!;
        h.teleport(b0.arena.x - 16, b0.arena.bottom - 1);
        const states = new Set<string>();
        let hold = 0;
        let frames = 0;
        let stompsOffered = 0;
        while (frames < 60 * 240) {
          const b = boss();
          if (!b || b.dead) break;
          const p = L.player;
          const a = b.arena;
          const mid = a.x + a.width / 2;
          const s = b.aiState;
          states.add(`${b.phase}:${s}`);
          let tx: number;
          if (!b.started || s === 'intro') tx = a.x + 80;
          else if (b.vulnerable) tx = b.corePos.x;
          else if (s === 'beamWarn' || s === 'beamSweep') tx = b.plan!.zoneMin <= a.x + 1 ? mid + 70 : mid - 70;
          else if (s.startsWith('slam')) {
            const sx = s === 'slamTrack' ? b.x : b.slamX;
            tx = sx < mid ? sx + 110 : sx - 110;
          } else if (s.startsWith('laser')) tx = p.x < b.x ? b.x - b.laserZone - 40 : b.x + b.laserZone + 40;
          else tx = b.x + (p.x < b.x ? -100 : 100);
          tx = Math.max(a.x + 12, Math.min(a.right - 12, tx));
          const dx = tx - p.x;
          const input: Record<string, boolean> = {};
          if (Math.abs(dx) > 4) input[dx > 0 ? 'right' : 'left'] = true;
          const waves = L.ctx.groups.enemyProjectiles.getChildren() as { x: number; opts?: { style?: string }; body: { velocity: { x: number } } }[];
          const danger = waves.some((w) => w.opts?.style === 'shockwave' && Math.abs(w.x - p.x) < 34 && Math.sign(w.body.velocity.x) === Math.sign(p.x - w.x));
          if (hold > 0) {
            input.jump = true;
            hold--;
          } else if (p.grounded && (danger || (b.vulnerable && Math.abs(b.corePos.x - p.x) < 18 && b.stateTime > 150))) {
            input.jump = true;
            hold = danger ? 14 : 6;
            if (!danger) stompsOffered++;
          }
          h.setInput(input);
          await h.stepFrames(1);
          frames++;
        }
        h.setInput(null);
        const b = boss();
        return { frames, defeated: !b || b.dead, hp: b?.hp ?? 0, states: [...states], stompsOffered };
      });
      expect(res.defeated, JSON.stringify(res)).toBe(true);
      // All three phases were fought, with each phase's signature attack.
      for (const st of ['1:beamSweep', '2:slamFall', '3:laserSpin', '1:vulnerable', '2:vulnerable', '3:vulnerable']) expect(res.states).toContain(st);
      // Defeat → BOSS_DEFEATED → level complete → Results.
      await harness(page, (h) => h.stepFrames(60 * 6));
      await waitForScene(page, 'Results', 15_000);
      expect(log.errors, log.errors.join('\n')).toEqual([]);
    });
  }
});
