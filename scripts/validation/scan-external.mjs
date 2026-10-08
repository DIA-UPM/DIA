// Lists every URL in dist/ that points outside the site, split into
//   * resources the browser loads automatically (img, srcset, css, js, fonts, video, iframe…) — must be none
//     except intentional embeds;
//   * outbound links (<a href>) and metadata (canonical, og:url, JSON-LD, sitemap) — fine.
// Usage: node scripts/validation/scan-external.mjs [--dir dist]
import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';

const ROOT = path.resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const DIR = path.resolve(ROOT, args.includes('--dir') ? args[args.indexOf('--dir') + 1] : 'dist');
const abs = /^(https?:)?\/\//i;
const host = (u) => { try { return new URL(u, 'https://x').host; } catch { return u; } };

const resources = new Map(); // host -> Set(kind)
const links = new Map();
const add = (map, u, kind, file) => {
  const h = host(u); if (!map.has(h)) map.set(h, { kinds: new Set(), files: new Set(), samples: new Set() });
  const e = map.get(h); e.kinds.add(kind); e.files.add(file); if (e.samples.size < 3) e.samples.add(u);
};
const cssUrls = (css) => [...css.matchAll(/url\(\s*['"]?([^'")]+)/g), ...css.matchAll(/@import\s+['"]([^'"]+)/g)].map((m) => m[1]);

function walk(d) { return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])); }
for (const file of walk(DIR)) {
  const rel = path.relative(DIR, file).split(path.sep).join('/');
  const ext = path.extname(file);
  if (ext === '.html') {
    const $ = cheerio.load(fs.readFileSync(file, 'utf8'));
    $('[src]').each((_, el) => { const u = $(el).attr('src'); if (abs.test(u)) add(resources, u, `<${el.tagName} src>`, rel); });
    $('[srcset]').each((_, el) => { for (const part of $(el).attr('srcset').split(',')) { const u = part.trim().split(/\s+/)[0]; if (abs.test(u)) add(resources, u, `<${el.tagName} srcset>`, rel); } });
    $('[poster],[data-src],[data-bg],[data-video],[data-url]').each((_, el) => { for (const a of ['poster', 'data-src', 'data-bg', 'data-video', 'data-url']) { const u = $(el).attr(a); if (u && abs.test(u)) add(resources, u, `<${el.tagName} ${a}>`, rel); } });
    $('link[href]').each((_, el) => { const u = $(el).attr('href'); const r = ($(el).attr('rel') || '').toLowerCase(); if (!abs.test(u)) return; if (/stylesheet|icon|preload|prefetch|preconnect|dns-prefetch|manifest|modulepreload/.test(r)) add(resources, u, `<link rel=${r}>`, rel); else add(links, u, `<link rel=${r}>`, rel); });
    $('[style]').each((_, el) => { for (const u of cssUrls($(el).attr('style'))) if (abs.test(u)) add(resources, u, 'style url()', rel); });
    $('style').each((_, el) => { for (const u of cssUrls($(el).text())) if (abs.test(u)) add(resources, u, '<style> url()', rel); });
    $('a[href], area[href], form[action]').each((_, el) => { const u = $(el).attr('href') || $(el).attr('action'); if (abs.test(u)) add(links, u, `<${el.tagName}>`, rel); });
    $('meta[content]').each((_, el) => { const u = $(el).attr('content'); if (abs.test(u)) add(links, u, `<meta ${$(el).attr('property') || $(el).attr('name') || $(el).attr('http-equiv')}>`, rel); });
  } else if (ext === '.css') {
    for (const u of cssUrls(fs.readFileSync(file, 'utf8'))) if (abs.test(u)) add(resources, u, 'css url()', rel);
  } else if (ext === '.js') {
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/['"`](https?:\/\/[^'"`\s]+)/g)) add(resources, m[1], 'js string', rel);
  }
}
const print = (title, map) => {
  console.log(`\n${title}: ${map.size} host(s)`);
  for (const [h, e] of [...map].sort((a, b) => b[1].files.size - a[1].files.size)) console.log(`  ${h.padEnd(34)} ${String(e.files.size).padStart(4)} file(s)  ${[...e.kinds].join(', ')}\n      e.g. ${[...e.samples].join('  ')}`);
};
print('External RESOURCES loaded by the browser', resources);
if (args.includes('--links')) print('Outbound links / metadata', links);
