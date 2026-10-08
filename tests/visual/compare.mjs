// Phase 15 – visual regression: screenshots the LOCAL static build with the same
// normalisation used for the live baseline (tests/reference/) and compares them with pixelmatch.
//
// Usage: node tests/visual/compare.mjs [--base http://localhost:8080] [--page home] [--vp 1440] [--full]
// Output: tests/visual/output/<page>/<vp>-{local,diff}.png and tests/visual/output/report.json
// (the output folder is git-ignored). Exit code 0 always; the Playwright spec applies thresholds.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { PAGES, VIEWPORTS } from './pages.mjs';
import { normalizePage } from './normalize.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const REF = path.join(ROOT, 'tests/reference');
const OUT = path.join(ROOT, 'tests/visual/output');
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const BASE = opt('--base', process.env.BASE_URL || 'http://localhost:8080');
const onlyPage = opt('--page');
const onlyVp = opt('--vp');
const variant = args.includes('--fold') ? '-fold' : '';

function compareImages(aFile, bFile, diffFile) {
  const a = PNG.sync.read(fs.readFileSync(aFile));
  const b = PNG.sync.read(fs.readFileSync(bFile));
  // Full-page captures can differ in height; compare the common area and report the delta.
  const width = Math.min(a.width, b.width); const height = Math.min(a.height, b.height);
  const crop = (img) => { const out = new PNG({ width, height }); PNG.bitblt(img, out, 0, 0, width, height, 0, 0); return out; };
  const ca = crop(a); const cb = crop(b); const diff = new PNG({ width, height });
  const pixels = pixelmatch(ca.data, cb.data, diff.data, width, height, { threshold: 0.15, includeAA: false });
  fs.writeFileSync(diffFile, PNG.sync.write(diff));
  return { diffRatio: pixels / (width * height), heightRef: a.height, heightLocal: b.height, heightDelta: b.height - a.height };
}

export async function runComparison({ base = BASE, pages = PAGES, viewports = VIEWPORTS } = {}) {
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const vp of viewports) {
      if (onlyVp && vp.name !== onlyVp) continue;
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, locale: 'es-ES', timezoneId: 'Europe/Madrid' });
      for (const p of pages) {
        if (onlyPage && p.name !== onlyPage) continue;
        const ref = path.join(REF, p.name, `${vp.name}${variant}.png`);
        if (!fs.existsSync(ref)) continue;
        const page = await ctx.newPage();
        await page.goto(base + p.path, { waitUntil: 'load' });
        await normalizePage(page);
        const dir = path.join(OUT, p.name); fs.mkdirSync(dir, { recursive: true });
        const local = path.join(dir, `${vp.name}${variant}-local.png`);
        await page.screenshot({ path: local, fullPage: !variant });
        await page.close();
        const r = compareImages(ref, local, path.join(dir, `${vp.name}${variant}-diff.png`));
        results.push({ page: p.name, viewport: vp.name, ...r });
        console.log(`${p.name.padEnd(24)} ${vp.name.padStart(5)}  diff ${(r.diffRatio * 100).toFixed(2).padStart(6)}%  height ${r.heightRef}→${r.heightLocal} (${r.heightDelta >= 0 ? '+' : ''}${r.heightDelta})`);
      }
      await ctx.close();
    }
  } finally { await browser.close(); }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `report-${viewports.map((v) => v.name).join('-')}${variant}.json`), JSON.stringify(results, null, 2));
  return results;
}

if (process.argv[1] && process.argv[1].endsWith('compare.mjs')) runComparison();
