// Static site build: data/*.json  →  src/templates/*.njk  →  dist/
//
//   1. load + validate every JSON file (fails with file/field specific errors)
//   2. render one HTML file per route (directory URLs: /contacto/ → dist/contacto/index.html)
//   3. copy public/ (images, fonts, documents) and src/css, src/js to dist/assets
//   4. write sitemap.xml and robots.txt
//   Root paths ("/assets/…") get the base path of SITE_URL / BASE_PATH (see site-config.mjs).
//
// Usage: node scripts/build/build.mjs [--out dist]
import fs from 'node:fs';
import path from 'node:path';
import nunjucks from 'nunjucks';
import { loadAndValidate } from '../validation/validate.mjs';
import { buildRoutes } from './routes.mjs';
import { siteConfig, withBase, withBaseHtml, withBaseCss } from './site-config.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const OUT = path.resolve(ROOT, args.includes('--out') ? args[args.indexOf('--out') + 1] : 'dist');

export async function build({ out = OUT, quiet = false } = {}) {
  const t0 = Date.now();
  const data = loadAndValidate(ROOT); // throws ValidationError with a readable report
  const site = data.site;
  // Public URL + base path ("/" or e.g. "/repo/" on GitHub Pages); env SITE_URL / BASE_PATH override data/site.json
  const { url: siteUrl, basePath } = siteConfig(site);
  site.url = siteUrl;

  const env = nunjucks.configure(path.join(ROOT, 'src/templates'), { autoescape: true, throwOnUndefined: false, trimBlocks: true, lstripBlocks: true });
  const isExternal = (u) => /^https?:\/\//.test(u) && !u.startsWith(site.url);
  const link = (u) => (u && u.startsWith(site.url) ? u.slice(site.url.length - 1) || '/' : u);
  const cssManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/css/manifest.json'), 'utf8'));
  const version = Date.now().toString(36);
  const asset = (p) => `${p}?v=${version}`;
  env.addGlobal('link', link);
  env.addGlobal('basePath', basePath);
  env.addGlobal('asset', asset);
  env.addGlobal('isExternal', isExternal);
  env.addGlobal('isLink', (v) => /^https?:\/\/[^/\s]+\.[^/\s]+/.test(v || ''));
  // People of the given categories, sorted by name like WordPress' "orderby title" (Spanish collation).
  env.addGlobal('peopleFor', (tags) => Object.values(data.personnel)
    .filter((p) => [p.category, ...(p.categories || [])].some((c) => tags.includes(c)))
    .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })));
  env.addGlobal('absoluteUrl', (u) => (/^https?:/.test(u) ? u : site.url.replace(/\/$/, '') + u));
  env.addGlobal('buildYear', String(new Date().getFullYear()));
  // WordPress marks a menu item as current when its URL (without #fragment) is the current page.
  const samePage = (u, page) => !!u && u !== '#' && link(u).split('#')[0] === (page.menuUrl || page.url);
  env.addGlobal('isCurrent', (item, page) => samePage(item.url, page));
  env.addGlobal('isMenuParent', (item, page) => !!page.menuParent && !!item.url && link(item.url) === page.menuParent);
  const isAncestor = (item, page) => (item.children || []).some((c) => samePage(c.url, page) || isAncestor(c, page));
  env.addGlobal('isAncestor', isAncestor);
  env.addGlobal('structuredData', (page) => JSON.stringify(structuredData(site, page)).replace(/</g, '\\u003c'));
  env.addFilter('dateEs', (iso) => new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' }));
  for (const [k, v] of Object.entries(data)) env.addGlobal(k, v);

  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  const routes = buildRoutes(data);
  for (const route of routes) {
    const page = { ...route.page, url: route.url };
    const group = cssManifest.groups[page.css];
    if (!group) throw new Error(`Unknown CSS group "${page.css}" for ${route.url} (see src/css/manifest.json)`);
    const cssFiles = [...group.map((f) => asset(`/assets/css/${f}`)), asset('/assets/css/site.css')];
    let html;
    try {
      html = env.render(route.template, { ...route.context, page, cssFiles });
    } catch (e) {
      throw new Error(`Template error while rendering ${route.url} (${route.template}): ${e.message}`);
    }
    const file = route.file ? path.join(out, route.file) : path.join(out, decodeURIComponent(route.url), 'index.html');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, withBaseHtml(tidy(html), basePath));
  }

  // Redirect pages for old URLs (the server should ideally answer with a 301, see docs/url-migration.md)
  for (const r of data.redirects?.redirects || []) {
    const file = path.join(out, r.from, 'index.html');
    if (fs.existsSync(file)) throw new Error(`data/redirects.json: "${r.from}" is also a page of the site`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const target = withBase(r.to, basePath);
    const to = target.replace(/"/g, '&quot;');
    fs.writeFileSync(file, `<!DOCTYPE html>\n<html lang="es-ES"><head><meta charset="UTF-8"><title>Redirigiendo…</title><meta name="robots" content="noindex"><link rel="canonical" href="${to}"><meta http-equiv="refresh" content="0; url=${to}"></head><body><p>Esta página se ha movido a <a href="${to}">${to}</a>.</p><script>location.replace(${JSON.stringify(target)} + location.hash);</script></body></html>\n`);
  }

  // Static assets
  copyDir(path.join(ROOT, 'public'), out);
  copyDir(path.join(ROOT, 'src/css'), path.join(out, 'assets/css'), (f) => f.endsWith('.css'));
  copyDir(path.join(ROOT, 'src/js'), path.join(out, 'assets/js'), (f) => f.endsWith('.js'));
  if (basePath !== '/') for (const f of fs.readdirSync(path.join(out, 'assets/css'), { recursive: true }).filter((f) => f.endsWith('.css'))) {
    const p = path.join(out, 'assets/css', f);
    fs.writeFileSync(p, withBaseCss(fs.readFileSync(p, 'utf8'), basePath));
  }
  // GitHub Pages: serve the files as they are (no Jekyll processing)
  fs.writeFileSync(path.join(out, '.nojekyll'), '');

  // client-side search index (/buscar/)
  const strip = (h) => (h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  const index = [
    ...Object.values(data.news).filter((n) => n.publishPage !== false).map((n) => ({ url: `/${n.slug}/`, title: n.title, date: new Date(n.date).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' }), image: n.thumbnail?.src, text: strip(n.contentHtml) })),
    ...Object.values(data.personnel).map((p) => ({ url: `/personaldia/${p.slug}/`, title: p.name, image: p.thumbnail?.src, text: strip([p.email, p.office, p.researchGroup?.name, ...p.biography.map((b) => b.html || b)].join(' ')) })),
  ];
  fs.mkdirSync(path.join(out, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(out, 'assets/search-index.json'), JSON.stringify(index.map((it) => ({ ...it, url: withBase(it.url, basePath), image: withBase(it.image, basePath) }))));

  // sitemap + robots
  const indexable = routes.filter((r) => !r.file && !r.page.noindex);
  fs.writeFileSync(path.join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indexable.map((r) => `  <url><loc>${site.url.replace(/\/$/, '')}${r.url}</loc>${r.page.seo?.modifiedTime ? `<lastmod>${r.page.seo.modifiedTime}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`);
  fs.writeFileSync(path.join(out, 'robots.txt'), `User-agent: *\nDisallow:\n\nSitemap: ${site.url.replace(/\/$/, '')}/sitemap.xml\n`);

  if (!quiet) console.log(`Built ${routes.length} pages into ${path.relative(ROOT, out)}/ (${site.url}, base path ${basePath}) in ${Date.now() - t0} ms`);
  return { routes };
}

function tidy(html) {
  // collapse the blank lines left by template tags
  return html.replace(/\n\s*\n(\s*\n)+/g, '\n\n');
}

function copyDir(src, dst, filter = () => true) {
  if (!fs.existsSync(src)) return;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name); const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d, filter);
    else if (filter(entry.name)) { fs.mkdirSync(dst, { recursive: true }); fs.copyFileSync(s, d); }
  }
}

function structuredData(site, page) {
  const base = site.url.replace(/\/$/, '');
  const url = base + page.url;
  const graph = [
    { '@type': page.schemaType || 'WebPage', '@id': url, url, name: page.seo.title, isPartOf: { '@id': base + '/#website' }, inLanguage: page.lang || site.lang, ...(page.seo.description ? { description: page.seo.description } : {}), ...(page.seo.publishedTime ? { datePublished: page.seo.publishedTime } : {}), ...(page.seo.modifiedTime ? { dateModified: page.seo.modifiedTime } : {}) },
    { '@type': 'WebSite', '@id': base + '/#website', url: base + '/', name: site.name, description: site.description, publisher: { '@id': base + '/#organization' }, inLanguage: site.lang },
    { '@type': 'Organization', '@id': base + '/#organization', name: site.name, url: base + '/', logo: { '@type': 'ImageObject', url: base + site.logo.src } },
  ];
  return { '@context': 'https://schema.org', '@graph': graph };
}

if (process.argv[1] && process.argv[1].endsWith('build.mjs')) {
  build().catch((e) => {
    console.error(e.name === 'ValidationError' ? e.message : e.stack || e.message);
    process.exit(1);
  });
}
