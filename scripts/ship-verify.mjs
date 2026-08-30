#!/usr/bin/env node
/**
 * SHIP GATE — verify the served app matches the repo build.
 *
 * Closes the "commit without rebuild" gap (2026-08-30: Codex committed the
 * SW fix at 00:59 but dist was built at 00:51, so the fix never reached the
 * served bundle and Joe hit the frozen client).
 *
 * Usage:
 *   npm run ship            # build + verify (the one command after any commit)
 *   node scripts/ship-verify.mjs   # verify only (no build)
 *
 * Exits 1 on any failure. Prints SHIP: CURRENT or SHIP: STALE.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'http://localhost:3001';
const DIST = path.resolve('dist');
const failures = [];
const ok = (label, cond) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures.push(label);
};

// 1. dist exists and is fresh vs git HEAD
if (fs.existsSync(path.join(DIST, 'index.html'))) {
  const headTime = Date.parse(
    execFileSync('git', ['log', '-1', '--pretty=%cI'], { encoding: 'utf8' }).trim(),
  );
  const distFiles = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else distFiles.push(p);
    }
  })(DIST);
  const newest = Math.max(...distFiles.map((p) => fs.statSync(p).mtimeMs));
  ok(`dist present (${distFiles.length} files)`, true);
  ok(`dist newer than HEAD commit (gap ${Math.round((newest - headTime) / 1000)}s)`, newest >= headTime);
} else {
  ok('dist present', false);
}

// 2. health + shell
async function get(url) {
  try {
    const r = await fetch(url);
    return { status: r.status, body: await r.text() };
  } catch {
    return { status: 0, body: '' };
  }
}
const health = await get(`${BASE}/api/health`);
ok(`GET /api/health -> ${health.status}`, health.status === 200);

const shell = await get(`${BASE}/`);
ok(`GET / -> ${shell.status}`, shell.status === 200);

// 3. every hashed asset referenced by served index.html resolves 200
const assets = [...shell.body.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
let assetOk = assets.length > 0;
for (const a of assets) {
  const r = await get(BASE + a);
  if (r.status !== 200) { assetOk = false; console.log(`      broken: ${a} -> ${r.status}`); }
}
ok(`${assets.length} hashed assets all -> 200`, assetOk);

// 4. sw.js: served bytes match dist (bridge must be live, not a stale cache)
if (fs.existsSync(path.join(DIST, 'sw.js'))) {
  const sw = await get(`${BASE}/sw.js`);
  const local = fs.readFileSync(path.join(DIST, 'sw.js'), 'utf8');
  ok(`served /sw.js matches dist/sw.js (${sw.body.length}B)`, sw.status === 200 && sw.body === local);
} else {
  ok('sw.js present in dist', false);
}

if (failures.length) {
  console.log(`\nSHIP: STALE/BROKEN — ${failures.length} failure(s). Run: npm run build`);
  process.exit(1);
}
console.log('\nSHIP: CURRENT — served bundle matches repo build.');
