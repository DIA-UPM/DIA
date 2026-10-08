// One-off migration tool: rebuilds the site's stylesheets from the CSS the live WordPress site
// actually serves, keeping only the rules its pages use, in the exact original cascade order.
//
// Source of truth: the WP Fastest Cache bundles (wpfc-minified/*.css) + inline <style> blocks +
// the few stylesheets linked directly (Google Fonts, Astra mega-menu), in document order.
// NOTE: the un-bundled originals that WordPress lists in HTML comments are NOT used: several of
// them were edited after the cache was built, so they no longer match what visitors see.
//
// For every page group (home, presentacion, investigacion, contacto, post, personal, archive…):
//   1. concatenate the CSS of all pages of the group, in document order;
//   2. drop rules not used by any page of the group (PurgeCSS against raw + rendered HTML,
//      with a safelist for the state classes toggled by src/js/site.js);
//   3. remove exact duplicate rules (keeping the last one, so the cascade is unchanged);
//   4. turn per-post featured-image banners into a CSS custom property (--dia-banner-image);
//   5. rewrite url(...) to the local /assets/ layout; drop @font-face of unused families.
// Output: src/css/theme/<group>.css and src/css/manifest.json (group → files).
//
// Usage: node scripts/migrate/extract-css.mjs
import fs from 'node:fs';
import path from 'node:path';
import { PurgeCSS } from 'purgecss';
import safeParser from 'postcss-safe-parser';
import { localAssetPath, pageGroup, ROOT, CACHE, cachedAssetFile, fetchAssetPolitely } from './lib.mjs';

const OUT = path.join(ROOT, 'src/css/theme');

const SAFELIST = {
  standard: [
    'toggled', 'toggle-on', 'toggled-on', 'focus', 'active', 'inactive', 'show', 'hide', 'disable',
    'ast-desktop', 'ast-header-break-point', 'ast-main-header-nav-open', 'ast-submenu-expanded', 'ast-menu-hover',
    'ast-header-sticked', 'ast-header-slide', 'ast-sticky-active', 'ast-sticky-shrunk', 'ast-header-stick-slide-active',
    'hidden', 'sticky-custom-logo', 'eb_popup_show', 'eb-popup-open',
  ],
  deep: [/^eb__/, /^eb___/, /ast-sticky/, /ast-header-stick/, /ast-fixed-header/, /eb-popup/],
  greedy: [/data-/, /aria-/],
};

function listSources(html, pageUrl) {
  const out = [];
  const re = /<!--[\s\S]*?-->|<link\b[^>]*rel=["']stylesheet["'][^>]*>|<style([^>]*)>([\s\S]*?)<\/style>/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<!--')) continue; // commented-out originals: ignored on purpose
    if (m[0].startsWith('<link')) {
      const href = (/href=["']([^"']+)["']/.exec(m[0]) || [])[1];
      if (!href) continue;
      out.push({ kind: 'file', url: new URL(href.replace(/&#038;/g, '&'), pageUrl).href });
    } else {
      out.push({ kind: 'inline', id: (/id=['"]([^'"]+)['"]/.exec(m[1]) || [])[1] || 'inline', css: m[2] });
    }
  }
  return out;
}

// Some plugin CSS is malformed. Browsers skip such rules; we do the same so the result is valid.
function sanitize(css) {
  css = css
    .replace(/([{};\s]|\*\/)n(?=[\s{}@.#/])/g, '$1') // EB custom CSS stored with "\n" flattened to "n"
    .replace(/\}\s*\/\/[^{}]*\{[^{}]*\}/g, '}');   // rules whose selector starts with "//"
  const root = safeParser(css);
  root.walkRules((r) => { if (r.selector.includes('//')) r.remove(); });
  root.walkDecls((d) => { if (!d.value.trim() || /undefined/.test(d.value)) d.remove(); });
  return root.toString();
}

const cssAssets = new Set();
const MISSING = fs.existsSync(path.join(CACHE, 'missing-assets.json')) ? JSON.parse(fs.readFileSync(path.join(CACHE, 'missing-assets.json'), 'utf8')) : {};
const report = JSON.parse(fs.readFileSync(path.join(CACHE, 'crawl-report.json'), 'utf8'));
const failed404 = new Set(report.failed.map((f) => f.url));
function rewriteUrls(css, baseUrl) {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (all, q, u) => {
    if (u.startsWith('data:') || u.startsWith('#')) return all;
    let abs; try { abs = new URL(u, baseUrl).href; } catch { return all; }
    if (MISSING[abs] || failed404.has(abs)) return `none /* ${abs.replace('https://dia.fi.upm.es', '')} was already missing (404) on the original site */`;
    const local = localAssetPath(abs);
    if (local) cssAssets.add(abs);
    return local ? `url("${local}")` : all;
  });
}

/** Removes exact duplicate rules (same at-rule context + selector + declarations), keeping the LAST one. */
function dedupe(css) {
  const root = safeParser(css);
  const seen = new Map();
  root.walk((node) => {
    if (node.type !== 'rule' && !(node.type === 'atrule' && node.name === 'font-face')) return;
    if (node.parent?.type === 'atrule' && /keyframes/.test(node.parent.name)) return;
    let ctx = ''; let p = node.parent;
    while (p && p.type !== 'root') { ctx = `@${p.name} ${p.params}|` + ctx; p = p.parent; }
    const key = ctx + (node.selector || '@font-face').replace(/\s+/g, ' ') + '{' + node.nodes.map((n) => n.toString().replace(/\s+/g, '')).join(';');
    if (seen.has(key)) seen.get(key).remove();
    seen.set(key, node);
  });
  // identical @keyframes: keep last
  const kf = new Map();
  root.walkAtRules(/keyframes$/, (a) => { const k = a.name + a.params + a.toString().replace(/\s+/g, ''); if (kf.has(k)) kf.get(k).remove(); kf.set(k, a); });
  root.walkAtRules((a) => { if (a.nodes && a.nodes.length === 0) a.remove(); });
  return root.toString();
}

// Astra writes every post's featured image into that post's CSS. Merged per group this would
// conflict, so the image becomes a custom property set inline by the template from the JSON.
function generaliseBanner(css) {
  return css.replace(/(\.ast-single-entry-banner\[data-post-type="[^"]+"\]\[data-banner-background-type="featured"\]\s*\{[^}]*?background:\s*)url\([^)]*\)/g, '$1var(--dia-banner-image, none)');
}

// Google Fonts serves different CSS per browser; request it as Chrome to get woff2 files.
async function fetchGoogleFontsCss(u) {
  const file = cachedAssetFile(u) + '.chrome.css';
  if (!fs.existsSync(file)) {
    const res = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' } });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, await res.text());
  }
  return fs.readFileSync(file, 'utf8');
}

function pruneFontFaces(files) {
  const all = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n').replace(/@font-face\s*\{[^}]*\}/g, '');
  const used = new Set();
  for (const m of all.matchAll(/font(?:-family)?\s*:\s*([^;}]+)/g)) for (const fam of m[1].split(',')) used.add(fam.trim().replace(/^['"]|['"]$/g, '').replace(/\s*!important$/, '').toLowerCase());
  for (const f of files) {
    const css = fs.readFileSync(f, 'utf8');
    const out = css.replace(/@font-face\s*\{[^}]*\}/g, (block) => {
      const fam = (block.match(/font-family\s*:\s*['"]?([^;'"}]+)/) || [])[1];
      return fam && !used.has(fam.trim().toLowerCase()) ? '' : block;
    });
    if (out !== css) fs.writeFileSync(f, out);
  }
}

async function readSource(s) {
  if (s.kind === 'inline') return s.css;
  if (/fonts\.googleapis\.com/.test(s.url)) return fetchGoogleFontsCss(s.url);
  const file = cachedAssetFile(s.url);
  if (!fs.existsSync(file)) await fetchAssetPolitely(s.url);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

async function main() {
  const pages = Object.entries(report.pages).filter(([u, p]) => p.file && p.status === 200 && !new URL(u).search && fs.existsSync(path.join(ROOT, p.file, 'raw.html')));
  const perPage = pages.map(([url, p]) => {
    const raw = fs.readFileSync(path.join(ROOT, p.file, 'raw.html'), 'utf8');
    const renderedFile = path.join(ROOT, p.file, 'rendered.html');
    return { url, group: pageGroup(url, raw), sources: listSources(raw, url), html: fs.existsSync(renderedFile) ? fs.readFileSync(renderedFile, 'utf8') : raw, raw };
  });
  const jsContent = fs.readFileSync(path.join(ROOT, 'src/js/site.js'), 'utf8');
  const groups = {};
  for (const pg of perPage) (groups[pg.group] ||= []).push(pg);

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.rmSync(path.join(ROOT, 'src/css/vendor'), { recursive: true, force: true });
  fs.rmSync(path.join(ROOT, 'src/css/pages'), { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const manifest = { generatedBy: 'scripts/migrate/extract-css.mjs', groups: {} };
  const summary = [];
  for (const [group, list] of Object.entries(groups)) {
    // Ordered union of the group's sources (by first appearance in document order).
    const seen = new Set(); const chunks = [];
    for (const pg of list) {
      for (const s of pg.sources) {
        const k = s.kind === 'file' ? s.url : 'inline:' + s.css;
        if (seen.has(k)) continue; seen.add(k);
        chunks.push(s);
      }
    }
    let css = '';
    for (const s of chunks) {
      const c = await readSource(s);
      if (c == null) { console.warn('missing', s.url); continue; }
      css += `\n/* ${s.kind === 'file' ? s.url.replace('https://dia.fi.upm.es', '') : `<style id="${s.id}">`} */\n` + rewriteUrls(sanitize(c), s.url || 'https://dia.fi.upm.es/');
    }
    const res = await new PurgeCSS().purge({
      content: [...list.flatMap((p) => [{ raw: p.html, extension: 'html' }, { raw: p.raw, extension: 'html' }]), { raw: jsContent, extension: 'js' }],
      css: [{ raw: css }], safelist: SAFELIST, fontFace: false, keyframes: false, variables: false,
    });
    const out = dedupe(generaliseBanner(res[0].css)).replace(/\n{3,}/g, '\n\n');
    const file = path.join(OUT, `${group}.css`);
    fs.writeFileSync(file, `/*\n * Theme CSS for page group "${group}" (${list.length} original page(s)).\n * Migrated from the CSS served by the WordPress site (Astra + Essential Blocks), pruned to the\n * rules these pages use, original cascade order preserved. Generated by\n * scripts/migrate/extract-css.mjs — prefer overriding in src/css/site.css instead of editing.\n */\n${out.trim()}\n`);
    manifest.groups[group] = [`theme/${group}.css`];
    summary.push({ group, pages: list.length, sources: chunks.length, kbIn: Math.round(css.length / 1024), kbOut: Math.round(out.length / 1024) });
  }
  const files = fs.readdirSync(OUT).map((f) => path.join(OUT, f));
  pruneFontFaces(files);
  const referenced = new Set();
  for (const f of files) for (const m of fs.readFileSync(f, 'utf8').matchAll(/url\("(\/assets\/[^"]+)"\)/g)) referenced.add(m[1]);
  fs.writeFileSync(path.join(CACHE, 'css-assets.json'), JSON.stringify([...cssAssets].filter((u) => referenced.has(localAssetPath(u))), null, 1));
  fs.writeFileSync(path.join(ROOT, 'src/css/manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.table(summary);
}

main().catch((e) => { console.error(e); process.exit(1); });
