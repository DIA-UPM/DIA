// Phase 15 – visual regression against the live-site baseline (tests/reference/, captured with
// `npm run capture-reference`). Both sides use the same normalisation (tests/visual/normalize.mjs):
// fonts + images loaded, animations finished and frozen, background video paused on its first
// frame, Google Maps iframe hidden. Diff images are written to tests/visual/output/.
//
// Thresholds: at most 0.5 % of differing pixels and the same page height. Differences found during
// the migration were inspected and classified in docs/visual-regression.md.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { PAGES, VIEWPORTS } from './pages.mjs';
import { runComparison } from './compare.mjs';

const MAX_DIFF = 0.005;
const ROOT = path.resolve(import.meta.dirname, '../..');

for (const vp of VIEWPORTS) {
  test(`visual regression @ ${vp.width}x${vp.height}`, async ({ baseURL }) => {
    test.setTimeout(15 * 60_000);
    const pages = PAGES.filter((p) => fs.existsSync(path.join(ROOT, 'tests/reference', p.name, `${vp.name}.png`)));
    const results = await runComparison({ base: baseURL, pages, viewports: [vp] });
    expect(results.length).toBe(pages.length);
    for (const r of results) {
      expect.soft(r.heightDelta, `${r.page} @${r.viewport}: page height ${r.heightRef} → ${r.heightLocal}`).toBe(0);
      expect.soft(r.diffRatio, `${r.page} @${r.viewport}: ${(r.diffRatio * 100).toFixed(2)} % of pixels differ (see tests/visual/output/${r.page}/${r.viewport}-diff.png)`).toBeLessThanOrEqual(MAX_DIFF);
    }
  });
}
