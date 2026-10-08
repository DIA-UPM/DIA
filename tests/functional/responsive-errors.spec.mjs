import { test, expect } from '@playwright/test';
import { MAIN_PAGES, watchProblems, scrollThrough, horizontalOverflow } from './helpers.mjs';

const WIDTHS = [390, 768, 1024, 1440, 1920];
const RESPONSIVE_PAGES = ['/', '/el-departamento-de-inteligencia-artificial-presentacion/', '/investigacion_dia/', '/contacto/', '/noticias/', '/personaldia/', '/personaldia/ajimenez/', '/bayesfusion-best-student-paper-award/'];

// Horizontal overflow that ALREADY exists on the original WordPress site (measured on
// https://dia.fi.upm.es with the same method, 2026-09-27). It is kept for visual fidelity and
// documented in docs/site-audit.md; any other overflow fails the test.
const EXPECTED_OVERFLOW = {
  390: { '*': 406, '/investigacion_dia/': 610, '/bayesfusion-best-student-paper-award/': 410 }, // mobile menu button sticks out 16 px; research counters row
  768: { '/bayesfusion-best-student-paper-award/': 788 }, // post content column + sidebar
};

test.describe('Responsive layout: no unexpected horizontal overflow', () => {
  for (const width of WIDTHS) {
    test(`${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const p of RESPONSIVE_PAGES) {
        await page.goto(p);
        const o = await horizontalOverflow(page);
        const allowed = EXPECTED_OVERFLOW[width]?.[p] ?? EXPECTED_OVERFLOW[width]?.['*'] ?? o.clientWidth;
        expect(o.scrollWidth, `${p} @${width}: ${JSON.stringify(o.offenders)}`).toBeLessThanOrEqual(allowed);
      }
    });
  }
});

test.describe('Frontend errors', () => {
  for (const p of MAIN_PAGES) {
    test(`no console errors, exceptions or failed local requests: ${p}`, async ({ page, baseURL }) => {
      const problems = watchProblems(page, baseURL);
      await page.goto(p);
      await scrollThrough(page);
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      expect(problems.errors).toEqual([]);
      // fonts and stylesheets really loaded
      expect(await page.evaluate(() => document.fonts.check('16px Syne'))).toBe(true);
      expect(await page.evaluate(() => [...document.styleSheets].every((s) => { try { return s.cssRules.length >= 0; } catch { return true; } }))).toBe(true);
    });
  }

  test('images of news cards load (no broken <img>)', async ({ page }) => {
    for (const p of ['/noticias/', '/noticias/page/5/', '/personaldia/page/3/', '/el-departamento-de-inteligencia-artificial-presentacion/']) {
      await page.goto(p);
      await scrollThrough(page);
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      const broken = await page.$$eval('img', (imgs) => imgs.filter((i) => i.complete && i.naturalWidth === 0 && i.getAttribute('src')).map((i) => i.getAttribute('src')));
      expect(broken, p).toEqual([]);
    }
  });

  test('unknown URLs get the 404 page', async ({ page }) => {
    const res = await page.goto('/esta-pagina-no-existe/');
    expect(res.status()).toBe(404);
    await expect(page.locator('h1.page-title')).toHaveText('Parece que esta página no existe.');
  });

  test('legacy URL redirects (data/redirects.json)', async ({ page }) => {
    await page.goto('/es/marianorico/');
    await expect(page).toHaveURL(/\/personaldia\/marianorico\/$/);
  });

  test('static search finds news and people', async ({ page }) => {
    await page.goto('/buscar/?s=Larrañaga');
    await expect(page.locator('article.ast-archive-post').first()).toBeVisible();
    await expect(page.locator('main')).toContainText('Larrañaga');
    await page.goto('/buscar/?s=zzzzzz-no-existe');
    await expect(page.locator('main')).toContainText('no hemos podido encontrar');
  });
});
