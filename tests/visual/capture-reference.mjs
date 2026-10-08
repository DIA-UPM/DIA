// Phase 3 – captures the visual baseline of the LIVE WordPress site into tests/reference/.
// Run once (npm run capture-reference). Existing screenshots are kept unless --refresh.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { PAGES, VIEWPORTS } from './pages.mjs';
import { normalizePage } from './normalize.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'tests/reference');
const ORIGIN = 'https://dia.fi.upm.es';
const refresh = process.argv.includes('--refresh');
const only = process.argv.includes('--page') ? process.argv[process.argv.indexOf('--page') + 1] : null;

const browser = await chromium.launch();
try {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, locale: 'es-ES', timezoneId: 'Europe/Madrid' });
    for (const p of PAGES) {
      if (only && p.name !== only) continue;
      const file = path.join(OUT, p.name, `${vp.name}.png`);
      if (fs.existsSync(file) && !refresh) continue;
      const page = await ctx.newPage();
      await page.goto(ORIGIN + p.path, { waitUntil: 'load', timeout: 90000 });
      await normalizePage(page);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      await page.screenshot({ path: file, fullPage: true });
      // Above-the-fold capture as well (header / hero state)
      await page.screenshot({ path: file.replace('.png', '-fold.png') });
      console.log('captured', p.name, vp.name);
      await page.close();
      await new Promise((r) => setTimeout(r, 1000)); // be gentle with the server
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
