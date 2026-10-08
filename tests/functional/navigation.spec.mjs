import { test, expect } from '@playwright/test';
import { readJson, scrollThrough } from './helpers.mjs';

const nav = readJson('data/navigation.json');

test.describe('Desktop navigation', () => {
  test('main menu shows every top-level item from navigation.json', async ({ page }) => {
    await page.goto('/');
    const labels = await page.locator('#ast-hf-menu-1 > li > a .menu-text').allTextContents();
    expect(labels).toEqual(nav.main.map((i) => i.label));
  });

  test('dropdowns open on hover and links navigate', async ({ page }) => {
    await page.goto('/');
    const nosotros = page.locator('#ast-hf-menu-1 > li', { hasText: 'NOSOTROS' });
    await nosotros.hover();
    const sub = nosotros.locator('> .sub-menu');
    await expect(sub).toBeVisible();
    await sub.getByRole('link', { name: 'Presentación' }).click();
    await expect(page).toHaveURL(/\/el-departamento-de-inteligencia-artificial-presentacion\/$/);
    await expect(page.locator('#ast-hf-menu-1 > li', { hasText: 'NOSOTROS' })).toHaveClass(/current-menu-ancestor/);
  });

  test('third-level dropdown (Docencia › Títulos oficiales) opens', async ({ page }) => {
    await page.goto('/');
    await page.locator('#ast-hf-menu-1 > li', { hasText: 'DOCENCIA' }).hover();
    await page.locator('#ast-hf-menu-1 a.menu-link', { hasText: 'Títulos oficiales' }).hover();
    await expect(page.getByRole('link', { name: 'Máster U. en Inteligencia Artificial' }).first()).toBeVisible();
  });

  test('dropdowns are keyboard operable (Enter on the arrow)', async ({ page }) => {
    await page.goto('/');
    const li = page.locator('#ast-hf-menu-1 > li', { hasText: 'INVESTIGACIÓN' });
    const arrow = li.locator('> a .ast-header-navigation-arrow');
    await arrow.focus();
    await page.keyboard.press('Enter');
    await expect(li).toHaveClass(/ast-menu-hover/);
    await expect(li.locator('> .sub-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(li).not.toHaveClass(/ast-menu-hover/);
  });

  test('external menu links open in a new tab', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#ast-hf-menu-1 a[href^="http://sol.dia.fi.upm.es"]')).toHaveAttribute('target', '_blank');
  });

  test('sticky header slides in after scrolling and hides at the top', async ({ page }) => {
    await page.goto('/');
    const fixed = page.locator('#ast-fixed-header');
    await expect(fixed).toHaveCSS('visibility', 'hidden');
    await page.mouse.wheel(0, 1500);
    await expect(fixed).toHaveClass(/ast-sticky-active/);
    await expect(fixed).toHaveCSS('visibility', 'visible');
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(fixed).toHaveCSS('visibility', 'hidden');
  });

  test('scroll-to-top button appears and scrolls back up', async ({ page }) => {
    await page.goto('/');
    const btn = page.locator('#ast-scroll-top');
    await expect(btn).toBeHidden();
    await page.evaluate(() => window.scrollTo(0, 2500));
    await expect(btn).toBeVisible();
    await btn.click();
    await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 5000 }).toBeLessThan(5);
  });

  test('in-page anchor from the menu scrolls to the section', async ({ page }) => {
    await page.goto('/investigacion_dia/');
    await page.locator('#ast-hf-menu-1 > li', { hasText: 'INVESTIGACIÓN' }).hover();
    await page.locator('#ast-hf-menu-1 a[href="/investigacion_dia/#grupos-investigacion"]').click();
    await expect.poll(() => page.evaluate(() => Math.abs(document.getElementById('grupos-investigacion').getBoundingClientRect().top) < 250), { timeout: 5000 }).toBe(true);
  });
});

test.describe('Mobile navigation', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('hamburger opens and closes the menu, sub-menus expand', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('body')).toHaveClass(/ast-header-break-point/);
    const toggle = page.locator('#masthead > #ast-mobile-header .main-header-menu-toggle');
    await expect(toggle).toBeVisible();
    await expect(page.locator('#ast-hf-mobile-menu')).toBeHidden();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#ast-hf-mobile-menu')).toBeVisible();
    const docencia = page.locator('#ast-hf-mobile-menu > li', { hasText: 'DOCENCIA' });
    await docencia.locator('> .ast-menu-toggle').click();
    await expect(docencia).toHaveClass(/ast-submenu-expanded/);
    await expect(docencia.getByRole('link', { name: 'Docencia en el DIA' })).toBeVisible();
    await toggle.click();
    await expect(page.locator('#ast-hf-mobile-menu')).toBeHidden();
  });

  test('menu link navigates to its page', async ({ page }) => {
    await page.goto('/');
    await page.locator('#masthead > #ast-mobile-header .main-header-menu-toggle').click();
    await page.locator('#ast-hf-mobile-menu').getByRole('link', { name: 'CONTACTO' }).click();
    await expect(page).toHaveURL(/\/contacto\/$/);
  });
});

test('every internal link of the main pages resolves (HTTP 200)', async ({ page, request }) => {
  const seen = new Set();
  const known = new Set(readJson('scripts/validation/known-broken.json').links.map((l) => l.url));
  for (const p of ['/', '/el-departamento-de-inteligencia-artificial-presentacion/', '/investigacion_dia/', '/contacto/', '/noticias/', '/personaldia/']) {
    await page.goto(p);
    await scrollThrough(page);
    const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.href));
    for (const h of hrefs) {
      const u = new URL(h);
      if (u.origin !== new URL(page.url()).origin) continue;
      const key = u.pathname;
      if (seen.has(key) || known.has(key)) continue;
      seen.add(key);
      const res = await request.get(key);
      expect(res.status(), `${key} (linked from ${p})`).toBe(200);
    }
  }
  expect(seen.size).toBeGreaterThan(50);
});
