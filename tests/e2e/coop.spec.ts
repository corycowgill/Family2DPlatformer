import { test, expect, type Page } from '@playwright/test';
import { getState, harness, openGame, setInput, startLevel, stepFrames, trackConsole, waitForScene } from './helpers';
import type { CoopState } from '../../src/game/debug/TestHarness';

/**
 * Local 2-player co-op (drop-in / drop-out). Most checks run in the harness's deterministic
 * manual mode on the `test` level: P2 is added with `joinP2` and driven with `setInputP2`.
 * One test drives the real keyboard join (U), picker and IJKL controls in real time.
 */

const coop = (page: Page) => harness(page, (h) => h.coopState()) as Promise<CoopState>;
const setInputP2 = (page: Page, input: Record<string, boolean> | null) => harness(page, (h, a) => h.setInputP2(a), input);

test.describe('local co-op', () => {
  test('P2 joins, both move independently, P2 respawns at P1, level completes', async ({ page }) => {
    const log = trackConsole(page);
    await openGame(page);
    await startLevel(page, 'test', 'dad', { manual: true });
    await stepFrames(page, 10);
    const lives0 = (await getState(page)).lives;

    // ── join ──
    const joined = await harness(page, (h) => h.joinP2('mom'));
    expect(joined.active).toBe(true);
    expect(joined.players).toBe(2);
    expect(joined.p2!.character).toBe('mom');
    expect(Math.abs(joined.p2!.x - joined.p1!.x)).toBeLessThan(32);
    // P2 can't be P1's hero.
    await expect(harness(page, (h) => h.joinP2('dad'))).rejects.toThrow();
    await stepFrames(page, 20);
    let c = await coop(page);
    expect(c.active).toBe(true);
    expect(c.p2!.grounded).toBe(true);
    // HUD shows the P2 panel.
    expect(await harness(page, (h) => h.sceneTexts('HUD'))).toContain('P2');

    // ── independent movement ──
    const a0 = await coop(page);
    await setInput(page, { right: true });
    await stepFrames(page, 30);
    await setInput(page, null);
    await stepFrames(page, 30); // P1 slides to a stop
    const a1 = await coop(page);
    expect(a1.p1!.x - a0.p1!.x).toBeGreaterThan(20);
    expect(Math.abs(a1.p2!.x - a0.p2!.x)).toBeLessThan(2);

    await setInputP2(page, { right: true });
    await stepFrames(page, 45);
    await setInputP2(page, null);
    await stepFrames(page, 20);
    const a2 = await coop(page);
    expect(a2.p2!.x - a1.p2!.x).toBeGreaterThan(30);
    expect(Math.abs(a2.p1!.x - a1.p1!.x)).toBeLessThan(2);

    // P2 jumps while P1 stays on the ground.
    await setInputP2(page, { jump: true });
    await stepFrames(page, 12);
    const a3 = await coop(page);
    await setInputP2(page, null);
    expect(a3.p2!.y).toBeLessThan(a2.p2!.y - 10);
    expect(a3.p1!.grounded).toBe(true);
    await stepFrames(page, 60);

    // ── camera frames the midpoint of both players ──
    await harness(page, (h) => h.teleportP2(h.coopState().p1!.x + 200, 230));
    await stepFrames(page, 90);
    c = await coop(page);
    const mid = (c.p1!.x + c.p2!.x) / 2;
    expect(Math.abs(c.camera.x - mid)).toBeLessThan(40);
    expect(c.p1!.x).toBeGreaterThan(c.camera.left);
    expect(c.p2!.x).toBeLessThan(c.camera.right);

    // ── P2 dies → respawns next to P1, no life lost ──
    await harness(page, (h) => h.killP2());
    await stepFrames(page, 2);
    c = await coop(page);
    expect(c.p2!.mode).toBe('dead');
    expect((await getState(page)).lives).toBe(lives0);
    await stepFrames(page, 110); // RESPAWN_DELAY_MS = 1.5 s
    c = await coop(page);
    expect(c.p2!.mode).not.toBe('dead');
    expect(c.p2!.health).toBeGreaterThan(0);
    expect(Math.abs(c.p2!.x - c.p1!.x)).toBeLessThan(40);
    expect((await getState(page)).lives).toBe(lives0);
    expect(await harness(page, (h) => h.scenes())).toContain('Level');

    // ── P1 dies while P2 stands → P1 comes back next to P2, still no life lost ──
    await harness(page, (h) => h.killPlayer());
    await stepFrames(page, 110);
    c = await coop(page);
    expect(c.p1!.mode).not.toBe('dead');
    expect(Math.abs(c.p1!.x - c.p2!.x)).toBeLessThan(40);
    expect((await getState(page)).lives).toBe(lives0);

    // ── leash: a player left far behind warps to the partner ──
    const warps0 = c.warps;
    await harness(page, (h) => h.teleportP2(h.coopState().p1!.x + 700, 200));
    await stepFrames(page, 120);
    c = await coop(page);
    expect(c.warps).toBeGreaterThan(warps0);
    expect(Math.abs(c.p2!.x - c.p1!.x)).toBeLessThan(60);

    // ── P2 stomps an enemy ──
    await stepFrames(page, 30);
    c = await coop(page);
    const enemies0 = (await getState(page)).enemies;
    const ex = c.p2!.x + 120;
    await harness(page, (h, a) => h.spawnEnemy('rat', a.x, 240), { x: ex });
    expect((await getState(page)).enemies).toBe(enemies0 + 1);
    await harness(page, (h, a) => h.teleportP2(a.x, 190), { x: ex });
    await stepFrames(page, 40);
    expect((await getState(page)).enemies).toBe(enemies0);
    expect((await coop(page)).p2!.mode).not.toBe('dead');

    // ── P2 reaches the goal → level complete ──
    const goal = (await harness(page, (h) => h.goal()))!;
    expect(goal).not.toBeNull();
    await harness(page, (h, g) => h.teleportP2(g.x - 6, g.y - 2), goal);
    await stepFrames(page, 20);
    expect((await getState(page)).finished).toBe(true);
    c = await coop(page);
    expect(c.p1!.mode).toBe('victory');
    expect(c.p2!.mode).toBe('victory');
    await harness(page, (h) => h.setManual(false));
    await waitForScene(page, 'Results', 20_000);
    expect(log.errors, log.errors.join('\n')).toEqual([]);
  });

  test('both players down costs one life; P2 is still there after the restart; P2 can leave', async ({ page }) => {
    await openGame(page);
    await startLevel(page, 'test', 'parker', { manual: true });
    await stepFrames(page, 10);
    const lives0 = (await getState(page)).lives;
    await harness(page, (h) => h.joinP2('lupin'));
    await stepFrames(page, 10);
    await harness(page, (h) => h.killP2());
    await stepFrames(page, 5);
    await harness(page, (h) => h.killPlayer());
    // The restart is a scene transition: stepFrames waits for it.
    await stepFrames(page, 120);
    await stepFrames(page, 10);
    const s = await getState(page);
    expect(s.lives).toBe(lives0 - 1);
    expect(s.mode).not.toBe('dead');
    const c = await coop(page);
    expect(c.active).toBe(true);
    expect(c.p2!.character).toBe('lupin');
    expect(c.p2!.mode).not.toBe('dead');

    const left = await harness(page, (h) => h.leaveP2());
    expect(left.active).toBe(false);
    expect(left.players).toBe(1);
    await stepFrames(page, 10);
    expect((await getState(page)).p2).toBeNull();
    // Single player again: a death costs a life as usual.
    await harness(page, (h) => h.killPlayer());
    await stepFrames(page, 120);
    expect((await getState(page)).lives).toBe(lives0 - 2);
  });

  test('keyboard drop-in: U joins, picker skips P1’s hero, IJKL drives P2, Backspace leaves', async ({ page }) => {
    const log = trackConsole(page);
    await openGame(page);
    await startLevel(page, 'test', 'dad');
    await page.waitForTimeout(500);

    await page.keyboard.down('u');
    await page.waitForFunction(() => window.__harness!.coopState().picking, undefined, { timeout: 10_000 });
    await page.keyboard.up('u');
    // Cycle the picker right then left: never lands on P1's hero.
    await page.keyboard.down('l');
    await page.waitForTimeout(150);
    await page.keyboard.up('l');
    await page.waitForTimeout(150);
    await page.keyboard.down('u');
    await page.waitForFunction(() => window.__harness!.coopState().active, undefined, { timeout: 10_000 });
    await page.keyboard.up('u');
    let c = await coop(page);
    expect(c.p2!.character).not.toBe('dad');
    expect(c.p2!.character).toBe('brennan'); // dad → (mom) → brennan
    await page.waitForTimeout(400);

    // IJKL: hold L → P2 runs right, P1 stays.
    c = await coop(page);
    await page.keyboard.down('l');
    await page.waitForFunction((x) => window.__harness!.coopState().p2!.x > x + 30, c.p2!.x, { timeout: 10_000 });
    await page.keyboard.up('l');
    const c2 = await coop(page);
    expect(Math.abs(c2.p1!.x - c.p1!.x)).toBeLessThan(2);
    // Arrow keys still drive P1 only.
    await page.keyboard.down('ArrowRight');
    await page.waitForFunction((x) => window.__harness!.coopState().p1!.x > x + 30, c2.p1!.x, { timeout: 10_000 });
    await page.keyboard.up('ArrowRight');

    await page.keyboard.down('Backspace');
    await page.waitForFunction(() => !window.__harness!.coopState().active, undefined, { timeout: 10_000 });
    await page.keyboard.up('Backspace');
    expect((await coop(page)).players).toBe(1);
    expect(log.errors, log.errors.join('\n')).toEqual([]);
  });
});
