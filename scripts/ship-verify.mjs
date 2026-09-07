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

const BASE = process.env.SHIP_BASE_URL || 'http://localhost:3001';
const DIST = path.resolve('dist');
const INDEX = path.join(DIST, 'index.html');
const failures = [];
const ok = (label, cond) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures.push(label);
};

// 1. dist exists and is fresh vs git HEAD
if (fs.existsSync(INDEX)) {
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
  const indexTime = fs.statSync(INDEX).mtimeMs;
  ok(`dist present (${distFiles.length} files)`, true);
  ok(`index.html newer than HEAD commit (gap ${Math.round((indexTime - headTime) / 1000)}s)`, indexTime >= headTime);
} else {
  ok('dist present', false);
}

// 2. health + shell
async function get(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const bytes = Buffer.from(await r.arrayBuffer());
    return { status: r.status, body: bytes.toString('utf8'), bytes };
  } catch {
    return { status: 0, body: '', bytes: Buffer.alloc(0) };
  }
}
const health = await get(`${BASE}/api/health`);
ok(`GET /api/health -> ${health.status}`, health.status === 200);

const shell = await get(`${BASE}/`);
ok(`GET / -> ${shell.status}`, shell.status === 200);
ok('served index.html matches dist/index.html',
  shell.status === 200 && fs.existsSync(INDEX) && shell.bytes.equals(fs.readFileSync(INDEX)));

// 3. Every referenced asset must match the build, including SPA fallback responses.
const assets = [...shell.body.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
let assetOk = assets.length > 0;
for (const a of assets) {
  const r = await get(BASE + a);
  const localAsset = path.resolve(DIST, `.${a}`);
  if (r.status !== 200 || !localAsset.startsWith(DIST + path.sep) ||
      !fs.existsSync(localAsset) || !fs.statSync(localAsset).isFile() ||
      !r.bytes.equals(fs.readFileSync(localAsset))) {
    assetOk = false;
    console.log(`      missing or mismatched: ${a} -> ${r.status}`);
  }
}
ok(`${assets.length} hashed assets all match dist`, assetOk);

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
  process.exitCode = 1;
} else {
  console.log('\nSHIP: CURRENT — served bundle matches repo build.');
}
