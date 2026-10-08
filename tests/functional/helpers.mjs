import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '../..');
export const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

/** Representative pages used by several specs. */
export const MAIN_PAGES = [
  '/', '/el-departamento-de-inteligencia-artificial-presentacion/', '/investigacion_dia/', '/contacto/',
  '/noticias/', '/noticias/page/2/', '/personaldia/', '/personaldia/ajimenez/', '/personaldia/diaadmin/',
  '/bayesfusion-best-student-paper-award/', '/pedro-larranaga-galardon-upm-2026/', '/tag/noticias/',
  '/category/uncategorized/', '/tag/catedraticos/', '/author/admin/', '/en/', '/buscar/?s=larrañaga',
];

/**
 * Records frontend problems of a page: console errors, uncaught exceptions, failed requests
 * and HTTP errors. Same-origin problems are errors; third-party ones (Google Maps, YouTube)
 * are only recorded.
 */
export function watchProblems(page, baseURL) {
  const problems = { errors: [], thirdParty: [], wordpressRequests: [] };
  const origin = new URL(baseURL).origin;
  const isLocal = (u) => u.startsWith(origin);
  page.on('console', (m) => { if (m.type() === 'error') problems.errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.errors.push(`exception: ${e.message}`));
  page.on('request', (r) => { if (/\/\/dia\.fi\.upm\.es\//.test(r.url())) problems.wordpressRequests.push(r.url()); });
  page.on('requestfailed', (r) => {
    const msg = `failed: ${r.url()} (${r.failure()?.errorText})`;
    if (isLocal(r.url())) { if (!/ERR_ABORTED/.test(r.failure()?.errorText || '') || r.resourceType() !== 'media') problems.errors.push(msg); } else problems.thirdParty.push(msg);
  });
  page.on('response', (r) => {
    if (r.status() < 400) return;
    const msg = `HTTP ${r.status()}: ${r.url()}`;
    if (isLocal(r.url())) problems.errors.push(msg); else problems.thirdParty.push(msg);
  });
  return problems;
}

/** Aborts every request to the original WordPress host (and counts them). */
export async function blockWordPress(context) {
  const blocked = [];
  await context.route(/^https?:\/\/(www\.)?dia\.fi\.upm\.es\//, (route) => { blocked.push(route.request().url()); return route.abort('blockedbyclient'); });
  return blocked;
}

/** Scrolls through the page so lazy content, counters and entrance animations run. */
export async function scrollThrough(page) {
  await page.evaluate(async () => {
    // the theme sets `scroll-behavior: smooth`; jump instantly so every section enters the viewport
    for (let y = 0; y < document.documentElement.scrollHeight; y += 300) { window.scrollTo({ top: y, behavior: 'instant' }); await new Promise((r) => setTimeout(r, 60)); }
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
}

export async function horizontalOverflow(page) {
  return page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const offenders = [...document.querySelectorAll('body *')].filter((e) => {
      const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
      return r.width > 0 && r.right > w + 1 && cs.position !== 'fixed' && !e.closest('#ast-fixed-header, .vidbg-container, .ast-mobile-header-content');
    }).slice(0, 5).map((e) => `${e.tagName}.${String(e.className).slice(0, 50)} right=${Math.round(e.getBoundingClientRect().right)}`);
    return { scrollWidth: document.documentElement.scrollWidth, clientWidth: w, offenders };
  });
}
