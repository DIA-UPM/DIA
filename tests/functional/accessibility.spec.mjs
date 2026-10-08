// Phase 10 – accessibility basics (not a full audit): language, one H1, alt text, accessible
// names for links/buttons, visible keyboard focus. The original site is the baseline: these
// checks make sure the migration does not reduce accessibility.
import { test, expect } from '@playwright/test';
import { MAIN_PAGES } from './helpers.mjs';

for (const p of MAIN_PAGES) {
  test(`a11y basics: ${p}`, async ({ page }) => {
    await page.goto(p);
    expect(await page.getAttribute('html', 'lang')).toMatch(/^(es|en)-/);
    expect(await page.locator('h1').count(), 'exactly one <h1>').toBe(1);
    expect(await page.locator('img:not([alt])').count(), 'images without alt attribute').toBe(0);
    const unnamed = await page.$$eval('a[href]:not([aria-hidden="true"]), button', (els) => els.filter((e) => {
      const name = (e.getAttribute('aria-label') || e.textContent || '').trim() || [...e.querySelectorAll('img')].map((i) => i.alt).join('').trim();
      return !name && e.offsetParent !== null;
    }).map((e) => e.outerHTML.slice(0, 120)));
    // one content link on the original site has no text (known-broken.json: pareja profile)
    expect(unnamed.filter((h) => !h.includes('href="https://"') && !h.includes('ecsen.es')), 'links/buttons without accessible name').toEqual([]);
  });
}

test('keyboard focus is visible on links', async ({ page }) => {
  await page.goto('/contacto/');
  await page.keyboard.press('Tab'); // skip link
  await expect(page.locator('.skip-link')).toBeFocused();
  await page.keyboard.press('Tab');
  const style = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement); return { outline: cs.outlineStyle + ' ' + cs.outlineWidth, shadow: cs.boxShadow }; });
  expect(style.outline !== 'none 0px' || style.shadow !== 'none', JSON.stringify(style)).toBe(true);
});

test('skip link jumps to the content', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip-link')).toBeVisible();
  await expect(page.locator('.skip-link')).toHaveAttribute('href', '#content');
  await expect(page.locator('#content')).toBeAttached();
});
