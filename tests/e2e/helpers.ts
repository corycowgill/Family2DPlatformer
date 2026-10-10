import { expect, type Page, type TestInfo } from '@playwright/test';
import type { TestHarness, HarnessState, HarnessInput, StartOptions } from '../../src/game/debug/TestHarness';
import type { BotOptions, BotResult } from '../../src/game/debug/PlatformBot';

export type { HarnessState, BotResult };

export const CHARACTERS = ['dad', 'mom', 'brennan', 'parker', 'lupin'] as const;
export const GAME_W = 480;
export const GAME_H = 270;

/** Console messages that are environment noise, not game bugs. */
const IGNORED_CONSOLE = [
  /WebGL/i,
  /GPU stall/i,
  /GL_/,
  /swiftshader/i,
  /AudioContext/i,
  /favicon/i,
  /Automatic fallback to software WebGL/i,
];

export function trackConsole(page: Page): { errors: string[]; warnings: string[]; failedRequests: string[] } {
  const out = { errors: [] as string[], warnings: [] as string[], failedRequests: [] as string[] };
  page.on('console', (msg) => {
    const loc = msg.location()?.url ?? '';
    const text = /Failed to load resource/.test(msg.text()) ? `${msg.text()} [${loc}]` : msg.text();
    if (IGNORED_CONSOLE.some((r) => r.test(text))) return;
    if (msg.type() === 'error') out.errors.push(text);
    if (msg.type() === 'warning') out.warnings.push(text);
  });
  page.on('pageerror', (err) => out.errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 400) out.failedRequests.push(`${res.status()} ${new URL(res.url()).pathname}`);
  });
  return out;
}

/** Open the game with the harness installed and wait until boot is done. */
export async function openGame(page: Page, query = 'test', opts: { clearSave?: boolean } = {}): Promise<void> {
  if (opts.clearSave !== false) {
    await page.addInitScript(() => {
      // Only clear on the first load of this page (keep the save across reloads).
      if (!sessionStorage.getItem('__qa_cleared')) {
        localStorage.removeItem('cfa-save');
        sessionStorage.setItem('__qa_cleared', '1');
      }
    });
  }
  await page.goto(`./?${query}`);
  await page.waitForFunction(() => !!window.__harness, undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__harness!.ready());
}

type H = TestHarness;
/** Run a function against window.__harness in the page. */
export function harness<R, A = undefined>(page: Page, fn: (h: H, arg: A) => R | Promise<R>, arg?: A): Promise<R> {
  return page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    ([src, a]) => new Function('h', 'a', `return (${src})(h, a);`)(window.__harness, a),
    [fn.toString(), arg] as const,
  ) as Promise<R>;
}

export const startLevel = (page: Page, levelId = 'test', character: string = 'dad', opts: StartOptions = {}) =>
  harness(page, (h, a) => h.startLevel(a.levelId, a.character as never, a.opts), { levelId, character, opts });

export const getState = (page: Page) => harness(page, (h) => h.getState());
export const setInput = (page: Page, input: HarnessInput | null) => harness(page, (h, a) => h.setInput(a), input);
export const stepFrames = (page: Page, n: number) => harness(page, (h, a) => h.stepFrames(a), n);
export const scenes = (page: Page) => harness(page, (h) => h.scenes());

export async function waitForScene(page: Page, key: string, timeout = 15_000): Promise<void> {
  await page.waitForFunction((k) => window.__harness!.isActive(k), key, { timeout });
}

/** Hold a key long enough for the game loop to see it (Phaser polls key state per frame). */
export async function holdKey(page: Page, key: string, ms = 120): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

export async function runBot(page: Page, opts: BotOptions): Promise<BotResult> {
  return harness(page, (h, a) => h.bot(a), opts);
}

/** Map a logical 480x270 game coordinate to a page coordinate (canvas is FIT-scaled). */
export async function gameToPage(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = await page.locator('canvas').boundingBox();
  expect(box).not.toBeNull();
  return { x: box!.x + (x / GAME_W) * box!.width, y: box!.y + (y / GAME_H) * box!.height };
}

/** Levels registered in src/game/data/levels.ts whose map JSON is actually served. */
export async function availableLevels(page: Page) {
  return harness(page, (h) => h.levels());
}

export function warn(testInfo: TestInfo, description: string): void {
  testInfo.annotations.push({ type: 'warning', description });
  console.warn(`⚠ ${testInfo.title}: ${description}`);
}
