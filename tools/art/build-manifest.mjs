#!/usr/bin/env node
/**
 * Scans public/assets and writes public/assets/manifest.json.
 *  - <name>.png + <name>.json  → atlas with key <name>
 *  - <name>.png alone          → image with key <name>  (tilesets/chicago-tiles.png → key "tiles")
 * Audio files are ignored (handled by AudioAssets).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ASSETS = path.join(ROOT, 'public/assets');
const KEY_OVERRIDES = { 'tilesets/chicago-tiles': 'tiles' };

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : [p];
  });
}

const files = walk(ASSETS).map((f) => path.relative(path.join(ROOT, 'public'), f).split(path.sep).join('/'));
const set = new Set(files);
const atlases = [];
const images = [];
for (const f of files.sort()) {
  if (!f.endsWith('.png')) continue;
  const base = f.slice(0, -4);
  const rel = base.slice('assets/'.length);
  const key = KEY_OVERRIDES[rel] ?? path.posix.basename(base);
  if (set.has(`${base}.json`)) atlases.push({ key, png: f, json: `${base}.json` });
  else images.push({ key, path: f });
}
const keys = [...atlases, ...images].map((a) => a.key);
const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
if (dup.length) {
  console.error('Duplicate asset keys:', dup);
  process.exit(1);
}
fs.writeFileSync(path.join(ASSETS, 'manifest.json'), JSON.stringify({ atlases, images }, null, 2) + '\n');
console.log(`manifest: ${atlases.length} atlases, ${images.length} images`);
