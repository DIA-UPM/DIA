// Shared helpers for the one-off migration scripts (scripts/migrate/*).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROOT = path.resolve(import.meta.dirname, '../..');
export const CACHE = path.join(ROOT, '.cache/crawl');
export const ORIGIN = 'https://dia.fi.upm.es';
const UA = 'Mozilla/5.0 (compatible; DIA-static-migration/1.0; polite crawler)';

// Must stay in sync with assetFile() in scripts/crawl/crawl.mjs.
export function cachedAssetFile(u) {
  const url = new URL(u);
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index';
  const q = [...url.searchParams.keys()].filter((k) => k !== 'ver');
  if (q.length) {
    const h = crypto.createHash('md5').update(url.search).digest('hex').slice(0, 8);
    const ext = path.extname(p);
    p = p.slice(0, p.length - ext.length) + '.q' + h + ext;
  }
  return path.join(CACHE, 'assets', url.hostname, p);
}

let lastFetch = 0;
const MISSING_FILE = path.join(CACHE, 'missing-assets.json');
const missing = fs.existsSync(MISSING_FILE) ? JSON.parse(fs.readFileSync(MISSING_FILE, 'utf8')) : {};
/** Downloads an asset once (cached; 404s are remembered too so they are not retried). */
export async function fetchAssetPolitely(u) {
  const file = cachedAssetFile(u);
  if (fs.existsSync(file)) return file;
  if (missing[u]) return null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = 700 * (attempt + 1) - (Date.now() - lastFetch);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastFetch = Date.now();
    try {
      const res = await fetch(u, { headers: { 'User-Agent': UA } });
      if (!res.ok) {
        console.warn(`  ! ${res.status} ${u}`);
        missing[u] = res.status; fs.writeFileSync(MISSING_FILE, JSON.stringify(missing, null, 1));
        return null;
      }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      return file;
    } catch (e) {
      if (attempt === 3) throw e;
    }
  }
  return null;
}

/**
 * Maps an original absolute URL to its path in the static site (or null when the
 * resource stays external). Layout:
 *   /wp-content/uploads/Y/M/file            → /assets/uploads/Y/M/file
 *   /wp-content/astra-local-fonts/1/fam/f   → /assets/fonts/fam/f
 *   fonts.gstatic.com/s/fam/vN/f            → /assets/fonts/fam/f
 *   plugin/theme fonts (font awesome, …)    → /assets/fonts/<plugin>/f
 *   plugin/theme images                     → /assets/images/<plugin>/f
 */
export function localAssetPath(abs) {
  let url; try { url = new URL(abs); } catch { return null; }
  const p = decodeURIComponent(url.pathname);
  const ext = path.extname(p).toLowerCase();
  const variant = (file) => {
    const q = [...url.searchParams.keys()].filter((k) => k !== 'ver');
    if (!q.length) return file;
    const h = crypto.createHash('md5').update(url.search).digest('hex').slice(0, 8);
    const e = path.extname(file);
    return file.slice(0, file.length - e.length) + '.q' + h + e;
  };
  if (url.hostname === 'fonts.gstatic.com') {
    const m = p.match(/^\/s\/([^/]+)\/[^/]+\/(.+)$/);
    return m ? `/assets/fonts/${m[1]}/${m[2]}` : null;
  }
  if (url.hostname !== 'dia.fi.upm.es') return null;
  let m;
  if ((m = p.match(/^\/wp-content\/uploads\/(\d{4}\/\d{2}\/.+)$/))) return '/assets/uploads/' + m[1];
  if ((m = p.match(/^\/wp-content\/astra-local-fonts\/\d+\/(.+)$/))) return '/assets/fonts/' + m[1];
  const plugin = (p.match(/^\/wp-content\/(?:plugins|themes)\/([^/]+)\//) || p.match(/^\/(wp-includes)\//) || [])[1];
  if (/\.(woff2?|ttf|otf|eot)$/.test(ext) || (ext === '.svg' && /fonts?\//.test(p))) return `/assets/fonts/${plugin || 'misc'}/${variant(path.basename(p))}`;
  if (/\.(png|jpe?g|gif|svg|webp|avif|ico|cur)$/.test(ext)) return `/assets/images/${plugin || 'misc'}/${variant(path.basename(p))}`;
  if ((m = p.match(/^\/wp-content\/uploads\/(.+)$/))) return '/assets/uploads/' + m[1];
  return null;
}

/** Groups crawled pages by template, using the WordPress <body> classes. */
export function pageGroup(url, raw) {
  const cls = new Set(((raw.match(/<body[^>]*class="([^"]*)"/) || [])[1] || '').split(/\s+/));
  const p = new URL(url).pathname;
  if (p === '/') return 'home';
  if (p.startsWith('/en/')) return 'en';
  if (cls.has('single-personaldia')) return 'personal';
  if (cls.has('post-type-archive-personaldia')) return 'personal-archive';
  if (cls.has('single-post')) return 'post';
  if (cls.has('archive') || cls.has('blog') || cls.has('search')) return 'archive';
  if (cls.has('page')) return ({ 'el-departamento-de-inteligencia-artificial-presentacion': 'presentacion', investigacion_dia: 'investigacion' })[p.split('/').filter(Boolean).pop()] || p.split('/').filter(Boolean).pop();
  if (cls.has('error404')) return '404';
  return 'other';
}

/**
 * Cleans a fragment of WordPress-generated HTML for storage in JSON / templates:
 * removes comments and WP-only attributes, rewrites internal page links to
 * root-relative URLs and media to the local /assets/ layout.
 * `usedAssets` (Set) collects every original asset URL that is referenced.
 */
export function cleanHtml(html, usedAssets = new Set()) {
  const mapUrl = (u) => {
    if (!u) return u;
    let abs;
    try { abs = new URL(u.replace(/&amp;/g, '&'), ORIGIN + '/').href; } catch { return u; }
    const url = new URL(abs);
    if (url.hostname !== 'dia.fi.upm.es' && url.hostname !== 'fonts.gstatic.com') return u;
    const local = localAssetPath(abs);
    if (local) { usedAssets.add(abs); return local; }
    if (url.hostname === 'dia.fi.upm.es' && (u.startsWith('http') || u.startsWith('//') || u.startsWith('/'))) {
      return (url.pathname + url.search + url.hash) || '/';
    }
    return u;
  };
  let out = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s(data-querydata|data-attributes|itemprop|itemtype|itemscope|data-ast-blocks-layout)(="[^"]*")?/g, '')
    .replace(/\s(href|src|poster|data-src|action)="([^"]*)"/g, (m, a, v) => ` ${a}="${mapUrl(v)}"`)
    .replace(/\s(srcset|data-srcset)="([^"]*)"/g, (m, a, v) => ` ${a}="${v.split(',').map((part) => { const [u, ...rest] = part.trim().split(/\s+/); return [mapUrl(u), ...rest].join(' '); }).join(', ')}"`)
    .replace(/url\((['"]?)([^'")]+)\1\)/g, (m, q, v) => `url(${q}${mapUrl(v)}${q})`);
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
