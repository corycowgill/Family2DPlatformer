#!/usr/bin/env node
/**
 * Level reachability checker.
 *
 * For every level source in tools/levels/src, compiles it in memory, then runs a BFS over
 * "standing nodes" (a column standing on top of a solid / one-way surface) starting at
 * the playerStart. Edges are walking steps plus simulated jump & fall arcs that use the
 * real motor model (gravity, apex/fall multipliers, air acceleration) with the WEAKEST
 * character's numbers (lowest jump velocity / speeds, tallest & a wide body) and a safety
 * margin. No abilities (air jump, dash, crawl…) are used, so anything it reaches is
 * reachable by every family member.
 *
 * Moving platforms are treated as one-way surfaces along their whole path (you can ride
 * them), falling platforms as one-way surfaces, blocks as solids, bounce pads add a
 * high launch from the cell they sit on.
 *
 * Mandatory targets: goal (F), every checkpoint (C) and the boss arena. Unreachable
 * mandatory targets are errors (exit 1). Souvenirs/coins that are unreachable without
 * abilities are reported as info (secrets may legitimately need Lupin's crawl etc.).
 *
 * Usage: node tools/levels/check-reachability.mjs [levelId ...] [--verbose] [--map]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSource, compile } from './build-levels.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(__dirname, 'src');
const T = 16;

// ───────────── physics & character numbers (read from the TS sources) ─────────────
const configTs = fs.readFileSync(path.join(ROOT, 'src/game/config.ts'), 'utf8');
const phys = (name, def) => {
  const m = new RegExp(`\\b${name}:\\s*(-?[\\d.]+)`).exec(configTs);
  return m ? Number(m[1]) : def;
};
const PHYSICS = {
  gravity: phys('gravity', 1100),
  fallGravityMult: phys('fallGravityMult', 1.6),
  apexGravityMult: phys('apexGravityMult', 0.55),
  apexThreshold: phys('apexThreshold', 45),
  maxFallSpeed: phys('maxFallSpeed', 420),
  bouncePadVelocity: Math.abs(phys('bouncePadVelocity', -560)),
};
const chars = fs
  .readdirSync(path.join(ROOT, 'src/game/characters'))
  .filter((f) => f !== 'index.ts')
  .map((f) => fs.readFileSync(path.join(ROOT, 'src/game/characters', f), 'utf8'))
  .map((s) => {
    const n = (k) => Number(new RegExp(`\\b${k}:\\s*([\\d.]+)`).exec(s)?.[1]);
    return { walk: n('walkSpeed'), run: n('runSpeed'), airAccel: n('airAccel'), jv: n('jumpVelocity'), bonus: n('runJumpBonus'), w: n('width'), h: n('height') };
  })
  .filter((c) => Number.isFinite(c.jv));
const MARGIN_V = 0.97; // jump velocity safety margin
const MARGIN_H = 0.93; // horizontal speed safety margin
const WEAK = {
  walk: Math.min(...chars.map((c) => c.walk)) * MARGIN_H,
  run: Math.min(...chars.map((c) => c.run)) * MARGIN_H,
  airAccel: Math.min(...chars.map((c) => c.airAccel)),
  jv: Math.min(...chars.map((c) => c.jv)) * MARGIN_V,
  bonus: Math.min(...chars.map((c) => c.bonus)) * MARGIN_V,
  bodyW: 14,
  bodyH: Math.max(...chars.map((c) => c.h)),
};

// ───────────── level model ─────────────
function buildModel(json) {
  const W = json.width;
  const H = json.height;
  const layer = (name) => json.layers.find((l) => l.name === name)?.data ?? new Array(W * H).fill(0);
  const ground = layer('ground');
  const oneway = layer('oneway');
  const hazards = layer('hazards');
  const water = layer('water');
  const objs = json.layers.find((l) => l.type === 'objectgroup').objects.map((o) => ({
    ...o,
    props: Object.fromEntries((o.properties ?? []).map((p) => [p.name, p.value])),
    tx: Math.round(o.x / T),
    ty: Math.round((o.y + o.height) / T) - 1, // bottom tile row
    tw: Math.round(o.width / T),
    th: Math.round(o.height / T),
  }));
  const solid = new Uint8Array(W * H);
  const oneWay = new Uint8Array(W * H); // static + virtual (moving-platform) one-way tops
  const hurt = new Uint8Array(W * H);
  const wet = new Uint8Array(W * H);
  const platGroup = new Int32Array(W * H).fill(-1);
  for (let i = 0; i < W * H; i++) {
    solid[i] = ground[i] > 0 ? 1 : 0;
    oneWay[i] = oneway[i] > 0 ? 1 : 0;
    hurt[i] = hazards[i] > 0 ? 1 : 0;
    wet[i] = water[i] > 0 ? 1 : 0;
  }
  const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const groups = [];
  for (const o of objs) {
    if (o.type === 'block' && inb(o.tx, o.ty)) solid[o.ty * W + o.tx] = 1;
    if (o.type === 'fallingPlatform' || o.type === 'collapsingScaffold') {
      const w = Number(o.props.width ?? 2);
      for (let k = 0; k < w; k++) if (inb(o.tx + k, o.ty)) oneWay[o.ty * W + o.tx + k] = 1;
    }
    if (o.type === 'movingPlatform' || o.type === 'trainPlatform') {
      const w = Number(o.props.width ?? (o.type === 'trainPlatform' ? 8 : 3));
      const dx = Number(o.props.dx ?? 0);
      const dy = Number(o.props.dy ?? 0);
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
      const g = groups.length;
      const cells = [];
      for (let s = 0; s <= steps; s++) {
        const px = o.tx + Math.round((dx * s) / steps);
        const py = o.ty + Math.round((dy * s) / steps);
        for (let k = 0; k < w; k++) {
          if (!inb(px + k, py)) continue;
          const i = py * W + px + k;
          if (!solid[i]) {
            oneWay[i] = 1;
            platGroup[i] = g;
            cells.push(i);
          }
        }
      }
      groups.push(cells);
    }
  }
  const pads = new Set(objs.filter((o) => o.type === 'bouncePad').map((o) => o.ty * W + o.tx));
  return { W, H, solid, oneWay, hurt, wet, objs, groups, platGroup, pads };
}

// ───────────── arc simulation ─────────────
const STEP = 1 / 60;

/** Does the body box [x0,x1)×[y0,y1) (px) overlap any cell in `grid`? */
function overlaps(m, grid, x0, y0, x1, y1) {
  const cx0 = Math.floor(x0 / T);
  const cx1 = Math.floor((x1 - 0.001) / T);
  const cy0 = Math.floor(y0 / T);
  const cy1 = Math.floor((y1 - 0.001) / T);
  for (let cy = cy0; cy <= cy1; cy++) {
    if (cy < 0 || cy >= m.H) continue;
    for (let cx = cx0; cx <= cx1; cx++) {
      if (cx < 0 || cx >= m.W) return grid === m.solid; // world bounds act as walls
      if (grid[cy * m.W + cx]) return true;
    }
  }
  return false;
}

/**
 * Trace one arc. Returns the landing node index (row*W+col of the surface cell) or -1.
 * phases: [{vx, untilApex?}] target horizontal velocities; vx approaches target at airAccel.
 */
function trace(m, x, y, vx0, vy0, phases, hold = true) {
  const hw = WEAK.bodyW / 2;
  const bh = WEAK.bodyH;
  let vx = vx0;
  let vy = vy0;
  let jumping = vy0 < 0;
  let pi = 0;
  for (let t = 0; t < 4; t += STEP) {
    if (phases[pi].untilApex && vy >= 0 && pi < phases.length - 1) pi++;
    const target = phases[pi].vx;
    const a = WEAK.airAccel * STEP;
    vx = vx < target ? Math.min(vx + a, target) : Math.max(vx - a, target);
    // gravity (motor model, jump held)
    let g = PHYSICS.gravity;
    if (vy > 0) g *= PHYSICS.fallGravityMult;
    else if (jumping && !hold) g *= 2.6;
    else if (Math.abs(vy) < PHYSICS.apexThreshold) g *= PHYSICS.apexGravityMult;
    vy = Math.min(PHYSICS.maxFallSpeed, vy + g * STEP);
    if (vy > 0) jumping = false;
    // horizontal move
    const nx = x + vx * STEP;
    if (overlaps(m, m.solid, nx - hw, y - bh, nx + hw, y)) vx = 0;
    else x = nx;
    // vertical move
    const ny = y + vy * STEP;
    if (vy < 0) {
      if (overlaps(m, m.solid, x - hw, ny - bh, x + hw, ny)) {
        vy = 0; // bonk
      } else y = ny;
    } else {
      // landing: feet cross a row boundary onto a solid/one-way top
      const rowBefore = Math.floor((y - 0.001) / T);
      const rowAfter = Math.floor((ny - 0.001) / T);
      let landed = -1;
      for (let r = rowBefore + 1; r <= rowAfter && landed < 0; r++) {
        if (r < 0 || r >= m.H) continue;
        const c0 = Math.floor((x - hw) / T);
        const c1 = Math.floor((x + hw - 0.001) / T);
        let best = -1;
        let bestD = 1e9;
        for (let c = c0; c <= c1; c++) {
          if (c < 0 || c >= m.W) continue;
          const i = r * m.W + c;
          if (m.solid[i] || m.oneWay[i]) {
            const d = Math.abs(c * T + 8 - x);
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          }
        }
        if (best >= 0) landed = best;
      }
      if (landed >= 0) {
        const r = Math.floor(landed / m.W);
        // the body must be free where it stands
        if (overlaps(m, m.hurt, x - hw, r * T - bh, x + hw, r * T)) return -1;
        return landed;
      }
      y = ny;
    }
    if (overlaps(m, m.hurt, x - hw, y - bh, x + hw, y)) return -1;
    if (overlaps(m, m.wet, x - hw, y - 6, x + hw, y)) return -1;
    if (y > m.H * T + 8) return -1;
  }
  return -1;
}

function standable(m, i) {
  const c = i % m.W;
  const r = Math.floor(i / m.W);
  if (!(m.solid[i] || m.oneWay[i])) return false;
  // body above must be free of solids and hazards
  const x = c * T + 8;
  const hw = WEAK.bodyW / 2;
  if (overlaps(m, m.solid, x - hw, r * T - WEAK.bodyH, x + hw, r * T)) {
    // allow narrower clearance check exactly in this column (Dad is 12 wide)
    if (overlaps(m, m.solid, x - 5, r * T - WEAK.bodyH, x + 5, r * T)) return false;
  }
  if (overlaps(m, m.hurt, x - 5, r * T - 4, x + 5, r * T)) return false;
  if (m.wet[i] || (r > 0 && m.wet[i - m.W])) return false;
  return true;
}

function neighbours(m, i) {
  const out = [];
  const c = i % m.W;
  const r = Math.floor(i / m.W);
  const x = c * T + 8;
  const y = r * T;
  // walk
  for (const d of [-1, 1]) {
    const j = i + d;
    if (c + d < 0 || c + d >= m.W) continue;
    if (standable(m, j)) out.push(j);
  }
  // riding a moving platform: every cell of its path
  const g = m.platGroup[i];
  if (g >= 0) for (const j of m.groups[g]) out.push(j);
  const pad = m.pads.has(i - m.W);
  const W = WEAK;
  const jumps = pad
    ? [{ vy: -PHYSICS.bouncePadVelocity * MARGIN_V, speeds: [0, W.walk, W.run] }]
    : [
        { vy: -W.jv, speeds: [0, W.walk * 0.5, W.walk] },
        { vy: -(W.jv + W.bonus), speeds: [W.run] },
      ];
  for (const dir of [-1, 1]) {
    for (const j of jumps) {
      for (const s of j.speeds) {
        const v = dir * s;
        out.push(trace(m, x, y, v, j.vy, [{ vx: v }]));
        // straight up, then drift (getting onto a ledge right above)
        if (s > 0) out.push(trace(m, x, y, 0, j.vy, [{ vx: 0, untilApex: true }, { vx: v }]));
        // forward, then brake after apex (short precise landings)
        if (s > 0) out.push(trace(m, x, y, v, j.vy, [{ vx: v, untilApex: true }, { vx: 0 }]));
      }
    }
    // walking/running off the edge
    if (!standable(m, i + dir) || (c + dir >= 0 && c + dir < m.W && !(m.solid[i + dir] || m.oneWay[i + dir]))) {
      for (const s of [W.walk * 0.4, W.walk, W.run]) {
        const sx = x + dir * (8 + W.bodyW / 2 + 0.5);
        if (overlaps(m, m.solid, sx - W.bodyW / 2, y - W.bodyH, sx + W.bodyW / 2, y)) continue;
        out.push(trace(m, sx, y, dir * s, 0, [{ vx: dir * s }]));
      }
    }
  }
  return out.filter((j) => j >= 0 && standable(m, j));
}

function bfs(m, startIdx) {
  const seen = new Uint8Array(m.W * m.H);
  const q = [startIdx];
  seen[startIdx] = 1;
  while (q.length) {
    const i = q.shift();
    for (const j of neighbours(m, i)) {
      if (!seen[j]) {
        seen[j] = 1;
        q.push(j);
      }
    }
  }
  return seen;
}

/** Find the surface cell an object stands on (first solid/one-way below its bottom cell). */
function supportCell(m, tx, ty) {
  for (let r = ty + 1; r < m.H; r++) {
    const i = r * m.W + tx;
    if (m.solid[i] || m.oneWay[i]) return i;
  }
  return -1;
}

function nearReached(m, seen, tx, ty, dxMax = 1, dyMax = 2) {
  for (let r = ty + 1 - dyMax; r <= ty + 1 + dyMax; r++) {
    for (let c = tx - dxMax; c <= tx + dxMax; c++) {
      if (r < 0 || c < 0 || r >= m.H || c >= m.W) continue;
      if (seen[r * m.W + c]) return true;
    }
  }
  return false;
}

/** Pickups (coins, souvenirs) can be grabbed mid-jump: reached if a standing node is within a jump's reach. */
function pickupReached(m, seen, tx, ty) {
  // within 5 rows above a reached surface and 4 columns sideways (a jump from there passes it)
  for (let r = ty + 1; r <= Math.min(m.H - 1, ty + 5); r++) {
    for (let c = tx - 4; c <= tx + 4; c++) {
      if (c < 0 || c >= m.W) continue;
      if (seen[r * m.W + c]) return true;
    }
  }
  // just below a reached one-way platform (you jump up through it)
  for (let r = ty - 2; r < ty; r++) {
    if (r < 0) continue;
    const i = r * m.W + tx;
    if (seen[i] && m.oneWay[i] && !m.solid[i]) return true;
  }
  return false;
}

export function checkLevel(id, text, { verbose = false, map = false } = {}) {
  const { json, errors } = compile(parseSource(text, `${id}.txt`), `${id}.txt`);
  const problems = [...errors];
  const info = [];
  const m = buildModel(json);
  const start = m.objs.find((o) => o.type === 'playerStart');
  if (!start) return { problems: ['no playerStart'], info };
  const s = supportCell(m, start.tx, start.ty);
  if (s < 0) return { problems: ['playerStart is not above ground'], info };
  const seen = bfs(m, s);
  let reached = 0;
  for (const v of seen) reached += v;
  const isBossLevel = json.properties?.some((p) => p.name === 'boss' && p.value);
  for (const o of m.objs) {
    if (o.type === 'goal' && !nearReached(m, seen, o.tx, o.ty)) problems.push(`goal at ${o.tx},${o.ty} unreachable`);
    if (o.type === 'checkpoint' && !nearReached(m, seen, o.tx, o.ty)) problems.push(`checkpoint #${o.props.index} at ${o.tx},${o.ty} unreachable`);
    if (o.type === 'boss') {
      let ok = false;
      for (let r = o.ty - o.th + 1; r <= o.ty + 1 && !ok; r++) for (let c = o.tx; c < o.tx + o.tw && !ok; c++) if (r >= 0 && r < m.H && seen[r * m.W + c]) ok = true;
      if (!ok) problems.push(`boss arena at ${o.tx},${o.ty} unreachable`);
    }
    if (o.type === 'souvenir' && !pickupReached(m, seen, o.tx, o.ty)) info.push(`souvenir ${Number(o.props.index) + 1} at ${o.tx},${o.ty} needs an ability / secret route`);
  }
  if (isBossLevel && !m.objs.some((o) => o.type === 'boss')) problems.push('boss level without a boss object');
  const coins = m.objs.filter((o) => o.type === 'coin');
  const lostCoins = coins.filter((o) => !pickupReached(m, seen, o.tx, o.ty));
  if (lostCoins.length) info.push(`${lostCoins.length}/${coins.length} coins not reachable without abilities` + (verbose ? `: ${lostCoins.map((o) => `${o.tx},${o.ty}`).join(' ')}` : ''));
  if (map) {
    const rows = [];
    for (let r = 0; r < m.H; r++) {
      let line = '';
      for (let c = 0; c < m.W; c++) {
        const i = r * m.W + c;
        line += seen[i] ? '@' : m.solid[i] ? '#' : m.oneWay[i] ? '=' : m.hurt[i] ? '^' : m.wet[i] ? '~' : '.';
      }
      rows.push(line);
    }
    info.push('\n' + rows.join('\n'));
  }
  return { problems, info, reached, stats: { coins: coins.length, width: m.W, height: m.H } };
}

function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');
  const map = args.includes('--map');
  const only = args.filter((a) => !a.startsWith('--'));
  let failed = false;
  const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.txt')).sort();
  console.log(
    `reachability: weakest jump v=${WEAK.jv.toFixed(0)} (+${WEAK.bonus.toFixed(0)} running), walk ${WEAK.walk.toFixed(0)} / run ${WEAK.run.toFixed(0)} px/s, body ${WEAK.bodyW}x${WEAK.bodyH}`,
  );
  for (const f of files) {
    const id = f.replace(/\.txt$/, '');
    if (only.length && !only.includes(id)) continue;
    const { problems, info, reached, stats } = checkLevel(id, fs.readFileSync(path.join(SRC, f), 'utf8'), { verbose, map });
    if (problems.length) failed = true;
    console.log(`${problems.length ? '✗' : '✓'} ${id} (${stats?.width}x${stats?.height}, ${reached ?? 0} standable cells reached, ${stats?.coins ?? 0} coins)`);
    for (const p of problems) console.log('    ✗', p);
    for (const p of info) console.log('    ·', p);
  }
  if (failed) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
