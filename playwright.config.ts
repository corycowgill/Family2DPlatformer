import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

/**
 * E2E config. The game is served from a production build (`vite preview`).
 * - PORT: preview port (default 4173; set a free one locally, e.g. PORT=4187).
 * - PW_CHROMIUM: Chromium binary; falls back to the preinstalled /opt/pw-browsers/chromium
 *   when it exists, otherwise Playwright's own download (CI: `npx playwright install chromium`).
 * - E2E_SKIP_BUILD=1: serve the existing dist/ without rebuilding.
 */
const PORT = Number(process.env.PORT ?? 4173);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const chromiumPath = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const executablePath = existsSync(chromiumPath) ? chromiumPath : undefined;
const launchOptions = {
  ...(executablePath ? { executablePath } : {}),
  args: ['--enable-precise-memory-info', '--autoplay-policy=no-user-gesture-required'],
};

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  // Game simulation is CPU heavy (software GL in CI): keep parallelism modest.
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions,
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 }, launchOptions },
      grepInvert: /@touch/,
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7 landscape'], launchOptions },
      grep: /@touch|@smoke/,
      grepInvert: /@iphone/,
    },
    {
      // iPhone 14 in landscape, emulated in Chromium (WebKit isn't installed here): iOS UA,
      // 844x390 CSS px, DPR 3, touch. Real-iPhone checks are listed in docs/QA.md.
      name: 'iphone',
      use: {
        viewport: { width: 844, height: 390 },
        screen: { width: 844, height: 390 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        userAgent: devices['iPhone 14 landscape'].userAgent,
        launchOptions,
      },
      grep: /@touch|@iphone/,
    },
  ],
  webServer: {
    command: process.env.E2E_SKIP_BUILD
      ? `npx vite preview --port ${PORT} --strictPort --host 127.0.0.1`
      : `npm run build && npx vite preview --port ${PORT} --strictPort --host 127.0.0.1`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
