// Dev tool: screenshot N evenly spaced sections of a level.
// Usage: node tools/dev/level-tour.mjs <levelId|menu> <outDir> <count> [baseUrl]
//   baseUrl defaults to $BASE_URL or http://localhost:5180 (the dev server).
//   Extra query params (e.g. reduced motion) can be passed via $TOUR_QUERY ("&foo=1").
import { chromium } from '@playwright/test';
const [,, level, SP, count, baseArg] = process.argv;
const BASE = (baseArg ?? process.env.BASE_URL ?? 'http://localhost:5180').replace(/\/$/, '');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 960, height: 540 } });
const errs=[]; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type()==='error'||m.type()==='warning') if(!/WebGL|GPU stall|AudioContext/.test(m.text())) errs.push(m.text()); });
if (level === 'menu') {
  // Title screen: wait for boot + menu transition, then one screenshot.
  await p.goto(`${BASE}/${(process.env.TOUR_QUERY ?? '').replace(/^&/, '?')}`); await p.waitForTimeout(6000);
  await p.screenshot({ path: `${SP}/menu.png` });
  console.log('menu', errs.slice(0, 10));
  await b.close();
  process.exit(0);
}
await p.goto(`${BASE}/?level=${level}${process.env.TOUR_QUERY ?? ''}`); await p.waitForTimeout(3000);
const W = await p.evaluate(() => window.__level.ctx.map.widthInPixels);
const n = Number(count);
for (let i = 0; i < n; i++) {
  const x = 120 + (W - 240) * i / (n - 1);
  await p.evaluate((x) => { const L = window.__level; L.player.invulnUntil = Number.MAX_SAFE_INTEGER;
    // find standable y: scan from top for first ground tile below an empty tile
    const g = L.ctx.ground; let y = 16;
    for (let ty = 1; ty < L.ctx.map.height; ty++) { const t = g.getTileAtWorldXY(x, ty*16+1); const t2 = L.ctx.oneway?.getTileAtWorldXY(x, ty*16+1);
      if ((t && t.index>0) || (t2 && t2.index>0)) { y = ty*16 - 2; break; } y = ty*16; }
    L.player.body.reset(x, y); L.cameraSys.snap(); }, x);
  await p.waitForTimeout(700);
  await p.screenshot({ path: `${SP}/${level}-${i}.png` });
}
console.log('W', W, errs.slice(0,10));
await b.close();
