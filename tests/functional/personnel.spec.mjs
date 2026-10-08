import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { ROOT, readJson, horizontalOverflow } from './helpers.mjs';

const people = fs.readdirSync(path.join(ROOT, 'data/personnel')).map((f) => readJson(`data/personnel/${f}`));
const dept = readJson('data/department.json');

test.describe('Personnel', () => {
  test('listing renders 10 cards per page with pagination', async ({ page }) => {
    await page.goto('/personaldia/');
    await expect(page.locator('article.ast-archive-post')).toHaveCount(10);
    await expect(page.locator('.ast-archive-title')).toHaveText('Personalesdia');
    await page.locator('nav.pagination a.next').click();
    await expect(page).toHaveURL(/\/personaldia\/page\/2\/$/);
    await expect(page.locator('article.ast-archive-post')).toHaveCount(10);
  });

  test('every profile is reachable from the listing pages', async ({ page }) => {
    const found = new Set();
    for (let n = 1; n <= Math.ceil(people.length / 10); n++) {
      await page.goto(n === 1 ? '/personaldia/' : `/personaldia/page/${n}/`);
      for (const href of await page.$$eval('article.ast-archive-post h2 a', (as) => as.map((a) => a.getAttribute('href')))) found.add(href);
    }
    expect([...found].sort()).toEqual(people.map((p) => `/personaldia/${p.slug}/`).sort());
  });

  test('profile information comes from JSON', async ({ page }) => {
    const p = readJson('data/personnel/ajimenez.json');
    await page.goto('/personaldia/ajimenez/');
    await expect(page.locator('h1.entry-title')).toHaveText(p.name);
    const fields = page.locator('.eb-feature-list-title');
    await expect(fields).toHaveCount(8);
    await expect(fields.nth(0)).toHaveText(`Despacho: ${p.office}`);
    await expect(fields.nth(2)).toHaveText(`Teléfono: ${p.phone}`);
    await expect(page.locator(`a[href="mailto:${p.email}"]`)).toHaveText(p.email);
    await expect(page.locator(`a[href="${p.orcid}"]`)).toHaveAttribute('target', '_blank');
    await expect(page.locator('.entry-content')).toContainText(p.biography[0].replace(/<[^>]+>/g, '').slice(0, 60));
    const img = page.locator('img.my-custom-image');
    await expect(img).toHaveAttribute('src', p.image);
    expect(await img.evaluate((i) => i.naturalWidth)).toBeGreaterThan(0);
  });

  test('optional fields may be empty without breaking the layout', async ({ page }) => {
    const p = readJson('data/personnel/melgar-garcia-laura.json');
    expect(p.email).toBe('');
    await page.goto('/personaldia/melgar-garcia-laura/');
    await expect(page.locator('.eb-feature-list-title').nth(4)).toHaveText('Email:');
    for (const w of [390, 1440]) {
      await page.setViewportSize({ width: w, height: 900 });
      const o = await horizontalOverflow(page);
      expect(o.scrollWidth, JSON.stringify(o.offenders)).toBeLessThanOrEqual(w === 390 ? 406 : o.clientWidth); // 390: original mobile header overflow
    }
  });

  test('presentation page grids list the people of each category (from JSON)', async ({ page }) => {
    await page.goto('/el-departamento-de-inteligencia-artificial-presentacion/');
    for (const g of dept.grids) {
      const expected = people.filter((p) => [p.category, ...(p.categories || [])].some((c) => g.tags.includes(c))).sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
      const titles = await page.locator(`.eb-post-grid-${g.id} .ebpg-entry-title a`).allTextContents();
      expect(titles.map((t) => t.trim()), g.label).toEqual(expected.map((p) => p.name));
    }
    // management team cards link to the profiles
    for (const m of dept.management.members) await expect(page.locator(`#equipo-directivo ~ * a[href="/personaldia/${m.person}/"], a[href="/personaldia/${m.person}/"]`).first()).toBeAttached();
  });

  test('profile links from the presentation grids work', async ({ page }) => {
    await page.goto('/el-departamento-de-inteligencia-artificial-presentacion/');
    await page.locator('.eb-post-grid-4a8k4qv .ebpg-grid-post-link').first().click();
    await expect(page).toHaveURL(/\/personaldia\/[^/]+\/$/);
    await expect(page.locator('.eb-feature-list-title').first()).toContainText('Despacho');
  });

  test('presentation video pop-up opens and closes', async ({ page }) => {
    await page.goto('/el-departamento-de-inteligencia-artificial-presentacion/');
    const popup = page.locator('#eb-popup-88t7y');
    await expect(popup.locator('.modal-main-wrap')).toBeHidden();
    await popup.locator('.eb-popup-button-anchor').click();
    await expect(popup.locator('.modal-main-wrap')).toBeVisible();
    await expect(popup.locator('iframe')).toHaveAttribute('src', /youtube\.com\/embed/);
    await popup.locator('.eb-popup-close-icon').click();
    await expect(popup.locator('.modal-main-wrap')).toBeHidden();
  });
});
