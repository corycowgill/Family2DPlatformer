import { test, expect } from '@playwright/test';
import { harness, openGame, startLevel, warn } from './helpers';

test.describe('performance & memory', () => {
  test('frame rate over 5 s of play in the test level (report only)', async ({ page }, testInfo) => {
    await openGame(page);
    await startLevel(page, 'test', 'dad');
    await harness(page, (h) => h.setInvulnerable(true));
    // Scripted play: run right, jump every ~0.6 s, bounce back at the end.
    await page.evaluate(() => {
      const h = window.__harness!;
      let t = 0;
      let dir = 1;
      const id = setInterval(() => {
        t++;
        const s = h.getState();
        if (s.x > 1350) dir = -1;
        if (s.x < 100) dir = 1;
        h.setInput({ right: dir > 0, left: dir < 0, run: true, jump: t % 6 < 3 });
      }, 100);
      (window as unknown as { __perfTimer: number }).__perfTimer = id as unknown as number;
    });
    const fps = await harness(page, (h) => h.measureFps(5000));
    await page.evaluate(() => clearInterval((window as unknown as { __perfTimer: number }).__perfTimer));
    const msg = `avg ${fps.avgFps.toFixed(1)} fps, avg frame ${fps.avgFrameMs.toFixed(2)} ms, p95 ${fps.p95FrameMs.toFixed(2)} ms, worst ${fps.worstFrameMs.toFixed(1)} ms over ${fps.frames} frames (Phaser loop ${fps.loopFps.toFixed(1)})`;
    console.log(`[perf] ${testInfo.project.name}: ${msg}`);
    testInfo.annotations.push({ type: 'perf', description: msg });
    await testInfo.attach('fps.json', { body: JSON.stringify(fps, null, 2), contentType: 'application/json' });
    if (fps.avgFps < 50) warn(testInfo, `average FPS below 50 (${fps.avgFps.toFixed(1)}) — expected on software GL in CI`);
    expect(fps.frames).toBeGreaterThan(0);
  });

  test('no leaks across 10 level restarts', async ({ page }, testInfo) => {
    await openGame(page);
    const samples = [];
    for (let i = 0; i < 11; i++) {
      await startLevel(page, 'test', i % 2 ? 'lupin' : 'dad', { manual: true });
      await harness(page, async (h) => {
        h.setInput({ right: true, run: true, jump: true });
        await h.stepFrames(90);
        h.setInput(null);
      });
      // Let real frames render / GC a bit.
      await page.waitForTimeout(100);
      samples.push(await harness(page, (h) => h.stats()));
    }
    // Sample 0 warms caches (map JSON, animations); compare restarts 1..10.
    const steady = samples.slice(1);
    const rng = (k: keyof (typeof samples)[0]) => {
      const v = steady.map((s) => s[k] as number);
      return Math.max(...v) - Math.min(...v);
    };
    await testInfo.attach('restart-stats.json', { body: JSON.stringify(samples, null, 2), contentType: 'application/json' });
    console.log('[mem]', JSON.stringify(steady.map((s) => [s.textures, s.levelChildren, s.bodies, s.levelListeners, s.gameListeners, s.heapBytes])));
    expect(rng('textures'), 'texture count grows across restarts').toBe(0);
    expect(rng('levelListeners'), 'level event listeners grow across restarts').toBe(0);
    expect(rng('gameListeners'), 'game event listeners grow across restarts').toBe(0);
    // Children/bodies depend on transient effects, allow a small band.
    expect(rng('levelChildren'), 'level display list grows across restarts').toBeLessThanOrEqual(12);
    expect(rng('bodies'), 'physics bodies grow across restarts').toBeLessThanOrEqual(4);
    const heap = steady.map((s) => s.heapBytes).filter((n): n is number => n !== null);
    if (heap.length > 2) {
      const growthMb = (heap[heap.length - 1] - heap[0]) / 1e6;
      testInfo.annotations.push({ type: 'heap', description: `JS heap growth over 9 restarts: ${growthMb.toFixed(1)} MB` });
      if (growthMb > 15) warn(testInfo, `JS heap grew ${growthMb.toFixed(1)} MB over 9 restarts`);
      expect(growthMb).toBeLessThan(60);
    }
  });
});
