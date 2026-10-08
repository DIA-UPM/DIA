// Phase 14 – proves that content is edited through JSON, and that the test never leaves its
// change behind:
//   1. read data/personnel/asun.json and keep its exact original bytes in memory (+ a backup file)
//   2. change "office" to "TEST-ROOM-123"
//   3. rebuild the site (into a temporary folder, so the dist/ used by other tests is untouched)
//   4. serve that build and open the profile with Playwright → the new value is shown
//   5. restore the exact original bytes (in `finally`, also when the test fails)
//   6. rebuild again → "TEST-ROOM-123" is gone and the original value is back
// A process-exit hook restores the file too, if the test process is killed mid-way.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { test, expect } from '@playwright/test';
import { build } from '../../scripts/build/build.mjs';
import { createServer } from '../../scripts/build/serve.mjs';
import { ROOT } from './helpers.mjs';

const FILE = path.join(ROOT, 'data/personnel/asun.json');
const TEST_VALUE = 'TEST-ROOM-123';
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

test.describe.configure({ mode: 'serial' });

test('a JSON edit appears on the site and is fully reverted afterwards', async ({ browser }) => {
  const originalBytes = fs.readFileSync(FILE);
  const originalHash = sha(originalBytes);
  const original = JSON.parse(originalBytes.toString('utf8'));
  const backup = path.join(os.tmpdir(), `dia-asun-backup-${process.pid}.json`);
  fs.writeFileSync(backup, originalBytes);
  const restore = () => { if (sha(fs.readFileSync(FILE)) !== originalHash) fs.writeFileSync(FILE, originalBytes); };
  process.once('exit', restore);
  process.once('SIGINT', () => { restore(); process.exit(130); });

  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dia-build-'));
  const server = createServer(out);
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  const page = await browser.newPage();
  try {
    expect(original.office).not.toBe(TEST_VALUE);
    fs.writeFileSync(FILE, JSON.stringify({ ...original, office: TEST_VALUE }, null, 2) + '\n');
    await build({ out, quiet: true });
    await page.goto(`${base}/personaldia/asun/`);
    await expect(page.locator('.eb-feature-list-title').first()).toHaveText(`Despacho: ${TEST_VALUE}`);
  } finally {
    restore();
    fs.rmSync(backup, { force: true });
  }

  // after restoring: the file is byte-identical and a rebuild no longer shows the test value
  expect(sha(fs.readFileSync(FILE))).toBe(originalHash);
  await build({ out, quiet: true });
  await page.goto(`${base}/personaldia/asun/`);
  await expect(page.locator('body')).not.toContainText(TEST_VALUE);
  await expect(page.locator('.eb-feature-list-title').first()).toHaveText(`Despacho: ${original.office}`);
  await page.close();
  await new Promise((r) => server.close(r));
  fs.rmSync(out, { recursive: true, force: true });
});

test('no test value is left anywhere in data/', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(path.join(ROOT, 'data'))) expect(fs.readFileSync(f, 'utf8'), f).not.toContain(TEST_VALUE);
});
