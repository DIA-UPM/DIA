// Minimal static file server for dist/ (behaves like nginx/Apache with directory indexes).
// Usage: node scripts/build/serve.mjs [--port 8080] [--dir dist] [--base /repo/] [--watch]
//   --base   serve the site under a sub-path, like GitHub Pages (default: the build's base path,
//            from SITE_URL / BASE_PATH or data/site.json; see scripts/build/site-config.mjs).
//   --watch  rebuilds the site when data/, src/ or public/ change (used by `npm run dev`).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { siteConfig } from './site-config.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const opt = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const PORT = Number(opt('--port', process.env.PORT || 8080));
const DIR = path.resolve(ROOT, opt('--dir', 'dist'));
const BASE = siteConfig(null, { ...process.env, ...(args.includes('--base') ? { BASE_PATH: opt('--base') } : {}) }).basePath;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.pdf': 'application/pdf', '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.mp4': 'video/mp4',
};

export function createServer(dir = DIR, base = BASE) {
  return http.createServer((req, res) => {
    let p;
    try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
    if (base !== '/') {
      if (p === '/' || p === base.slice(0, -1)) { res.writeHead(302, { Location: base }).end(); return; }
      p = p.startsWith(base) ? p.slice(base.length - 1) : '/__outside-base-path__';
    }
    let file = path.join(dir, p);
    if (!file.startsWith(dir)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      if (!p.endsWith('/')) { res.writeHead(301, { Location: base + p.slice(1) + '/' }).end(); return; }
      file = path.join(file, 'index.html');
    }
    if (!fs.existsSync(file)) {
      const notFound = path.join(dir, '404.html');
      res.writeHead(404, { 'Content-Type': TYPES['.html'] });
      res.end(fs.existsSync(notFound) ? fs.readFileSync(notFound) : 'Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}

if (import.meta.url === `file:///${process.argv[1].replaceAll('\\', '/')}` || process.argv[1].endsWith('serve.mjs')) {
  createServer().listen(PORT, () => console.log(`Serving ${path.relative(ROOT, DIR)} at http://localhost:${PORT}${BASE}`));
  if (args.includes('--watch')) {
    let timer = null; let running = false;
    const rebuild = () => {
      if (running) { timer = setTimeout(rebuild, 300); return; }
      running = true;
      const child = spawn(process.execPath, [path.join(ROOT, 'scripts/build/build.mjs')], { stdio: 'inherit' });
      child.on('exit', () => { running = false; });
    };
    for (const d of ['data', 'src', 'public']) {
      fs.watch(path.join(ROOT, d), { recursive: true }, () => { clearTimeout(timer); timer = setTimeout(rebuild, 250); });
    }
    console.log('Watching data/, src/ and public/ for changes…');
  }
}
