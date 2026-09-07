// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const verifier = path.resolve('scripts/ship-verify.mjs');
const shell = '<script type="module" src="/assets/app-123.js"></script>';
let fixture: string;
let server: Server;
let base: string;
let responses: Record<string, string>;

beforeEach(async () => {
  fixture = mkdtempSync(path.join(tmpdir(), 'qatrial-ship-test-'));
  execFileSync('git', ['init', '--quiet'], { cwd: fixture });
  execFileSync('git', ['-c', 'user.name=QAtrial Test', '-c', 'user.email=test@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '--quiet', '--allow-empty', '-m', 'fixture'], { cwd: fixture });
  mkdirSync(path.join(fixture, 'dist/assets'), { recursive: true });
  writeFileSync(path.join(fixture, 'dist/index.html'), shell);
  writeFileSync(path.join(fixture, 'dist/assets/app-123.js'), 'console.log("current");');
  writeFileSync(path.join(fixture, 'dist/sw.js'), '// current worker');
  responses = {
    '/api/health': '{"status":"ok"}',
    '/': shell,
    '/assets/app-123.js': 'console.log("current");',
    '/sw.js': '// current worker',
  };
  server = createServer((req, res) => {
    res.end(responses[req.url || '/'] ?? shell);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  base = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  rmSync(fixture, { recursive: true, force: true });
});

async function verify() {
  try {
    const result = await run(process.execPath, [verifier], {
      cwd: fixture, env: { ...process.env, SHIP_BASE_URL: base },
    });
    return { code: 0, stdout: result.stdout };
  } catch (error) {
    const result = error as { code: number; stdout: string };
    return { code: result.code, stdout: result.stdout };
  }
}

describe('ship verification', () => {
  it('accepts the currently built and served app', async () => {
    const result = await verify();
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('SHIP: CURRENT');
  });

  it('rejects a stale shell even if its assets still return 200', async () => {
    responses['/'] = '<script src="/assets/old-456.js"></script>';
    responses['/assets/old-456.js'] = 'console.log("old");';
    const result = await verify();
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('FAIL  served index.html matches');
  });

  it('rejects an HTML fallback for a missing asset', async () => {
    delete responses['/assets/app-123.js'];
    const result = await verify();
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('FAIL  1 hashed assets all match dist');
  });

  it('rejects different bytes served at the same asset URL', async () => {
    responses['/assets/app-123.js'] = 'console.log("stale");';
    const result = await verify();
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('FAIL  1 hashed assets all match dist');
  });

  it('does not let a fresh unrelated file hide an old build', async () => {
    utimesSync(path.join(fixture, 'dist/index.html'), 1, 1);
    writeFileSync(path.join(fixture, 'dist/new-file.txt'), 'new');
    const result = await verify();
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('FAIL  index.html newer than HEAD');
  });
});
