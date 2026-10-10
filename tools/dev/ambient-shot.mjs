// Dev tool: force every ambient effect of a level's theme to fire, then screenshot.
// Usage: node tools/dev/ambient-shot.mjs <levelId> <outDir> [baseUrl] [playerX]
//   baseUrl defaults to $BASE_URL or http://localhost:5180 (the dev server). REDUCED=1 → reduced motion.
import { chromium } from '@playwright/test';
const [,, level, SP, baseArg, px] = process.argv;
const BASE = (baseArg ?? process.env.BASE_URL ?? 'http://localhost:5180').replace(/\/$/, '');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 960, height: 540 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
if (process.env.REDUCED) {
  // REDUCED=1: start with settings.reducedMotion on → everything should stay still.
  await p.addInitScript(() => {
    const k = 'cfa-save';
    const s = JSON.parse(localStorage.getItem(k) ?? '{}');
    s.version ??= 1;
    s.settings = { ...(s.settings ?? {}), reducedMotion: true };
    localStorage.setItem(k, JSON.stringify(s));
  });
}
await p.goto(`${BASE}/?level=${level}`);
await p.waitForTimeout(3000);
await p.evaluate((px) => {
  const L = window.__level;
  L.player.invulnUntil = Number.MAX_SAFE_INTEGER;
  if (px) {
    L.player.body.reset(Number(px), 32);
    L.cameraSys.snap();
  }
  const a = L.parallax.ambient;
  if (!a) return;
  a.flockTimer = 0;
  if (a.train) a.train.timer = 0;
  for (const m of a.boats) m.timer = 0;
  a.glintTimer = 0;
}, px);
const shots = [600, 2400, 4200];
let last = 0;
for (let i = 0; i < shots.length; i++) {
  await p.waitForTimeout(shots[i] - last);
  last = shots[i];
  await p.screenshot({ path: `${SP}/ambient-${level}-${i}.png` });
}
const state = await p.evaluate(() => {
  const a = window.__level.parallax.ambient;
  if (!a) return null;
  return {
    birds: a.birds.filter((x) => x.s.visible).length,
    train: a.train ? { active: a.train.active, visible: a.train.img.visible, x: a.train.img.x } : null,
    boats: a.boats.map((m) => ({ active: m.active, visible: m.img.visible, x: m.img.x })),
    twinklesOn: a.twinkles.filter((t) => t.s.visible).length,
    steamOn: a.puffs.filter((x) => x.s.visible).length,
    water: a.water.length,
    waterVisible: a.water.filter((w) => w.top.visible).length,
    children: window.__level.children.length,
  };
});
console.log(level, JSON.stringify(state), errs.slice(0, 5));
await b.close();
