import { test, expect, type Page } from '@playwright/test';
import { getState, harness, openGame, startLevel, trackConsole, waitForScene } from './helpers';

/**
 * Xbox controller support, driven by a fake standard-mapping pad: `navigator.getGamepads()`
 * is stubbed before the game loads and returns a mutable pad object; the game polls it
 * every frame (systems/Gamepads.ts via ui/PadOverlay.ts).
 */

declare global {
  interface Window {
    __pad: {
      connected: boolean;
      pad: { buttons: { pressed: boolean; touched: boolean; value: number }[]; axes: number[]; timestamp: number };
    };
    __rumbles: unknown[];
  }
}

async function installFakePad(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const pad = {
      id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)',
      index: 0,
      connected: true,
      mapping: 'standard',
      timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
      hapticActuators: [],
      vibrationActuator: {
        type: 'dual-rumble',
        effects: ['dual-rumble'],
        playEffect: (type: string, params: object) => {
          window.__rumbles.push([type, params]);
          return Promise.resolve('complete');
        },
        reset: () => Promise.resolve('complete'),
      },
    };
    window.__rumbles = [];
    window.__pad = { connected: false, pad };
    Object.defineProperty(Navigator.prototype, 'getGamepads', {
      configurable: true,
      value: () => [window.__pad.connected ? pad : null, null, null, null],
    });
  });
}

const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as const;

async function connect(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__pad.connected = true;
    const e = new Event('gamepadconnected');
    Object.defineProperty(e, 'gamepad', { value: window.__pad.pad });
    window.dispatchEvent(e);
  });
  await page.waitForTimeout(80);
}

async function disconnect(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__pad.connected = false;
    const e = new Event('gamepaddisconnected');
    Object.defineProperty(e, 'gamepad', { value: window.__pad.pad });
    window.dispatchEvent(e);
  });
}

async function setButton(page: Page, i: number, value: number): Promise<void> {
  await page.evaluate(([i, v]) => {
    const b = window.__pad.pad.buttons[i];
    b.value = v;
    b.pressed = v > 0.5;
    b.touched = v > 0;
    window.__pad.pad.timestamp++;
  }, [i, value] as const);
}

/** Wait for `n` rendered frames (the game polls pads once per frame) — robust under CPU load. */
function frames(page: Page, n = 4): Promise<void> {
  return page.evaluate(
    (n) =>
      new Promise<void>((resolve) => {
        let k = 0;
        const f = () => (++k >= n ? resolve() : requestAnimationFrame(f));
        requestAnimationFrame(f);
      }),
    n,
  );
}

/**
 * Press and release a button inside the page, counted in rendered frames: the hold must not
 * stretch with Playwright round-trip latency under load (a long hold auto-repeats d-pad nav).
 */
async function tap(page: Page, i: number, holdFrames = 3): Promise<void> {
  await page.evaluate(
    ([i, n]) =>
      new Promise<void>((resolve) => {
        const b = window.__pad.pad.buttons[i];
        const set = (v: number) => {
          b.value = v;
          b.pressed = v > 0.5;
          b.touched = v > 0;
          window.__pad.pad.timestamp++;
        };
        set(1);
        let k = 0;
        const f = () => {
          k++;
          if (k === n) set(0);
          if (k >= n + 3) resolve();
          else requestAnimationFrame(f);
        };
        requestAnimationFrame(f);
      }),
    [i, holdFrames] as const,
  );
}

async function stick(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(([x, y]) => {
    window.__pad.pad.axes[0] = x;
    window.__pad.pad.axes[1] = y;
    window.__pad.pad.timestamp++;
  }, [x, y] as const);
}

/** Push the left stick for a few frames and let go (in-page, like `tap`). */
async function flick(page: Page, x: number, y: number, holdFrames = 3): Promise<void> {
  await page.evaluate(
    ([x, y, n]) =>
      new Promise<void>((resolve) => {
        const a = window.__pad.pad.axes;
        a[0] = x;
        a[1] = y;
        let k = 0;
        const f = () => {
          k++;
          if (k === n) a[0] = a[1] = 0;
          if (k >= n + 3) resolve();
          else requestAnimationFrame(f);
        };
        requestAnimationFrame(f);
      }),
    [x, y, holdFrames] as const,
  );
}

/** Glyph ids of the prompts currently shown in a scene. */
function glyphs(page: Page, sceneKey: string): Promise<string[]> {
  return harness(page, (h, key) => {
    const out: string[] = [];
    const walk = (list: Phaser.GameObjects.GameObject[]) => {
      for (const o of list) {
        const g = o.getData?.('glyph') as string | undefined;
        if (g) out.push(g);
        const children = (o as Phaser.GameObjects.Container).list;
        if (Array.isArray(children) && (o as Phaser.GameObjects.Container).visible !== false) walk(children);
      }
    };
    walk(h.game.scene.getScene(key).children.list);
    return out;
  }, sceneKey);
}

function toast(page: Page): Promise<string | null> {
  return harness(page, (h) => {
    const s = h.game.scene.getScene('PadOverlay');
    if (!s || !s.sys.isActive()) return null;
    const c = s.children.getByName('pad-toast');
    return c ? (c.getData('text') as string) : null;
  });
}

const canvasPadClass = (page: Page) => page.evaluate(() => document.querySelector('canvas')!.classList.contains('pad-active'));

test.beforeEach(async ({ page }) => {
  await installFakePad(page);
});

test.describe('Xbox controller', () => {
  test('menu → character select → world map → level using only the pad; A held from the map does not jump', async ({ page }, testInfo) => {
    const log = trackConsole(page);
    await openGame(page);
    const aliased = await harness(page, (h) => h.aliasMissingLevels());
    if (aliased.length) testInfo.annotations.push({ type: 'info', description: `maps missing, using test.json for: ${aliased.join(', ')}` });
    await waitForScene(page, 'Menu');
    // Keyboard prompts until the pad is used.
    expect(await glyphs(page, 'Menu')).toEqual(expect.arrayContaining(['key:SPACE', 'key:SHIFT', 'key:J']));

    await connect(page);
    await expect.poll(() => toast(page)).toBe('CONTROLLER CONNECTED');
    await tap(page, BTN.DOWN); // first use → prompts switch to Xbox glyphs
    await expect.poll(() => glyphs(page, 'Menu')).toEqual(expect.arrayContaining(['pad:LS', 'pad:A', 'pad:RT', 'pad:X']));
    expect(await canvasPadClass(page)).toBe(true); // mouse cursor hidden
    await tap(page, BTN.UP);
    await tap(page, BTN.A); // PLAY
    await waitForScene(page, 'CharacterSelect');
    expect(await glyphs(page, 'CharacterSelect')).toEqual(expect.arrayContaining(['pad:DPAD', 'pad:A', 'pad:B']));
    await page.waitForTimeout(400); // wipe-in
    await flick(page, 0.9, 0.05); // dad → mom with the stick
    await tap(page, BTN.A);
    await waitForScene(page, 'WorldMap');
    await page.waitForTimeout(400);
    expect(await glyphs(page, 'WorldMap')).toEqual(expect.arrayContaining(['pad:A', 'pad:Y']));

    // Confirm the level and keep holding A through the transition.
    await setButton(page, BTN.A, 1);
    await waitForScene(page, 'Level');
    await waitForScene(page, 'HUD');
    await page.waitForFunction(() => window.__harness!.getState().grounded, undefined, { timeout: 10_000 });
    const s0 = await getState(page);
    expect(s0.levelId).toBe('loop-1');
    expect(s0.character, "stick right on character select picks Mom").toBe("mom");
    await page.waitForTimeout(600);
    const s1 = await getState(page);
    expect(s1.y, 'held A from the map must not jump on spawn').toBeCloseTo(s0.y, 0);
    expect(s1.grounded).toBe(true);
    // Release and press again: now it jumps.
    await setButton(page, BTN.A, 0);
    await page.waitForTimeout(100);
    await setButton(page, BTN.A, 1);
    await page.waitForFunction((y) => window.__harness!.getState().y < y - 8, s1.y, { timeout: 5_000 });
    await setButton(page, BTN.A, 0);
    expect(await glyphs(page, 'HUD')).toContain('pad:X');
    expect(log.errors, log.errors.join('\n')).toEqual([]);
  });

  test('gameplay: stick moves, run + jump together, X uses the ability, Menu pauses / B resumes, View pauses', async ({ page }) => {
    await openGame(page);
    await startLevel(page, 'test', 'parker');
    await page.evaluate(() => {
      (window as unknown as { __abilities: number }).__abilities = 0;
      window.__level!.events.on('ability-used', () => (window as unknown as { __abilities: number }).__abilities++);
    });
    await connect(page);
    await page.waitForTimeout(300);
    const s0 = await getState(page);
    await stick(page, 1, 0);
    await page.waitForFunction((x) => window.__harness!.getState().x > x + 30, s0.x, { timeout: 10_000 });
    // Hold RT (analog, half-pulled) to run while jumping.
    await setButton(page, BTN.RT, 0.6);
    await page.waitForTimeout(300);
    const s1 = await getState(page);
    await tap(page, BTN.A, 8);
    await page.waitForFunction((y) => window.__harness!.getState().y < y - 8, s1.y, { timeout: 5_000 });
    await setButton(page, BTN.RT, 0);
    await stick(page, 0, 0);
    await page.waitForFunction(() => window.__harness!.getState().grounded, undefined, { timeout: 5_000 });

    // Down-diagonal noise while moving does not crouch; a clear push down does.
    await stick(page, 0.85, 0.45);
    await page.waitForTimeout(250);
    expect((await getState(page)).mode).not.toBe('crouch');
    await stick(page, 0, 0);
    await page.waitForTimeout(150);

    await tap(page, BTN.X);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __abilities: number }).__abilities)).toBeGreaterThan(0);

    await tap(page, BTN.MENU);
    await waitForScene(page, 'Pause');
    expect(await glyphs(page, 'Pause')).toEqual(expect.arrayContaining(['pad:A', 'pad:B']));
    const frozen = await getState(page);
    await page.waitForTimeout(300);
    expect((await getState(page)).levelTimeMs).toBe(frozen.levelTimeMs);
    await tap(page, BTN.B);
    await page.waitForFunction(() => window.__harness!.isActive('Level') && !window.__harness!.isActive('Pause'));
    await page.waitForTimeout(250);
    expect(await harness(page, (h) => h.isActive('Pause')), 'the B that resumed must not re-pause').toBe(false);

    await tap(page, BTN.VIEW);
    await waitForScene(page, 'Pause');
    await page.waitForTimeout(200);
    await tap(page, BTN.MENU); // Menu toggles the pause off again
    await page.waitForFunction(() => window.__harness!.isActive('Level') && !window.__harness!.isActive('Pause'));
    await page.waitForTimeout(250);
    expect(await harness(page, (h) => h.isActive('Pause'))).toBe(false);
  });

  test('disconnecting the controller mid-level pauses with a toast', async ({ page }) => {
    await openGame(page);
    await startLevel(page, 'test', 'dad');
    await connect(page);
    await tap(page, BTN.A);
    await page.waitForTimeout(200);
    expect(await harness(page, (h) => h.isActive('Pause'))).toBe(false);
    await disconnect(page);
    await waitForScene(page, 'Pause');
    await expect.poll(() => toast(page)).toBe('CONTROLLER DISCONNECTED');
    // With no pad left, prompts fall back to the keyboard.
    await expect.poll(() => glyphs(page, 'Pause')).toEqual(expect.arrayContaining(['key:ENTER', 'key:ESC']));
  });

  test('pause → settings → controls screen and back out, all on the pad', async ({ page }) => {
    await openGame(page);
    await startLevel(page, 'test', 'dad');
    await connect(page);
    await tap(page, BTN.MENU);
    await waitForScene(page, 'Pause');
    await page.waitForTimeout(200);
    await tap(page, BTN.DOWN);
    await tap(page, BTN.DOWN); // RESUME, RESTART LEVEL, SETTINGS
    await tap(page, BTN.A);
    await waitForScene(page, 'Settings');
    await page.waitForTimeout(200);
    await tap(page, BTN.UP); // wrap to BACK
    await tap(page, BTN.UP); // CONTROLS
    await tap(page, BTN.A);
    await waitForScene(page, 'Controls');
    const g = await glyphs(page, 'Controls');
    expect(g).toEqual(expect.arrayContaining(['pad:A', 'pad:X', 'pad:RT', 'pad:MENU', 'pad:VIEW', 'key:SPACE', 'key:SHIFT', 'key:J']));
    expect((await harness(page, (h) => h.sceneTexts('Controls'))).join(' ')).toContain('CONTROLLER CONNECTED');
    await tap(page, BTN.B);
    await page.waitForFunction(() => !window.__harness!.isActive('Controls') && window.__harness!.isActive('Settings'));
    await page.waitForTimeout(250);
    expect(await harness(page, (h) => h.isActive('Settings')), 'the B that closed Controls must not also close Settings').toBe(true);
    await tap(page, BTN.B);
    await page.waitForFunction(() => !window.__harness!.isActive('Settings') && window.__harness!.isActive('Pause'));
    await page.waitForTimeout(250);
    expect(await harness(page, (h) => h.isActive('Pause'))).toBe(true);
    await tap(page, BTN.B);
    await page.waitForFunction(() => window.__harness!.isActive('Level') && !window.__harness!.isActive('Pause'));
  });

  test('prompts follow the last device used; mouse movement restores the cursor', async ({ page }) => {
    await openGame(page);
    await waitForScene(page, 'Menu');
    await connect(page);
    await tap(page, BTN.LB);
    await expect.poll(() => glyphs(page, 'Menu')).toContain('pad:A');
    expect(await canvasPadClass(page)).toBe(true);
    await page.mouse.move(100, 100);
    await page.mouse.move(140, 120);
    await expect.poll(() => canvasPadClass(page)).toBe(false);
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => glyphs(page, 'Menu')).toContain('key:SPACE');
    await stick(page, 0, 0.9); // a stick push past the dead zone switches back
    await expect.poll(() => glyphs(page, 'Menu')).toContain('pad:A');
    await stick(page, 0, 0);
  });

  test('settings: Vibration toggles with the pad and persists; rumble respects it', async ({ page }) => {
    await openGame(page);
    // Default on: dying with the pad in use rumbles (dual-rumble).
    await startLevel(page, 'test', 'dad');
    await connect(page);
    await tap(page, BTN.LB);
    await harness(page, (h) => h.killPlayer());
    await expect.poll(() => page.evaluate(() => window.__rumbles.length)).toBeGreaterThan(0);
    expect(await page.evaluate(() => (window.__rumbles[0] as unknown[])[0])).toBe('dual-rumble');

    // Turn it off from the main menu's Settings using only the pad.
    await page.reload();
    await page.waitForFunction(() => !!window.__harness);
    await page.evaluate(() => window.__harness!.ready());
    await waitForScene(page, 'Menu');
    await connect(page);
    await page.waitForTimeout(400);
    // PLAY, (CONTINUE disabled), CHARACTER SELECT, COLLECTION, SETTINGS
    await tap(page, BTN.DOWN);
    await tap(page, BTN.DOWN);
    await tap(page, BTN.DOWN);
    await tap(page, BTN.A);
    await waitForScene(page, 'Settings');
    await page.waitForTimeout(400);
    // MUSIC, SOUND FX, MUTE ALL, REDUCED MOTION, EFFECTS, TOUCH CONTROLS, VIBRATION — hold the d-pad (auto-repeat).
    await setButton(page, BTN.DOWN, 1);
    await page.waitForTimeout(380 + 140 * 2);
    await setButton(page, BTN.DOWN, 0);
    await frames(page, 4);
    const onVibration = () =>
      harness(page, (h) => {
        const s = h.game.scene.getScene('Settings');
        const vib = s.children.list.find((o) => (o as Phaser.GameObjects.BitmapText).text === 'VIBRATION') as Phaser.GameObjects.BitmapText;
        return vib.tintTopLeft === 0xffd25a; // gold = selected
      });
    // The repeat count depends on frame timing: finish with single taps.
    for (let i = 0; i < 10 && !(await onVibration()); i++) await tap(page, BTN.DOWN);
    expect(await onVibration()).toBe(true);
    const rumbleSetting = () => harness(page, (h) => (h.getSave() as { settings: { rumble: boolean } }).settings.rumble);
    await tap(page, BTN.A);
    await expect.poll(rumbleSetting).toBe(false);
    await tap(page, BTN.RIGHT); // left/right toggle too
    await expect.poll(rumbleSetting).toBe(true);
    await tap(page, BTN.A);
    await expect.poll(rumbleSetting).toBe(false);
    await tap(page, BTN.B);
    await waitForScene(page, 'Menu');

    await page.reload();
    await page.waitForFunction(() => !!window.__harness);
    await page.evaluate(() => window.__harness!.ready());
    expect(await rumbleSetting()).toBe(false);
    await startLevel(page, 'test', 'dad');
    await connect(page);
    await tap(page, BTN.LB);
    await harness(page, (h) => h.killPlayer());
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__rumbles.length)).toBe(0);
  });
});
