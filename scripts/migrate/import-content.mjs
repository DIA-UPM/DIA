// One-off migration tool: converts the crawled WordPress pages (.cache/crawl) into the
// editable JSON content of the static site.
//
//   data/news/<slug>.json        one file per news post (title, dates, image, tags, excerpt, HTML body)
//   data/personnel/<slug>.json   one file per person (ACF fields of the "personaldia" post type)
//   data/taxonomies.json         tags, category and authors (names + archive settings)
//
// Hand-structured pages (home, presentación, investigación, contacto, …) live in their own
// JSON files under data/ and were written from the audit, not by this script.
//
// It never overwrites an existing data file unless --force is passed, so it is safe to re-run.
// Usage: node scripts/migrate/import-content.mjs [--force]
import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { ROOT, CACHE, ORIGIN, cleanHtml, localAssetPath, pageGroup, cachedAssetFile } from './lib.mjs';

const FORCE = process.argv.includes('--force');
const report = JSON.parse(fs.readFileSync(path.join(CACHE, 'crawl-report.json'), 'utf8'));
const usedAssets = new Set();
const log = [];

const pages = Object.entries(report.pages)
  .filter(([u, p]) => p.file && !new URL(u).search && fs.existsSync(path.join(ROOT, p.file, 'raw.html')))
  .map(([url, p]) => {
    const raw = fs.readFileSync(path.join(ROOT, p.file, 'raw.html'), 'utf8');
    return { url, status: p.status, raw, $: cheerio.load(raw, { decodeEntities: true }), group: p.status === 200 ? pageGroup(url, raw) : '404' };
  });

const text = (s) => (s || '').replace(/\s+/g, ' ').trim();
const meta = ($, sel) => $(sel).attr('content') || '';
const slugOf = (url) => decodeURIComponent(new URL(url).pathname).split('/').filter(Boolean).pop();
const jsonLd = ($) => { try { return JSON.parse($('script.yoast-schema-graph').html() || $('script[type="application/ld+json"]').first().html() || '{}'); } catch { return {}; } };
const graphNode = (ld, type) => (ld['@graph'] || []).find((n) => [].concat(n['@type']).includes(type)) || {};
const local = (u) => { if (!u) return ''; const abs = new URL(u, ORIGIN + '/').href; const l = localAssetPath(abs); if (l) { usedAssets.add(abs); return l; } return u; };
const innerClean = ($, el) => cleanHtml($(el).html() || '', usedAssets).trim();

function seoOf($) {
  return {
    title: text($('title').first().text()),
    description: meta($, 'meta[name="description"]') || undefined,
    ogTitle: meta($, 'meta[property="og:title"]') || undefined,
    ogType: meta($, 'meta[property="og:type"]') || undefined,
    image: meta($, 'meta[property="og:image"]') ? local(meta($, 'meta[property="og:image"]')) : undefined,
    publishedTime: meta($, 'meta[property="article:published_time"]') || undefined,
    modifiedTime: meta($, 'meta[property="article:modified_time"]') || undefined,
    robots: meta($, 'meta[name="robots"]') || undefined,
  };
}

function writeJson(rel, obj) {
  const file = path.join(ROOT, 'data', rel);
  if (fs.existsSync(file) && !FORCE) { log.push(`kept existing ${rel}`); return; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, (k, v) => (v === undefined ? undefined : v), 2) + '\n');
}

function bannerImageOf(raw) {
  for (const m of raw.matchAll(/href=["']([^"']*wpfc-minified[^"']+\.css)["']/g)) {
    const file = cachedAssetFile(new URL(m[1], ORIGIN).href);
    if (!fs.existsSync(file)) continue;
    const hit = fs.readFileSync(file, 'utf8').match(/data-banner-background-type="featured"\]\{background:url\(([^)]+)\)/);
    if (hit) return local(hit[1].replace(/['"]/g, ''));
  }
  return undefined;
}

// ------------------------------------------------------------------ archive listing data
// Excerpts, thumbnails and reading times are only visible in the archive listings.
const listing = new Map(); // post slug → { excerptHtml, thumbnail, readingTime, wpId }
for (const pg of pages.filter((p) => p.status === 200 && /^\/(noticias|personaldia)\/(page\/\d+\/)?$/.test(new URL(p.url).pathname))) {
  const $ = pg.$;
  $('article.ast-archive-post').each((_, a) => {
    const href = $(a).find('.post-thumb a, h2 a').first().attr('href');
    if (!href) return;
    const slug = slugOf(new URL(href, ORIGIN).href);
    const img = $(a).find('.post-thumb img').first();
    const ex = $(a).find('.ast-excerpt-container').clone();
    listing.set(slug, {
      kind: pg.url.includes('/personaldia/') ? 'person' : 'news',
      wpId: Number(($(a).attr('id') || '').replace('post-', '')) || undefined,
      excerptHtml: cleanHtml(ex.html() || '', usedAssets).trim(),
      readingTime: text($(a).find('.ast-reading-time').text()) || undefined,
      thumbnail: img.length ? { src: local(img.attr('src')), width: Number(img.attr('width')), height: Number(img.attr('height')), alt: img.attr('alt') || '' } : undefined,
      title: text($(a).find('.entry-title, h2').first().text()),
      date: text($(a).find('.published').text()),
      tags: ($(a).attr('class') || '').split(/\s+/).filter((c) => c.startsWith('tag-')).map((c) => c.slice(4)),
      categories: ($(a).attr('class') || '').split(/\s+/).filter((c) => c.startsWith('category-')).map((c) => c.slice(9)),
    });
  });
}

// ------------------------------------------------------------------ news posts
const newsSlugs = new Set();
for (const pg of pages.filter((p) => p.group === 'post')) {
  const $ = pg.$;
  const slug = slugOf(pg.url);
  const ld = jsonLd($);
  const article = graphNode(ld, 'Article');
  const art = $('article.post').first();
  const classes = (art.attr('class') || '').split(/\s+/);
  const imgUrl = graphNode(ld, 'ImageObject').url || article.thumbnailUrl || meta($, 'meta[property="og:image"]');
  const lst = listing.get(slug) || {};
  const content = $('.entry-content').first();
  newsSlugs.add(slug);
  // The header banner shows the image Astra put in the page CSS, which can differ from the
  // (edited) featured image used in listings.
  const banner = bannerImageOf(pg.raw);
  writeJson(`news/${slug}.json`, {
    slug,
    title: text($('h1.entry-title').first().text()),
    date: meta($, 'meta[property="article:published_time"]') || article.datePublished,
    modified: meta($, 'meta[property="article:modified_time"]') || article.dateModified || undefined,
    author: (article.author && article.author.name) || undefined,
    categories: classes.filter((c) => c.startsWith('category-')).map((c) => c.slice(9)),
    tags: classes.filter((c) => c.startsWith('tag-')).map((c) => c.slice(4)),
    image: imgUrl ? { src: local(imgUrl), width: Number(meta($, 'meta[property="og:image:width"]')) || undefined, height: Number(meta($, 'meta[property="og:image:height"]')) || undefined, alt: lst.thumbnail?.alt ?? '' } : undefined,
    bannerImage: banner && imgUrl && banner !== local(imgUrl) ? banner : undefined,
    thumbnail: lst.thumbnail,
    readingTime: lst.readingTime,
    excerptHtml: lst.excerptHtml,
    contentHtml: innerClean($, content),
    seo: seoOf($),
    wpId: lst.wpId || Number((art.attr('id') || '').replace('post-', '')) || undefined,
  });
}
// Posts listed on the site whose own page returns 404 on the live site (kept as listing-only).
for (const [slug, lst] of listing) {
  if (newsSlugs.has(slug) || lst.kind !== 'news') continue;
  log.push(`listing-only post (its page is 404 on the live site): ${slug}`);
  writeJson(`news/${slug}.json`, {
    slug, title: lst.title, date: undefined, dateLabel: lst.date, publishPage: false,
    categories: lst.categories, tags: lst.tags, thumbnail: lst.thumbnail, readingTime: lst.readingTime, excerptHtml: lst.excerptHtml, wpId: lst.wpId,
  });
}

// ------------------------------------------------------------------ personnel
const FIELD = { 'Despacho': 'office', 'Web': 'web', 'Teléfono': 'phone', 'ORCID': 'orcid', 'Email': 'email', 'ResearcherID': 'researcherId', 'Grupo de investigación': 'researchGroup', 'Scopus Author ID': 'scopusId' };
for (const pg of pages.filter((p) => p.group === 'personal')) {
  const $ = pg.$;
  const slug = slugOf(pg.url);
  const person = { slug, name: text($('h1.entry-title').first().text()) };
  const img = $('img.my-custom-image').first();
  person.image = img.length ? local(img.attr('src')) : '';
  $('.eb-feature-list-item .eb-feature-list-title').each((_, h) => {
    const label = text($(h).contents().first().text()).replace(/:\s*$/, '').replace(/:.*/, '');
    const key = FIELD[label];
    if (!key) { log.push(`${slug}: unknown field "${label}"`); return; }
    const a = $(h).find('a').first();
    if (key === 'researchGroup') person[key] = a.length ? { name: text(a.text()), url: cleanHtml(`<a href="${a.attr('href')}">`, usedAssets).match(/href="([^"]*)"/)[1] } : null;
    else if (key === 'email') person[key] = a.length ? text(a.text()) : text($(h).text().replace(/^[^:]*:/, ''));
    else person[key] = a.length ? a.attr('href') : text($(h).text().replace(/^[^:]*:/, ''));
  });
  // Biography: the paragraphs after the fields block (the empty <p> spacers belong to the template).
  // (template: row of fields, then <p></p> + biography + <p></p> inside the same wrapper).
  const inner = $('.entry-content .eb-wrapper-inner-blocks').first();
  person.biography = [];
  inner.children().not('.wp-block-essential-blocks-row').each((_, el) => {
    const h = el.tagName === 'p' ? cleanHtml($(el).html() || '', usedAssets).trim() : cleanHtml($.html(el), usedAssets).trim();
    if (!h) return;
    if (el.tagName !== 'p') log.push(`${slug}: biography contains a <${el.tagName}> element (kept as HTML)`);
    person.biography.push(el.tagName === 'p' ? h : { html: h });
  });
  const lst = listing.get(slug) || {};
  const ld = jsonLd($);
  person.category = (lst.tags || [])[0] || null;
  if ((lst.tags || []).length > 1) person.categories = lst.tags;
  person.date = graphNode(ld, 'WebPage').datePublished || undefined;
  person.thumbnail = lst.thumbnail;
  person.readingTime = lst.readingTime;
  person.seo = seoOf($);
  writeJson(`personnel/${slug}.json`, person);
}

// ------------------------------------------------------------------ taxonomies
const tax = { tags: [], categories: [], authors: [] };
for (const pg of pages.filter((p) => /^\/(tag|category|author)\/[^/]+\/$/.test(new URL(p.url).pathname))) {
  const $ = pg.$;
  const [, kind, slug] = new URL(pg.url).pathname.split('/');
  const name = text($('.ast-archive-entry-banner h1, h1.page-title').first().text());
  const entry = { slug, name, archive: pg.status === 200, seo: pg.status === 200 ? seoOf($) : undefined };
  if (kind === 'tag') tax.tags.push(entry);
  else if (kind === 'category') tax.categories.push(entry);
  else {
    entry.banner = $('.ast-archive-entry-banner').length > 0;
    entry.posts = $('article.ast-archive-post').map((_, a) => slugOf(new URL($(a).find('h2 a, .post-thumb a').first().attr('href'), ORIGIN).href)).get();
    tax.authors.push(entry);
  }
}
writeJson('taxonomies.json', tax);

fs.writeFileSync(path.join(CACHE, 'content-assets.json'), JSON.stringify([...usedAssets].sort(), null, 1));
console.log(log.join('\n'));
console.log(`news: ${newsSlugs.size} pages + listing-only; personnel: ${pages.filter((p) => p.group === 'personal').length}; assets referenced: ${usedAssets.size}`);
