// Where the site is published: its public URL and the path it lives under.
//
//   data/site.json "url"   https://dia.fi.upm.es/            → base path "/"
//   env SITE_URL           https://usuario.github.io/repo/   → base path "/repo/"
//   env BASE_PATH          overrides only the base path (e.g. a local test under /repo/)
//
// Content (data/*.json, templates, CSS) always uses root-absolute paths such as "/assets/…" or
// "/contacto/"; the build prefixes them with the base path in the generated files (withBase*).
// With base path "/" the output is unchanged.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const slashes = (p) => ('/' + p + '/').replace(/\/{2,}/g, '/');

export function siteConfig(site, env = process.env) {
  site ||= JSON.parse(fs.readFileSync(path.join(ROOT, 'data/site.json'), 'utf8'));
  const url = (env.SITE_URL || site.url).replace(/\/?$/, '/');
  const basePath = slashes(env.BASE_PATH || new URL(url).pathname);
  return { url, basePath };
}

/** Prefix root-absolute URLs ("/x", not "//host") in generated HTML: attributes, srcset and CSS url(). */
export function withBaseHtml(html, base) {
  if (base === '/') return html;
  return html
    .replace(/(\s(?:href|src|action|poster|content|data-[\w-]+)=)(["'])\/(?!\/)/g, `$1$2${base}`)
    .replace(/(\s(?:srcset|imagesrcset)=)(["'])([^"']*)\2/g, (_, a, q, v) => a + q + v.replace(/(^|,\s*)\/(?!\/)/g, `$1${base}`) + q)
    .replace(/url\((\s*(?:["']|&quot;|&#39;)?)\/(?!\/)/g, `url($1${base}`);
}

/** Same for a CSS file. */
export function withBaseCss(css, base) {
  if (base === '/') return css;
  return css.replace(/url\((\s*["']?)\/(?!\/)/g, `url($1${base}`).replace(/(@import\s+["'])\/(?!\/)/g, `$1${base}`);
}

/** A single root-absolute path ("/contacto/") → "/repo/contacto/". */
export const withBase = (p, base) => (base !== '/' && typeof p === 'string' && /^\/(?!\/)/.test(p) ? base + p.slice(1) : p);
