// Polite crawler/snapshotter for https://dia.fi.upm.es/
//
// - Discovers pages from the Yoast sitemaps + internal links.
// - Stores the raw server HTML and the Playwright-rendered DOM of every page.
// - Records every network resource the rendered page requests (after scrolling,
//   so lazy-loaded images are included) and every asset referenced from HTML/CSS
//   (src, srcset, data-src, data-srcset, style url(), CSS url(), @import).
// - Downloads assets once into .cache/crawl/assets (never re-downloads).
// - Classifies resources (A = needed by final site, B = WP runtime/admin, C = duplicate/obsolete).
// - Writes .cache/crawl/crawl-report.json and docs/crawl-report.md.
//
// Usage: node scripts/crawl/crawl.mjs [--no-render] [--max N] [--refresh]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from '@playwright/test';
import * as cheerio from 'cheerio';

const ORIGIN = 'https://dia.fi.upm.es';
const ROOT = path.resolve(import.meta.dirname, '../..');
const CACHE = path.join(ROOT, '.cache/crawl');
const PAGES_DIR = path.join(CACHE, 'pages');
const ASSETS_DIR = path.join(CACHE, 'assets');
const UA = 'Mozilla/5.0 (compatible; DIA-static-migration/1.0; polite crawler)';
const DELAY_MS = 700;
const args = process.argv.slice(2);
const RENDER = !args.includes('--no-render');
const REFRESH = args.includes('--refresh');
const MAX = args.includes('--max') ? Number(args[args.indexOf('--max') + 1]) : Infinity;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(PAGES_DIR, { recursive: true });
fs.mkdirSync(ASSETS_DIR, { recursive: true });

const report = {
  startedAt: new Date().toISOString(),
  pages: {},          // url -> { status, redirectedTo, title, file, links, assets }
  assets: {},         // url -> { status, file, bytes, contentType, class, referencedBy: [] , error }
  redirects: [],
  failed: [],
  external: {},       // external host -> count
};

// ---------------------------------------------------------------- helpers
const SKIP_PAGE = [
  /\/wp-admin/, /\/wp-json/, /xmlrpc\.php/, /\/feed\/?$/, /\/comments\/feed/, /\?replytocom=/,
  /\/wp-login\.php/, /\/wp-content\//, /\/wp-includes\//, /#/, /\?s=/, /\/embed\/?$/,
];
const ASSET_EXT = /\.(css|js|mjs|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|pdf|docx?|xlsx?|pptx?|zip|mp4|webm|mp3|json)(\?|$)/i;

function normUrl(u, base) {
  try {
    const url = new URL(u, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.hostname === 'dia.fi.upm.es') url.protocol = 'https:';
    url.hash = '';
    return url.href;
  } catch { return null; }
}
const isInternal = (u) => { try { return new URL(u).hostname === 'dia.fi.upm.es'; } catch { return false; } };

function pageFile(u) {
  const url = new URL(u);
  const p = url.pathname.replace(/\/+$/, '') || '';
  // Query-string variants (e.g. /?q=en) must not overwrite the plain page.
  const q = url.search ? '_q' + crypto.createHash('md5').update(url.search).digest('hex').slice(0, 8) : '';
  return path.join(PAGES_DIR, decodeURIComponent(p), '_' + q);
}

// Assets keep their original path; query strings that are not pure cache busters
// (?ver=) are folded into the filename so query-dependent assets are retained.
function assetFile(u) {
  const url = new URL(u);
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index';
  const q = [...url.searchParams.keys()].filter((k) => k !== 'ver');
  if (q.length) {
    const h = crypto.createHash('md5').update(url.search).digest('hex').slice(0, 8);
    const ext = path.extname(p);
    p = p.slice(0, p.length - ext.length) + '.q' + h + ext;
  }
  return path.join(ASSETS_DIR, url.hostname, p);
}

function classify(u) {
  const p = new URL(u).pathname;
  if (!isInternal(u)) return 'external';
  if (/wp-admin|wp-json|xmlrpc|admin-bar|dashicons|wp-emoji|comment-reply|wp-embed/.test(p)) return 'B';
  if (/\/wp-includes\/js\/dist\//.test(p)) return 'B';
  if (/\/wp-includes\/js\/jquery\//.test(p)) return 'B';
  if (/-\d+x\d+\.(jpe?g|png|webp|gif)$/i.test(p)) return 'C?'; // responsive derivative; resolved later
  return 'A';
}

async function fetchWithRetry(u, opts = {}, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(u, { headers: { 'User-Agent': UA }, redirect: 'manual', ...opts });
      return res;
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(2000 * (i + 1));
    }
  }
}

// Follows redirects manually so they can be reported.
async function get(u) {
  let cur = u; const chain = [];
  for (let hop = 0; hop < 8; hop++) {
    const res = await fetchWithRetry(cur);
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      const next = normUrl(res.headers.get('location'), cur);
      chain.push({ from: cur, to: next, status: res.status });
      cur = next; continue;
    }
    return { res, finalUrl: cur, chain };
  }
  throw new Error('Too many redirects: ' + u);
}

// ---------------------------------------------------------------- extraction
function extractFromHtml(html, base) {
  const $ = cheerio.load(html);
  const links = new Set(); const assets = new Set();
  const add = (set, v) => { const n = v && normUrl(v.trim(), base); if (n) set.add(n); };
  $('a[href]').each((_, el) => {
    const h = $(el).attr('href');
    const n = normUrl(h, base);
    if (!n) return;
    if (isInternal(n) && ASSET_EXT.test(new URL(n).pathname)) assets.add(n); else links.add(n);
  });
  $('link[href]').each((_, el) => {
    const rel = ($(el).attr('rel') || '').toLowerCase();
    if (/stylesheet|icon|preload|apple-touch|manifest/.test(rel)) add(assets, $(el).attr('href'));
  });
  $('script[src]').each((_, el) => add(assets, $(el).attr('src')));
  $('meta[property="og:image"], meta[name="twitter:image"], meta[name="msapplication-TileImage"]').each((_, el) => add(assets, $(el).attr('content')));
  $('[src],[data-src],[data-lazy-src],[poster],[data-bg],[data-background]').each((_, el) => {
    for (const a of ['src', 'data-src', 'data-lazy-src', 'poster', 'data-bg', 'data-background']) add(assets, $(el).attr(a));
  });
  $('[srcset],[data-srcset],[data-lazy-srcset]').each((_, el) => {
    for (const a of ['srcset', 'data-srcset', 'data-lazy-srcset']) {
      const v = $(el).attr(a); if (!v) continue;
      v.split(',').forEach((part) => add(assets, part.trim().split(/\s+/)[0]));
    }
  });
  $('[style]').each((_, el) => extractCssUrls($(el).attr('style'), base).forEach((u) => assets.add(u)));
  $('style').each((_, el) => extractCssUrls($(el).html(), base).forEach((u) => assets.add(u)));
  // data-settings JSON blobs (Elementor / Essential Blocks backgrounds, sliders)
  $('[data-settings],[data-attributes]').each((_, el) => {
    const raw = ($(el).attr('data-settings') || '') + ($(el).attr('data-attributes') || '');
    for (const m of raw.matchAll(/https?:\\?\/\\?\/dia\.fi\.upm\.es[^"'\s]+?\.(?:jpe?g|png|webp|svg|gif)/gi)) add(assets, m[0].replace(/\\\//g, '/'));
  });
  return { links: [...links], assets: [...assets], title: $('title').first().text().trim() };
}

function extractCssUrls(css, base) {
  const out = new Set();
  if (!css) return [];
  for (const m of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
    if (m[2].startsWith('data:')) continue;
    const n = normUrl(m[2], base); if (n) out.add(n);
  }
  for (const m of css.matchAll(/@import\s+(?:url\()?\s*['"]([^'"]+)['"]/g)) {
    const n = normUrl(m[1], base); if (n) out.add(n);
  }
  return [...out];
}

// ---------------------------------------------------------------- assets
async function downloadAsset(u, referrer) {
  const rec = report.assets[u] || (report.assets[u] = { referencedBy: [], class: classify(u) });
  if (referrer && !rec.referencedBy.includes(referrer) && rec.referencedBy.length < 50) rec.referencedBy.push(referrer);
  if (rec.status !== undefined) return rec;
  if (!isInternal(u)) {
    const host = new URL(u).hostname;
    report.external[host] = (report.external[host] || 0) + 1;
    // Fonts/CSS/JS from well-known CDNs are needed for rendering; download them too.
    if (!/fonts\.(googleapis|gstatic)\.com|cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|use\.fontawesome\.com|unpkg\.com/.test(host)) {
      rec.status = 'external-skipped'; return rec;
    }
  }
  const file = assetFile(u);
  rec.file = path.relative(ROOT, file).replaceAll('\\', '/');
  if (fs.existsSync(file) && !REFRESH) {
    rec.status = 'cached'; rec.bytes = fs.statSync(file).size;
  } else {
    try {
      await sleep(DELAY_MS / 2);
      const { res, finalUrl, chain } = await get(u);
      if (chain.length) report.redirects.push(...chain);
      rec.status = res.status; rec.contentType = res.headers.get('content-type');
      if (!res.ok) { report.failed.push({ url: u, status: res.status, referrer }); return rec; }
      const buf = Buffer.from(await res.arrayBuffer());
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, buf); rec.bytes = buf.length;
      if (finalUrl !== u) rec.finalUrl = finalUrl;
    } catch (e) {
      rec.status = 'error'; rec.error = String(e.message || e);
      report.failed.push({ url: u, error: rec.error, referrer }); return rec;
    }
  }
  // Recurse into CSS
  if (/\.css(\?|$)/i.test(u) || /text\/css/.test(rec.contentType || '')) {
    const css = fs.readFileSync(file, 'utf8');
    for (const sub of extractCssUrls(css, rec.finalUrl || u)) await downloadAsset(sub, u);
  }
  return rec;
}

// ---------------------------------------------------------------- pages
async function loadSitemaps() {
  const urls = new Set([ORIGIN + '/', ORIGIN + '/en/', ORIGIN + '/noticias/']);
  const idx = await (await fetchWithRetry(ORIGIN + '/sitemap_index.xml')).text();
  for (const m of idx.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    await sleep(DELAY_MS);
    const sm = await (await fetchWithRetry(m[1])).text();
    for (const l of sm.matchAll(/<loc>([^<]+)<\/loc>/g)) if (!/wp-content/.test(l[1])) urls.add(normUrl(l[1]));
  }
  return [...urls];
}

async function main() {
  const queue = await loadSitemaps();
  const seen = new Set(queue);
  const browser = RENDER ? await chromium.launch() : null;
  const ctx = browser ? await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 900 } }) : null;
  let n = 0;
  while (queue.length && n < MAX) {
    const u = queue.shift(); n++;
    const dir = pageFile(u);
    const rawFile = path.join(dir, 'raw.html');
    const renderedFile = path.join(dir, 'rendered.html');
    const metaFile = path.join(dir, 'meta.json');
    const rec = report.pages[u] = { file: path.relative(ROOT, dir).replaceAll('\\', '/') };
    try {
      if (fs.existsSync(metaFile) && !REFRESH) {
        Object.assign(rec, JSON.parse(fs.readFileSync(metaFile, 'utf8')), { cached: true });
      } else {
        await sleep(DELAY_MS);
        const { res, finalUrl, chain } = await get(u);
        rec.status = res.status;
        if (chain.length) { rec.redirectedTo = finalUrl; report.redirects.push(...chain); }
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('text/html')) { rec.nonHtml = ct; fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(metaFile, JSON.stringify(rec, null, 1)); continue; }
        const html = await res.text();
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(rawFile, html);
        rec.networkResources = [];
        if (ctx && res.ok) {
          const page = await ctx.newPage();
          page.on('response', (r) => { const ru = normUrl(r.url()); if (ru && r.request().resourceType() !== 'document') rec.networkResources.push({ url: ru, status: r.status(), type: r.request().resourceType() }); });
          await page.goto(finalUrl, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
          // Scroll gradually so lazy loading / entrance animations trigger.
          await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 400) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } window.scrollTo(0, 0); });
          await page.waitForTimeout(800);
          fs.writeFileSync(renderedFile, await page.content());
          await page.close();
        }
        fs.writeFileSync(metaFile, JSON.stringify(rec, null, 1));
      }
      if (!fs.existsSync(rawFile)) continue;
      const html = fs.readFileSync(rawFile, 'utf8');
      const ex = extractFromHtml(html, u);
      const exR = fs.existsSync(renderedFile) ? extractFromHtml(fs.readFileSync(renderedFile, 'utf8'), u) : { links: [], assets: [] };
      rec.title = ex.title;
      rec.links = [...new Set([...ex.links, ...exR.links])];
      const assetSet = new Set([...ex.assets, ...exR.assets, ...(rec.networkResources || []).filter((r) => r.type !== 'xhr' && r.type !== 'fetch').map((r) => r.url)]);
      rec.assets = [...assetSet];
      for (const l of rec.links) {
        if (!isInternal(l) || SKIP_PAGE.some((re) => re.test(l)) || seen.has(l)) continue;
        seen.add(l); queue.push(l);
      }
      for (const a of rec.assets) await downloadAsset(a, u);
      console.log(`[${n}] ${rec.status ?? 'cached'} ${u} (${rec.assets.length} assets, queue ${queue.length})`);
    } catch (e) {
      rec.error = String(e.message || e);
      report.failed.push({ url: u, error: rec.error });
      console.log(`[${n}] ERROR ${u}: ${rec.error}`);
    }
  }
  if (browser) await browser.close();
  // Resolve C? (responsive derivatives): C when the original image is also downloaded.
  for (const [u, a] of Object.entries(report.assets)) {
    if (a.class !== 'C?') continue;
    const orig = u.replace(/-\d+x\d+(\.\w+)$/, '$1');
    a.class = report.assets[orig] ? 'A (srcset derivative)' : 'A';
  }
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(CACHE, 'crawl-report.json'), JSON.stringify(report, null, 1));
  writeMarkdown();
}

function writeMarkdown() {
  const pages = Object.entries(report.pages);
  const assets = Object.entries(report.assets);
  const byClass = {}; for (const [, a] of assets) byClass[a.class] = (byClass[a.class] || 0) + 1;
  const bytes = assets.reduce((s, [, a]) => s + (a.bytes || 0), 0);
  const lines = [
    '# Crawl report', '',
    `Generated by \`npm run crawl\` on ${report.finishedAt}. Raw data: \`.cache/crawl/crawl-report.json\` (not committed).`, '',
    `- Pages visited: **${pages.length}** (HTML: ${pages.filter(([, p]) => !p.nonHtml && !p.error).length})`,
    `- Assets referenced: **${assets.length}**, downloaded size ${(bytes / 1048576).toFixed(1)} MB`,
    `- Asset classes: ${Object.entries(byClass).map(([k, v]) => `${k}: ${v}`).join(', ')}`,
    '  - A = needed by final site, B = WordPress runtime/admin only, C = duplicate/obsolete derivative, external = third-party (not downloaded unless font/CDN)',
    `- Redirects: ${report.redirects.length}`, `- Failures: ${report.failed.length}`, '',
    '## Failed / broken resources', '', '| URL | Status / error | Referenced from |', '|---|---|---|',
    ...report.failed.map((f) => `| ${f.url} | ${f.status || f.error} | ${f.referrer || ''} |`), '',
    '## Redirects', '', '| From | To | Status |', '|---|---|---|',
    ...[...new Map(report.redirects.map((r) => [r.from, r])).values()].map((r) => `| ${r.from} | ${r.to} | ${r.status} |`), '',
    '## External hosts referenced', '', ...Object.entries(report.external).sort((a, b) => b[1] - a[1]).map(([h, c]) => `- ${h} (${c})`), '',
    '## Pages', '', '| URL | Status | Title |', '|---|---|---|',
    ...pages.map(([u, p]) => `| ${u} | ${p.status ?? (p.error ? 'error' : 'cached')}${p.redirectedTo ? ' → ' + p.redirectedTo : ''} | ${(p.title || '').replace(/\|/g, '/')} |`),
  ];
  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs/crawl-report.md'), lines.join('\n') + '\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
