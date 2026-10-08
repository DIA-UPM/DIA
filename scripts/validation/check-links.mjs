// `npm run check-links` — static link & asset checker for the built site (dist/).
//
// Checks every HTML page and CSS file for:
//   - internal links to pages that do not exist           (broken internal links)
//   - missing images / CSS / JS / fonts / documents       (missing assets)
//   - #anchors that do not exist in the target page       (invalid anchors)
//   - references to WordPress runtime paths               (/wp-admin/, /wp-json/, /wp-includes/, /wp-content/)
//   - references to the old host dia.fi.upm.es for assets (the site must not depend on WordPress)
// With --external it also requests every external link (HEAD/GET, cached, 1 request at a time).
//
// Links that were ALREADY broken on the original WordPress site are listed in
// scripts/validation/known-broken.json: they are reported as warnings, not errors.
// Exit code 1 when any error is found. A JSON report is written to reports/links.json.
import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { siteConfig } from '../build/site-config.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const DIST = path.join(ROOT, 'dist');
const EXTERNAL = process.argv.includes('--external');
// dist/ may have been built for a sub-path (SITE_URL / BASE_PATH, see scripts/build/site-config.mjs)
const { url: SITE_URL, basePath: BASE } = siteConfig();
const SITE_HOST = new URL(SITE_URL).hostname;
const known = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'known-broken.json'), 'utf8'));
const norm = (u) => String(u).replace(/&nbsp;| /g, ' ').replace(/s+/g, ' ').trim();
const knownSet = new Set(known.links.map((k) => norm(k.url)));

const walk = (dir, out = []) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p, out); else out.push(p); } return out; };
const files = walk(DIST);
const htmlFiles = files.filter((f) => f.endsWith('.html'));
const cssFiles = files.filter((f) => f.endsWith('.css'));
const urlOf = (file) => BASE + path.relative(DIST, file).replaceAll('\\', '/').replace(/index\.html$/, '');

const errors = []; const warnings = []; const external = new Map();
const idsCache = new Map();
const idsOf = (file) => {
  if (!idsCache.has(file)) {
    const $ = cheerio.load(fs.readFileSync(file, 'utf8'));
    idsCache.set(file, new Set([...$('[id]').map((_, e) => $(e).attr('id')).get(), ...$('a[name]').map((_, e) => $(e).attr('name')).get()]));
  }
  return idsCache.get(file);
};
function resolveLocal(pathname) {
  if (!pathname.startsWith(BASE)) return null;
  const p = decodeURIComponent(pathname.slice(BASE.length - 1));
  const full = path.join(DIST, p);
  if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
  if (fs.existsSync(path.join(full, 'index.html'))) return path.join(full, 'index.html');
  return null;
}
function report(kind, from, url, detail) {
  const entry = { kind, from, url, detail };
  const key = BASE !== '/' && String(url).startsWith(BASE) ? String(url).slice(BASE.length - 1) : url; // known-broken.json lists paths without the base path
  if (knownSet.has(norm(key))) warnings.push({ ...entry, known: known.links.find((k) => norm(k.url) === norm(key)).reason });
  else errors.push(entry);
}

function checkRef(raw, from, kind, { anchorsFor } = {}) {
  if (!raw) return;
  const ref = raw.trim();
  if (/^(mailto:|tel:|javascript:|data:)/i.test(ref) || ref === '') return;
  let u;
  try { u = new URL(ref, 'http://local' + from); } catch { report('invalid-url', from, ref); return; }
  if (u.hostname === 'dia.fi.upm.es' && /\/wp-(content|includes|admin|json)\//.test(u.pathname)) { report('wordpress-dependency', from, ref); return; }
  // Absolute links to the site's own domain are internal once the static site is deployed there.
  if (u.hostname === SITE_HOST) u = new URL(u.pathname + u.search + u.hash, 'http://local');
  if (u.hostname !== 'local') {
    if (u.protocol.startsWith('http')) { if (!external.has(u.href)) external.set(u.href, new Set()); external.get(u.href).add(from); }
    return;
  }
  if (/^\/(wp-admin|wp-json|wp-includes|wp-content)\//.test(u.pathname.slice(BASE.length - 1)) || /xmlrpc\.php/.test(u.pathname)) { report('wordpress-dependency', from, ref); return; }
  const target = resolveLocal(u.pathname);
  if (!target) { report(kind, from, u.pathname + u.search); return; }
  if (u.hash && u.hash.length > 1 && target.endsWith('.html') && anchorsFor) {
    const id = decodeURIComponent(u.hash.slice(1));
    if (!idsOf(target).has(id)) report('invalid-anchor', from, u.pathname + u.hash);
  }
}

for (const file of htmlFiles) {
  const from = urlOf(file);
  const $ = cheerio.load(fs.readFileSync(file, 'utf8'));
  $('a[href]').each((_, e) => checkRef($(e).attr('href'), from, 'broken-link', { anchorsFor: true }));
  $('link[href]').each((_, e) => { const rel = $(e).attr('rel') || ''; if (/canonical|alternate/.test(rel)) return; checkRef($(e).attr('href'), from, 'missing-asset'); });
  $('script[src]').each((_, e) => checkRef($(e).attr('src'), from, 'missing-asset'));
  $('img[src], source[src], video[src], iframe[src], iframe[data-src]').each((_, e) => checkRef($(e).attr('src') || $(e).attr('data-src'), from, 'missing-asset'));
  $('[srcset]').each((_, e) => $(e).attr('srcset').split(',').forEach((s) => checkRef(s.trim().split(/\s+/)[0], from, 'missing-asset')));
  $('[style]').each((_, e) => { for (const m of ($(e).attr('style') || '').matchAll(/url\(['"]?([^'")]+)['"]?\)/g)) checkRef(m[1], from, 'missing-asset'); });
  $('[data-video-bg-mp4],[data-video-bg-poster]').each((_, e) => { checkRef($(e).attr('data-video-bg-mp4'), from, 'missing-asset'); checkRef($(e).attr('data-video-bg-poster'), from, 'missing-asset'); });
  $('meta[property="og:image"]').each((_, e) => checkRef($(e).attr('content'), from, 'missing-asset'));
}
for (const file of cssFiles) {
  const from = urlOf(file);
  const css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) checkRef(m[1], from, 'missing-asset');
}
// Plain-text scan for leftovers of the old host in the output (outside links, which are content)
for (const file of [...htmlFiles, ...cssFiles, ...files.filter((f) => f.endsWith('.js'))]) {
  const txt = fs.readFileSync(file, 'utf8');
  for (const m of txt.matchAll(/(?:https?:)?\/\/dia\.fi\.upm\.es\/(wp-(?:content|includes|admin|json)\/[^"'\s)]*)/g)) report('wordpress-dependency', urlOf(file), m[0]);
}

async function checkExternal() {
  const cacheFile = path.join(ROOT, '.cache/external-links.json');
  const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
  for (const [url, froms] of external) {
    if (!(url in cache)) {
      let status;
      try {
        let res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0 (link-check)' } });
        if (res.status >= 400) res = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0 (link-check)' } });
        status = res.status;
      } catch (e) { status = 'error: ' + (e.cause?.code || e.name); }
      cache[url] = status;
      fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 1));
      await new Promise((r) => setTimeout(r, 300));
    }
    const st = cache[url];
    if (typeof st !== 'number' || st >= 400) warnings.push({ kind: 'external-link', url, detail: String(st), from: [...froms].slice(0, 5).join(', '), known: 'external site (content of the original site; not a migration defect)' });
  }
}

if (EXTERNAL) await checkExternal();
fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'reports/links.json'), JSON.stringify({ checkedPages: htmlFiles.length, checkedCss: cssFiles.length, externalLinks: external.size, errors, warnings }, null, 2));
const group = (list) => { const g = {}; for (const e of list) (g[`${e.kind}: ${e.url}`] ||= []).push(e.from); return g; };
console.log(`Checked ${htmlFiles.length} pages, ${cssFiles.length} CSS files, ${external.size} distinct external links${EXTERNAL ? '' : ' (not requested; use --external)'}.`);
if (warnings.length) {
  console.log(`\n⚠ ${Object.keys(group(warnings)).length} warning(s) (already broken on the original site or external):`);
  for (const [k, v] of Object.entries(group(warnings))) console.log(`  - ${k}  (from ${[...new Set(v)].slice(0, 3).join(', ')}${v.length > 3 ? ', …' : ''})`);
}
if (errors.length) {
  console.log(`\n✖ ${Object.keys(group(errors)).length} error(s):`);
  for (const [k, v] of Object.entries(group(errors))) console.log(`  - ${k}  (from ${[...new Set(v)].slice(0, 3).join(', ')}${v.length > 3 ? ', …' : ''})`);
  process.exit(1);
}
console.log('\n✔ No broken internal links, missing assets, invalid anchors or WordPress dependencies.');
