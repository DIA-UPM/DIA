import { test, expect } from '@playwright/test';
import { readJson, scrollThrough } from './helpers.mjs';

const research = readJson('data/research.json');
const contact = readJson('data/contact.json');

test.describe('Research', () => {
  test('research groups render as tabs from research.json', async ({ page }) => {
    await page.goto('/investigacion_dia/');
    const titles = page.locator('.eb-advanced-tabs-cg12jgf ul.tabTitles > li');
    await expect(titles).toHaveCount(research.groups.length);
    expect((await titles.allTextContents()).map((t) => t.trim())).toEqual(research.groups.map((g) => g.name));
    const panels = page.locator('.eb-advanced-tabs-cg12jgf .eb-tab-wrapper');
    await expect(panels.filter({ has: page.locator(':visible') })).toHaveCount(1);
  });

  test('clicking a group shows its description and "Saber más" link', async ({ page }) => {
    await page.goto('/investigacion_dia/');
    await scrollThrough(page); // the tabs block has an entrance animation (hidden until scrolled into view)
    for (const i of [2, research.groups.length - 1]) {
      const g = research.groups[i];
      await page.locator(`.eb-advanced-tabs-cg12jgf li[data-title-tab-id="${g.style.tabId}"]`).click();
      const panel = page.locator(`.eb-advanced-tabs-cg12jgf .eb-tab-wrapper[data-tab-id="${g.style.tabId}"]`);
      await expect(panel).toBeVisible();
      await expect(panel.getByRole('link', { name: g.buttonLabel })).toHaveAttribute('href', g.url);
    }
  });

  test('keyboard can switch tabs', async ({ page }) => {
    await page.goto('/investigacion_dia/');
    await scrollThrough(page);
    const g = research.groups[1];
    await page.locator(`.eb-advanced-tabs-cg12jgf li[data-title-tab-id="${g.style.tabId}"]`).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator(`.eb-advanced-tabs-cg12jgf .eb-tab-wrapper[data-tab-id="${g.style.tabId}"]`)).toBeVisible();
  });

  test('counters and areas list come from JSON', async ({ page }) => {
    await page.goto('/investigacion_dia/');
    await expect(page.locator('ul.wp-block-list li')).toHaveCount(research.areas.length);
    for (const c of research.counters) {
      const el = page.locator(`.eb-counter-${c.style} .eb-counter`);
      await el.scrollIntoViewIfNeeded();
      await expect(el).toHaveText(String(c.value), { timeout: 5000 });
    }
  });
});

test.describe('Contact', () => {
  test('contact information and map appear', async ({ page }) => {
    await page.goto('/contacto/');
    await expect(page.locator('h1')).toHaveText(contact.title);
    for (const line of contact.contact.lines) await expect(page.locator('.entry-content')).toContainText(line);
    await expect(page.locator(`.entry-content iframe[src="${contact.map.embedUrl}"]`)).toBeAttached();
    await expect(page.locator('.entry-content a[href="http://www.fi.upm.es/"]')).toHaveAttribute('target', '_blank');
    await expect(page.locator('.entry-content a[href="http://www.upm.es/"]')).toBeAttached();
  });

  test('footer contact block (site.json) is on every page', async ({ page }) => {
    const site = readJson('data/site.json');
    for (const p of ['/', '/contacto/', '/personaldia/asun/']) {
      await page.goto(p);
      await expect(page.locator('#colophon')).toContainText(site.footer.address[0]);
      await expect(page.locator('#colophon')).toContainText(site.footer.address[4].trim());
    }
  });
});
