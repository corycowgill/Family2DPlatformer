import { test, expect } from '@playwright/test';
import { getState, harness, openGame, startLevel } from './helpers';

test.describe('test harness', () => {
  test.beforeEach(async ({ page }) => {
    await openGame(page);
  });

  test('stepFrames is deterministic: same input script → identical trajectory', async ({ page }) => {
    // Run B sleeps between some frames: wall-clock time must not leak into the simulation.
    const run = (jitter: boolean) =>
      harness(page, async (h, jit) => {
        await h.startLevel('test', 'dad', { manual: true, seed: 7 });
        // Input script: [frames, input]
        const script: [number, Record<string, boolean>][] = [
          [20, {}],
          [40, { right: true }],
          [25, { right: true, run: true, jump: true }],
          [30, { right: true, run: true }],
          [10, { left: true }],
          [20, { right: true, jump: true }],
          [60, { right: true, run: true }],
          [30, { right: true, run: true, jump: true }],
          [80, { right: true, run: true }],
        ];
        const trace: number[][] = [];
        for (const [n, input] of script) {
          h.setInput(input);
          for (let i = 0; i < n; i++) {
            await h.stepFrames(1);
            if (jit && i % 9 === 0) await new Promise((r) => setTimeout(r, 25));
            const s = h.getState();
            trace.push([s.x, s.y, s.vx, s.vy, s.grounded ? 1 : 0, s.health, s.levelTimeMs]);
          }
        }
        // Enemy positions too (they move independently of the player).
        const lv = h.level()!;
        const enemies = lv.ctx.groups.enemies.getChildren().map((e) => [(e as unknown as { x: number }).x, (e as unknown as { y: number }).y]);
        return { trace, enemies };
      }, jitter);
    const a = await run(false);
    const b = await run(true);
    expect(a.trace.length).toBe(315);
    expect(a.trace[a.trace.length - 1][0]).toBeGreaterThan(200); // actually went somewhere
    expect(b.trace).toEqual(a.trace);
    expect(b.enemies).toEqual(a.enemies);
  });

  test('manual mode freezes the simulation between steps', async ({ page }) => {
    await startLevel(page, 'test', 'dad', { manual: true });
    await harness(page, (h) => {
      h.setInput({ right: true });
      return h.stepFrames(30);
    });
    const a = await getState(page);
    await page.waitForTimeout(500);
    const b = await getState(page);
    expect(b.x).toBe(a.x);
    expect(b.levelTimeMs).toBe(a.levelTimeMs);
    expect(a.frame).toBe(30);
    expect(a.levelTimeMs).toBeCloseTo(500, 0);
  });

  test('real-time setInput moves the player', async ({ page }) => {
    const s0 = await startLevel(page, 'test', 'dad');
    await page.waitForTimeout(300);
    await harness(page, (h) => h.setInput({ right: true }));
    // Wall-clock independent: a loaded machine renders fewer frames per second.
    await page.waitForFunction((x) => window.__harness!.getState().x > x + 30, s0.x, { timeout: 15_000 });
    await harness(page, (h) => h.setInput(null));
  });

  test('teleport, checkpoints, goal and invulnerability', async ({ page }) => {
    await startLevel(page, 'test', 'dad', { manual: true });
    const cps = await harness(page, (h) => h.checkpoints());
    expect(cps.length).toBeGreaterThan(0);
    await harness(page, (h) => {
      h.teleportToCheckpoint(0);
      return h.stepFrames(5);
    });
    let s = await getState(page);
    expect(Math.abs(s.x - cps[0].x)).toBeLessThan(2);
    expect(s.checkpoint).toBe(0);

    // Invulnerable player survives an enemy dropped on top of it.
    await harness(page, (h) => {
      h.setInvulnerable(true);
      const st = h.getState();
      h.spawnEnemy('rat', st.x + 4, st.y);
      return h.stepFrames(60);
    });
    s = await getState(page);
    expect(s.health).toBe(3);

    // Without invulnerability, contact hurts.
    await harness(page, (h) => {
      h.setInvulnerable(false);
      const st = h.getState();
      h.spawnEnemy('rat', st.x + 20, st.y);
      h.spawnEnemy('rat', st.x - 20, st.y);
      return h.stepFrames(90);
    });
    s = await getState(page);
    expect(s.health).toBeLessThan(3);

    const goal = await harness(page, (h) => h.goal());
    expect(goal).not.toBeNull();
    await harness(page, (h, g) => {
      h.teleport(g!.x - 30, g!.y - 1);
      h.setInput({ right: true });
      return h.stepFrames(60);
    }, goal);
    s = await getState(page);
    expect(s.finished).toBe(true);
  });

  test('spawnEnemy goes through the spawner registry', async ({ page }) => {
    const s0 = await startLevel(page, 'test', 'dad', { manual: true });
    const n = await harness(page, (h) => h.spawnEnemy('rat', 200, 230));
    expect(n).toBe(s0.enemies + 1);
  });

  test('pits kill; death restarts the level with one life fewer (manual stepping)', async ({ page }) => {
    const s0 = await startLevel(page, 'test', 'dad', { manual: true });
    await harness(page, (h) => {
      // Column 32 of test.json is a pit.
      h.teleport(32 * 16 + 8, 200);
      return h.stepFrames(30);
    });
    const dead = await getState(page);
    expect(dead.mode).toBe('dead');
    expect(dead.lives).toBe(s0.lives - 1);
    // 1.2 s death delay + fade, then scene restart.
    await harness(page, (h) => h.stepFrames(150));
    const after = await getState(page);
    expect(after.mode).toBe('normal');
    expect(after.lives).toBe(s0.lives - 1);
    expect(after.x).toBeLessThan(100);
  });

  test('revive cancels a pending restart', async ({ page }) => {
    const s0 = await startLevel(page, 'test', 'dad', { manual: true });
    await harness(page, async (h) => {
      h.killPlayer();
      await h.stepFrames(2);
      h.revive(100, 200);
      return h.stepFrames(200);
    });
    const s = await getState(page);
    expect(s.mode).toBe('normal');
    expect(s.lives).toBe(s0.lives);
    expect(s.frame).toBeGreaterThan(150); // scene was not restarted
  });
});
