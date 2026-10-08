# Departamento de Inteligencia Artificial (UPM) — static site

Static HTML/CSS/JS version of **https://dia.fi.upm.es/**, migrated from WordPress. Content lives in JSON
files, a small Node.js build turns it into plain HTML pages, and the result (`dist/`) can be served by any
web server (nginx, Apache, GitHub Pages…). No PHP, no database, no WordPress.

The migration is a **replica, not a redesign**: pages reproduce the original markup and CSS, and are checked
pixel-by-pixel against screenshots of the live site.

## Quick start

```bash
npm install            # Node 20+; also run `npx playwright install chromium` once for the tests
npm run dev            # build + local server on http://localhost:8080 that rebuilds on every change
npm run build          # build into dist/
npm test               # validate JSON + build + link check + all Playwright tests (functional + visual)
```

| Command | What it does |
|---|---|
| `npm run dev` | Build, serve `dist/` on :8080 and rebuild when `data/`, `src/` or `public/` change (reload the browser). |
| `npm run build` | Validate the JSON and generate `dist/` (fails with a clear message if the content is invalid). |
| `npm run serve` | Serve the existing `dist/` (`--port 8080`). |
| `npm run validate` | Only validate `data/` (schemas, duplicate slugs, missing images, cross-references). |
| `npm run check-links` | Check `dist/`: internal links, anchors, images/CSS/JS/fonts/documents, WordPress leftovers. `-- --external` also requests external links. |
| `npm run scan-external` | List every external host in `dist/`: resources the browser loads (should only be the Maps/YouTube embeds) and outbound links. |
| `npm test` | Everything: validate, build, check links, Playwright functional + visual tests. |
| `npm run test:functional` / `npm run test:visual` | One Playwright project. |
| `npm run crawl` | (Migration) re-crawl the live site into `.cache/crawl/` (cached; polite, 1 request at a time). |
| `npm run capture-reference` | (Migration) screenshots of the live site into `tests/reference/` (`-- --refresh --page home`). |
| `npm run compare` | Visual comparison local vs reference with diff images in `tests/visual/output/`. |

## Editing content

All texts, links, images and lists are in `data/`. Edit a file, run `npm run build` (or keep `npm run dev`
running) and reload the page.

| File | Controls |
|---|---|
| `data/site.json` | Site name, logos, favicon, footer (address, master links, map, copyright, legal link), SEO defaults. |
| `data/navigation.json` | Main menu (3 levels). Items with `url` starting with `http` open in a new tab. |
| `data/homepage.json` | Home: hero, the three counters, research-group cards, academic offer tabs and program cards, courses, Top Stories titles. |
| `data/department.json` | "Presentación": ecosystem section, background video, video pop-up, welcome letter, management team, awards list and the staff grids. |
| `data/research.json` | "Investigación": intro, counters, areas list, research groups (tabs). |
| `data/contact.json` | "Contacto". |
| `data/personnel/<slug>.json` | One file per person → `/personaldia/<slug>/`, the personnel listing and the staff grids of "Presentación". |
| `data/news/<slug>.json` | One file per news post → `/<slug>/`, "Top Stories", `/noticias/`, tag/category archives, sidebar. |
| `data/taxonomies.json` | Tags, category and authors (names of the archive pages). |
| `data/news-page.json`, `data/personnel-page.json`, `data/english.json` | Headers of `/noticias/`, `/personaldia/` and `/en/`. |
| `data/redirects.json` | Old URLs that must redirect. |

Rules of thumb:

* **Texts** may contain simple HTML (`<strong>`, `<br>`, `<a href="…">`) where the field name ends in `Html`
  or where the original text had it.
* **Images** go in `public/assets/…` and are referenced as `/assets/…`. The build fails if a referenced file is missing.
* **Fields called `id`, `column`, `style`, `tabId`** identify the original design of a block (its CSS). Do not
  change them. To add a card/group/tab, copy an existing item *including* those fields, then change the texts.
* **People**: to add a person copy an existing `data/personnel/*.json`, rename the file to the new slug, set
  `slug` to the same value, fill the fields and put the photo in `public/assets/uploads/…`. `category` decides
  in which grid of "Presentación" the person appears (`catedraticos`, `profesor-titular`, `profesor-contratado-doctor`,
  `profesores-permanentes-laborales`, `profesor-ayudante-doctor`, `personal-tecnico-de-gestion-y-de-administracion-y-servicios`,
  `investigadores`); grids are sorted alphabetically by `name`; the `/personaldia/` listing is sorted by `date`.
  Empty optional fields (`web`, `email`, `orcid`…) are fine.
* **News**: copy a file in `data/news/`, change `slug` (= file name = URL), `title`, `date` (ISO, it sets the
  order), `contentHtml`, `excerptHtml`, `image`/`thumbnail`. `"listed": false` hides a post from listings;
  `"publishPage": false` lists it without a page (both reproduce quirks of the original site).
* JSON schemas with field descriptions are in `schemas/` (editors such as VS Code can use them for autocompletion).

## How it works

```
data/*.json ──► scripts/validation/validate.mjs (JSON Schema + checks)
            ──► scripts/build/routes.mjs (one route per page, original URLs)
            ──► src/templates/**/*.njk (Nunjucks)          ──► dist/<url>/index.html
src/css, src/js, public/ ─────────────────────────────────────► dist/assets/…
```

* `src/templates/layouts/base.njk` — `<head>` (SEO, OpenGraph, JSON-LD), header, footer.
* `src/templates/components/` — header, menu (recursive), footer, sidebar, search forms and `eb.njk`, the
  reusable blocks (wrapper, row, column, heading, image, counter, info box/card, button, icon list).
* `src/templates/pages/` — home, department, research, contact, post, person, archive (all listings), search, 404.
* Everything is rendered to static HTML at build time; the browser never needs JSON to show content
  (exception: `/buscar/` loads `/assets/search-index.json`). Pages are readable without JavaScript.

### CSS

`src/css/theme/<page-type>.css` is the original site's CSS (Astra, Essential Blocks, plugins, per-page block
styles) extracted from what the live site served, pruned to the rules each page type uses, with the original
cascade order. `src/css/manifest.json` says which file each page type loads. `src/css/site.css` is loaded last:
**put new or overriding styles there** rather than editing the generated theme files.
If a template gains new classes that the old site never used, add their styles to `site.css`.

### JavaScript

`src/js/site.js` (no dependencies, ~20 KB) re-implements every visual behaviour of the old site: responsive
header state, mobile menu and sub-menus, keyboard dropdowns, slide-in sticky header, scroll-to-top, smooth
anchor scrolling, entrance animations, animated counters, tabs, Top Stories pagination, video pop-up,
background video, equal-height cards and the sidebar category selector. `src/js/search.js` powers `/buscar/`.
jQuery and all WordPress/plugin scripts were removed.

## Deployment

Upload `dist/` to the web root. Configure the server with the redirects and the 404 page listed in
[docs/url-migration.md](docs/url-migration.md) (nginx and Apache examples included). Directory URLs work with the
default `index.html` handling.

Everything the pages load is in `dist/` (images, fonts, CSS, JS, video, documents). The only third-party resources
are the intentional embeds — Google Maps (footer) and two YouTube videos — plus one image inside a news post that
the original site hot-linked from www.upm.es. `node scripts/validation/scan-external.mjs [--links]` lists them.

### Domain and base path (one setting)

Content and templates always use root paths (`/assets/…`, `/contacto/`). The build turns them into the right URLs
for where the site is published, from **one value**: the site URL.

| Where | How to build |
|---|---|
| Final domain (root) | set `"url"` in `data/site.json` (e.g. `https://ia.upm.es/`) and `npm run build` |
| Sub-path, e.g. GitHub Pages project site | `SITE_URL=https://usuario.github.io/repositorio/ npm run build` → every link, image, CSS `url()`, script, search index and redirect gets the `/repositorio/` prefix |
| Only the path (local tests) | `BASE_PATH=/repositorio/ npm run build` (canonical/sitemap keep `data/site.json`'s domain) |

The site URL is also used for `<link rel="canonical">`, `og:url`/`og:image`, JSON-LD, `sitemap.xml` and
`robots.txt`. With base path `/` the output is identical to before. (PowerShell: `$env:SITE_URL="https://…/"; npm run build`.)

`npm run serve` and `npm run check-links` read the same variables, so a sub-path build can be checked locally:

```bash
SITE_URL=https://usuario.github.io/repositorio/ npm run build
SITE_URL=https://usuario.github.io/repositorio/ npm run check-links
SITE_URL=https://usuario.github.io/repositorio/ npm run serve   # → http://localhost:8080/repositorio/
```

`npm test` runs against the root build (base path `/`); don't set `SITE_URL` when running it.

### GitHub Pages

1. Push the project to a GitHub repository (`dist/` doesn't need to be committed).
2. Settings → Pages → Source: **GitHub Actions**.
3. Every push to `main` runs [.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml): `npm ci`,
   build with `SITE_URL` taken from the Pages configuration (`https://<user>.github.io/<repo>/`), link check, deploy.
4. Moving to the final domain: add the custom domain in Settings → Pages (the workflow then builds for the domain root
   automatically) and update `"url"` in `data/site.json` so local builds match. Nothing else changes.

The build writes `.nojekyll` (files are served as they are) and `404.html`, which GitHub Pages serves for every
missing URL; its links are absolute, so it works at any depth under the sub-path.

Limits of GitHub Pages: no server-side redirects or headers (the old URL in `data/redirects.json` is handled by the
generated HTML redirect page, which works there; the `/feed/` → … rules of docs/url-migration.md can't be applied),
`robots.txt` and `sitemap.xml` are only honoured by search engines at the domain root (not under `/repositorio/`),
published site ≤ 1 GB, files ≤ 100 MB (the largest here is a 5.7 MB video; `dist/` is ~78 MB), soft bandwidth
limit of 100 GB/month.

## Tests

* `tests/functional/` — navigation (desktop, mobile, keyboard, sticky header), home (counters, animations, tabs,
  pagination, images), personnel (listing, profiles, JSON fields, optional fields, staff grids, pop-up), research,
  contact, responsive overflow at 390/768/1024/1440/1920, console/network errors, 404 and redirects, search,
  **WordPress independence** (all requests to dia.fi.upm.es blocked), **JSON validation** errors, and the
  **content-editing test** (changes `office` in `data/personnel/asun.json`, rebuilds, checks the page, restores
  the exact original bytes in `finally`, rebuilds and checks again).
* `tests/visual/` — screenshot comparison with the live-site baseline in `tests/reference/` for 12 pages × 5 viewports.
* Reports: `reports/playwright/` (HTML), `reports/links.json`, `tests/visual/output/` (diff images).

## Repository layout

```
data/            content (JSON)                       schemas/   JSON Schemas
src/templates/   Nunjucks layouts, components, pages  src/css/   theme CSS + site.css
src/js/          site.js, search.js                   public/    images, fonts, video, documents (served as-is)
scripts/build/   build.mjs, routes.mjs, serve.mjs     scripts/validation/  validate, check-links, url-report
scripts/crawl/   crawler of the original site         scripts/migrate/     one-off migration tools (not used by the build)
tests/           functional/, visual/, reference/     docs/      audit, URL migration, visual report, crawl report
dist/            generated site (npm run build)
```

`scripts/migrate/*` were used once to convert the WordPress site (they need the crawl cache in `.cache/`, which is
not part of the deliverable). They are kept for traceability and never run by the build.

## HTML validation

`npm run validate:html` runs html-validate on `dist/` (config: `.htmlvalidate.json`). Remaining reports are
inherited from the original markup and kept on purpose for visual fidelity: 11 empty headings generated by
Essential Blocks sections, the Astra search form (`<input type="submit">` with a redundant `for`), and two
content links without text (listed in `scripts/validation/known-broken.json`).
