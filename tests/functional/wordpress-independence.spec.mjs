// Phase 17 – the static build must render completely with the WordPress server unreachable.
// Every request to dia.fi.upm.es is aborted; pages must still get their styles, fonts, images,
// scripts and visual effects from the local build. Third-party embeds (Google Maps, YouTube)
// and external links are allowed.
import { test, expect } from '@playwright/test';
import { blockWordPress, watchProblems, scrollThrough } from './helpers.mjs';

const PAGES = ['/', '/el-departamento-de-inteligencia-artificial-presentacion/', '/investigacion_dia/', '/contacto/', '/noticias/', '/personaldia/', '/personaldia/asun/', '/pedro-larranaga-galardon-upm-2026/'];

test.describe('WordPress independence (dia.fi.upm.es blocked)', () => {
  test('pages render with styles, fonts, images and scripts from the local build only', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
    const blocked = await blockWordPress(context);
    const page = await context.newPage();
    const problems = watchProblems(page, baseURL);
    for (const p of PAGES) {
      await page.goto(p);
      await scrollThrough(page);
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      // styled: the footer has the theme background image and the header is laid out
      expect(await page.$eval('.site-primary-footer-wrap', (e) => getComputedStyle(e).backgroundImage), p).toContain('/assets/');
      expect(await page.$eval('#masthead', (e) => e.getBoundingClientRect().height), p).toBeGreaterThan(50);
      // fonts loaded locally
      expect(await page.evaluate(() => document.fonts.check('16px Syne') && document.fonts.check('16px "Noto Sans Hanunoo"')), p).toBe(true);
      // every visible image loaded
      const broken = await page.$$eval('img', (imgs) => imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src));
      expect(broken, p).toEqual([]);
    }
    expect(problems.errors).toEqual([]);
    expect(blocked, 'requests attempted to the WordPress host').toEqual([]);
    expect(problems.wordpressRequests).toEqual([]);
    await context.close();
  });

  test('visual effects still work without WordPress', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
    await blockWordPress(context);
    const page = await context.newPage();
    await page.goto('/');
    // counters
    const counter = page.locator('.root-eb-row-xy4puiw .eb-counter').first();
    await counter.scrollIntoViewIfNeeded();
    await expect(counter).toHaveText('32', { timeout: 5000 });
    // sticky header
    await page.mouse.wheel(0, 2000);
    await expect(page.locator('#ast-fixed-header')).toHaveClass(/ast-sticky-active/);
    // tabs
    await page.locator('.eb-advanced-tabs-zhaw2n2 ul.tabTitles > li').nth(1).click();
    await expect(page.locator('.eb-advanced-tabs-zhaw2n2 ul.tabTitles > li').nth(1)).toHaveClass(/active/);
    // mobile menu
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/contacto/');
    await page.locator('#masthead > #ast-mobile-header .main-header-menu-toggle').click();
    await expect(page.locator('#ast-hf-mobile-menu')).toBeVisible();
    // background video is served locally
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/el-departamento-de-inteligencia-artificial-presentacion/');
    await expect(page.locator('#contenedor_portada_presentacion .vidbg-container video source')).toHaveAttribute('src', /^\/assets\//);
    await context.close();
  });

  test('the built HTML/CSS/JS contains no WordPress runtime references', async ({ request }) => {
    for (const p of ['/', '/assets/js/site.js', '/el-departamento-de-inteligencia-artificial-presentacion/', '/personaldia/asun/']) {
      const body = await (await request.get(p)).text();
      // local WordPress paths ("/wp-…") or the old host's WordPress paths
      expect(body, p).not.toMatch(/["'(=]\/wp-(admin|json|includes|content)\/|dia\.fi\.upm\.es\/wp-(admin|json|includes|content)\/|xmlrpc\.php|jquery(\.min)?\.js/i);
    }
  });
});
