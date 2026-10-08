// One-off migration tool (re-runnable): copies into public/assets/ every media file, font and
// document that the static site references, taken from the crawl cache (downloading politely
// only what is missing). Nothing that is not referenced is copied.
//
// References are collected from data/**/*.json, src/templates/**, src/css/** and src/js/**:
// any "/assets/uploads|fonts|images/..." path.
//
// Usage: node scripts/migrate/copy-assets.mjs [--prune]   (--prune deletes unreferenced files in public/assets)
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, CACHE, cachedAssetFile, fetchAssetPolitely, localAssetPath } from './lib.mjs';

const PUBLIC = path.join(ROOT, 'public');
const walk = (dir, out = []) => {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
};

// local path → original absolute URL
const index = new Map();
const addUrl = (u) => { const l = localAssetPath(u); if (l && !index.has(l)) index.set(l, u); };
const report = JSON.parse(fs.readFileSync(path.join(CACHE, 'crawl-report.json'), 'utf8'));
Object.keys(report.assets).forEach(addUrl);
for (const f of ['css-assets.json', 'content-assets.json']) if (fs.existsSync(path.join(CACHE, f))) JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8')).forEach(addUrl);

const refs = new Set();
const sources = [...walk(path.join(ROOT, 'data')), ...walk(path.join(ROOT, 'src'))].filter((f) => /\.(json|njk|css|js|html)$/.test(f));
for (const f of sources) {
  const txt = fs.readFileSync(f, 'utf8');
  for (const m of txt.matchAll(/\/assets\/(?:uploads|fonts|images|documents)\/[^"'\\\s)<>,]+/g)) refs.add(decodeURIComponent(m[0].replace(/&amp;/g, '&')));
}

let copied = 0; let present = 0; const missing = [];
for (const ref of [...refs].sort()) {
  const dest = path.join(PUBLIC, ref);
  if (fs.existsSync(dest)) { present++; continue; }
  let url = index.get(ref);
  if (!url && ref.startsWith('/assets/uploads/')) url = 'https://dia.fi.upm.es/wp-content/uploads/' + ref.slice('/assets/uploads/'.length);
  if (!url) { missing.push(`${ref} (unknown origin)`); continue; }
  let src = cachedAssetFile(url);
  if (!fs.existsSync(src)) src = await fetchAssetPolitely(url);
  if (!src || !fs.existsSync(src)) { missing.push(`${ref} ← ${url}`); continue; }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  copied++;
}

if (process.argv.includes('--prune')) {
  for (const f of walk(path.join(PUBLIC, 'assets'))) {
    const rel = '/' + path.relative(PUBLIC, f).replaceAll('\\', '/');
    if (!refs.has(rel)) { fs.unlinkSync(f); console.log('pruned', rel); }
  }
}
console.log(`referenced: ${refs.size}, already present: ${present}, copied: ${copied}, missing: ${missing.length}`);
if (missing.length) console.log(missing.join('\n'));
