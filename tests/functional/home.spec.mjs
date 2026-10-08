import { test, expect } from '@playwright/test';
import { readJson, scrollThrough, horizontalOverflow } from './helpers.mjs';

const home = readJson('data/homepage.json');

test.describe('Homepage', () => {
  test('major sections exist', async ({ page }) => {
    await page.goto('/');
    await scrollThrough(page); // several blocks have entrance animations
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.getByRole('heading', { name: home.reference.heading.title })).toBeVisible();
    for (const id of ['grupos_de_investigacion', 'bloque_infobox_investigacion', 'oferta-academica']) await expect(page.locator(`#${id}`)).toBeAttached();
    await expect(page.locator('.eb-post-grid-eim7gc5')).toBeVisible();
  });

  test('research group cards come from homepage.json', async ({ page }) => {
    await page.goto('/');
    const cards = page.locator('#bloque_infobox_investigacion .eb-infobox-wrapper');
    const expected = home.research.rows.flat();
    await expect(cards).toHaveCount(expected.length);
    for (const c of expected) await expect(page.locator(`#bloque_infobox_investigacion a[href="${c.url}"]`)).toHaveCount(1);
  });

  test('counters animate from 0 to their target values', async ({ page }) => {
    await page.goto('/');
    const counters = page.locator('.root-eb-row-xy4puiw .eb-counter');
    const first = counters.first();
    await first.scrollIntoViewIfNeeded();
    // while animating, the value is below the target at some point…
    const early = Number(await first.textContent());
    expect(early).toBeLessThanOrEqual(home.reference.stats[0].counter.value);
    // …and it ends on the target
    for (let i = 0; i < home.reference.stats.length; i++) {
      await counters.nth(i).scrollIntoViewIfNeeded();
      await expect(counters.nth(i)).toHaveText(String(home.reference.stats[i].counter.value), { timeout: 5000 });
    }
  });

  test('entrance animations initialise when scrolled into view', async ({ page }) => {
    await page.goto('/');
    const animated = page.locator('.root-eb-infobox-7hunqcg .eb-parent-wrapper');
    await expect(animated).toHaveClass(/eb___zoomIn/);
    await scrollThrough(page);
    await animated.scrollIntoViewIfNeeded();
    await expect(animated).toHaveClass(/eb__animated eb__zoomIn|eb__zoomIn/, { timeout: 5000 });
  });

  test('academic offer tabs switch content', async ({ page }) => {
    await page.goto('/');
    await scrollThrough(page);
    const tabs = page.locator('.eb-advanced-tabs-zhaw2n2 ul.tabTitles > li');
    await expect(tabs).toHaveCount(home.education.tabs.length);
    const second = home.education.tabs[1];
    await tabs.nth(1).click();
    await expect(tabs.nth(1)).toHaveClass(/active/);
    await expect(page.locator(`.eb-advanced-tabs-zhaw2n2 .eb-tab-wrapper[data-tab-id="${second.tabId}"]`)).toBeVisible();
    await expect(page.locator(`.eb-advanced-tabs-zhaw2n2 .eb-tab-wrapper[data-tab-id="${home.education.tabs[0].tabId}"]`)).toBeHidden();
    await expect(page.locator(`.eb-advanced-tabs-zhaw2n2 .eb-tab-wrapper[data-tab-id="${second.tabId}"]`).getByRole('link', { name: second.list.items[0].label, exact: true })).toBeVisible();
  });

  test('Top Stories paginates 4 posts per page', async ({ page }) => {
    await page.goto('/');
    await page.locator('.eb-post-grid-eim7gc5').scrollIntoViewIfNeeded();
    const grid = page.locator('.eb-post-grid-eim7gc5');
    const visible = grid.locator('article.ebpg-grid-post:visible');
    await expect(visible).toHaveCount(4);
    const firstTitle = await visible.first().locator('.ebpg-entry-title').textContent();
    await grid.locator('.ebpg-pagination-item[data-pagenumber="2"]').click();
    await expect(visible).toHaveCount(4);
    expect(await visible.first().locator('.ebpg-entry-title').textContent()).not.toBe(firstTitle);
    await expect(grid.locator('.ebpg-pagination-item.active')).toHaveText('2');
    await grid.locator('.ebpg-pagination-item-next').click();
    await expect(grid.locator('.ebpg-pagination-item.active')).toHaveText('3');
    await grid.locator('.ebpg-pagination-item-previous').click();
    await expect(grid.locator('.ebpg-pagination-item.active')).toHaveText('2');
    // last page: "next" disabled, "…" separators like Essential Blocks
    const last = await grid.locator('.ebpg-pagination-item').last().getAttribute('data-pagenumber');
    await grid.locator(`.ebpg-pagination-item[data-pagenumber="${last}"]`).click();
    await expect(grid.locator('.ebpg-pagination-item-next')).toBeDisabled();
  });

  test('important images load', async ({ page }) => {
    await page.goto('/');
    await scrollThrough(page);
    const broken = await page.$$eval('img', (imgs) => imgs.filter((i) => i.offsetParent !== null && i.complete && i.naturalWidth === 0).map((i) => i.src));
    expect(broken).toEqual([]);
    expect(await page.$eval('.root-eb-advanced-image-fm836dk img', (i) => i.naturalWidth)).toBeGreaterThan(0);
  });

  test('no horizontal overflow at 390 px beyond the original site (menu button, +16 px)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const o = await horizontalOverflow(page);
    expect(o.scrollWidth, JSON.stringify(o.offenders)).toBeLessThanOrEqual(406);
  });

  test('basic content is present without JavaScript', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false, baseURL });
    const page = await ctx.newPage();
    await page.goto('/');
    await expect(page.getByText(home.hero.title.title.replace(/<[^>]+>/g, ''), { exact: false }).first()).toBeVisible();
    await expect(page.locator('.root-eb-row-xy4puiw .eb-counter').first()).toHaveText(String(home.reference.stats[0].counter.value));
    await ctx.close();
  });
});
