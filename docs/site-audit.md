# Audit of https://dia.fi.upm.es/ (Phase 1)

Audit date: 2026-09-26/27. Sources: Yoast sitemaps, a full polite crawl (`npm run crawl`, 196 URLs,
Playwright-rendered DOM + raw HTML, cached in `.cache/crawl/`), manual inspection of the theme and plugin
scripts, and live measurements with Playwright. Detailed crawl data: [crawl-report.md](crawl-report.md).

## 1. Technology found

| Layer | Implementation on the live site | Kept? | How in the static site |
|---|---|---|---|
| CMS | WordPress 6.7.1 (PHP), Polylang (ES/EN), Yoast SEO, ACF (person fields) | No | JSON in `data/` + Nunjucks build |
| Theme | Astra 4.8.6 + Astra Pro addon 4.8.6 (header builder, sticky header) + child theme | CSS only | Theme CSS migrated; JS re-implemented |
| Page builder | Essential Blocks 5.0.4 (Gutenberg blocks: wrapper/row/column, advanced heading, info box, counter, tabs, feature list, team member, post grid, popup, button, image) | Markup + CSS | Same markup produced by `src/templates/components/eb.njk` |
| Other plugins loaded on every page | Elementor 3.25 + Essential Addons + Header-Footer-Elementor (no Elementor content on any page), WP Video Lightbox / prettyPhoto (unused), TablePress (unused), PDF Embedder (unused), Video Background (used once) | Only what renders | Unused plugin CSS pruned away; Video Background re-implemented |
| Caching | WP Fastest Cache (minified CSS/JS bundles per page) | – | The bundles are the **source of truth** for CSS (see §4) |
| JS libraries | jQuery 3.7.1 + jQuery Migrate, wp-hooks/i18n/url/api-fetch, Astra `frontend.min.js`, Astra Pro addon, Essential Blocks scripts, prettyPhoto, vidbg, DOMPurify, Elementor lazyload | No | One dependency-free `src/js/site.js` (+ `search.js`) |
| Fonts | Astra local fonts (Syne, Noto Sans Hanunoo), Google Fonts (Nunito, Manrope, Noto Sans…), Font Awesome 5 (Elementor + EB copies), eicons, dashicons | Used faces only | Self-hosted in `/assets/fonts/`, unused `@font-face` removed |
| Media | 63 MB of used images/PDF/video under `wp-content/uploads` | Yes (used files only) | `/assets/uploads/<year>/<month>/…` (same sub-path) |
| Third-party embeds | Google Maps iframe (footer + contact), YouTube (presentation pop-up, some posts), Gravatar (author og:image) | Yes (external) | Unchanged third-party embeds |

## 2. Content inventory

| Type | Count | Original implementation | Static implementation |
|---|---|---|---|
| Home | 1 | EB blocks, 3 counters, 9 research-group cards, tabs, program cards, "Top Stories" post grid with AJAX pagination (87 posts) | `pages/home.njk` + `data/homepage.json` + `data/news/` |
| Presentación | 1 | EB blocks, video background, YouTube pop-up, management team cards, 7 staff grids queried by tag (AJAX-free) | `pages/department.njk` + `data/department.json` + `data/personnel/` |
| Investigación | 1 | Counters, areas list, 9-tab research groups | `pages/research.njk` + `data/research.json` |
| Contacto | 1 | Text, image, Google Map | `pages/contact.njk` + `data/contact.json` |
| News posts | 87 published + 1 listed-only (its page is 404 on the original) + 1 unlisted | Gutenberg HTML, featured image banner, sidebar widgets | `pages/post.njk` + `data/news/<slug>.json` |
| News archives | /noticias/ (9 pages), /category/uncategorized/ (9), /tag/noticias/ (9), /tag/top-stories/ (7), /tag/top/, 6 empty personnel tag archives, 2 author archives | Astra blog grid, WP pagination | `pages/archive.njk`, generated from the same data |
| Personnel | 44 profiles (custom post type `personaldia`, ACF fields) + archive (5 pages) | EB template filled with ACF fields | `pages/person.njk` + `data/personnel/<slug>.json` |
| English | /en/ | Polylang: empty blog page | Reproduced as is (empty) |
| Search | /?s= | WordPress search | **Replaced** by `/buscar/` (client-side index) |
| Feeds | /feed/, /comments/feed/, /en/feed/ | WordPress RSS | Not reproduced (redirect suggested, see url-migration.md) |

Navigation: 7 top-level items, 3 levels deep (Docencia › Títulos oficiales › …), anchors into the presentation and
research pages, external links to master sites and the intranet (open in a new tab — the old site did this with an inline script).

## 3. Visual / interactive features

| Feature | Where | Original implementation | WordPress-dependent? | Decision |
|---|---|---|---|---|
| Responsive header (desktop/mobile switch at 921 px) | all | Astra `frontend.min.js` toggles `ast-desktop` / `ast-header-break-point` on `<body>` | No, but bundled with the theme | Re-implemented (same classes, same breakpoint) |
| Mobile menu + sub-menu toggles | all | Astra + Astra Pro (`astraNavMenuTogglePro`) | Needs addon globals | Re-implemented, with `aria-expanded` |
| Desktop dropdowns (hover + keyboard) | all | CSS hover + Astra keyboard handler | No | CSS kept; keyboard handler re-implemented |
| Slide-in sticky header | all | Astra Pro `astExtSticky` (jQuery), duplicate `#ast-fixed-header` rendered by PHP | jQuery | Re-implemented; the copy is cloned by JS (no duplicate IDs in the HTML) |
| Scroll-to-top button | all | Astra | No | Re-implemented |
| Smooth scroll to anchors | all | Astra `is_scroll_to_id` | No | Re-implemented |
| Entrance animations (fadeIn, fadeInLeft, fadeInUp, zoomIn) | home, research, presentation, profiles | EB `eb-animation-load.js` + animate.css | No | animate.css kept (pruned), trigger re-implemented with the same rule |
| Animated counters | home, research | EB `number-counter/frontend.js` | No | Re-implemented (same timing: 53 ms steps, 1 s); the HTML holds the real number (works without JS) |
| Tabs | home, research | EB `advanced-tabs/frontend.js` | No | Re-implemented + keyboard support |
| Top Stories pagination | home | EB post grid → WordPress REST API (`/wp-json/essential-blocks/v1/queries`) | **Yes** | Re-implemented client-side over statically rendered posts, same pager windowing |
| Staff grids by category | presentation | EB post grid (server-side query by tag) | Yes (query) | Generated at build time from `data/personnel` |
| Video pop-up | presentation | EB popup | No | Re-implemented (iframe loaded on open, reset on close) |
| Background video | presentation hero | "Video Background" plugin (jQuery) | jQuery | Re-implemented (MP4 served locally, poster on mobile) |
| Equal-height info boxes | home | Inline jQuery snippet in the theme | jQuery | Re-implemented |
| External nav links in new tab | all | Inline script | No | Done at build time (`target="_blank" rel="noopener"`) |
| Category dropdown (sidebar) | posts | Navigates to `/?category_name=` (WP query) | **Yes** | Navigates to `/category/<slug>/` |
| Search forms | posts, empty archives, 404 | `/?s=` | **Yes** | `/buscar/?s=` static search |
| Elementor background lazy-load | all | Inline script | – | Dropped: no Elementor containers on any page |
| prettyPhoto / WP Video Lightbox | all (loaded) | jQuery plugin | – | Dropped: not used by any link (`rel="wp-video-lightbox"` never appears) |
| Emoji, oEmbed, RSD, REST links, generator meta, Polylang cookie script | all | WordPress core | Yes | Dropped (runtime only) |

## 4. CSS findings

* Every page loads 3–4 WP Fastest Cache bundles (350–620 KB each) containing ~30 stylesheets (Astra, Astra Pro,
  block library, Essential Blocks, Font Awesome ×2, Elementor, eicons, dashicons, prettyPhoto, TablePress…) plus a
  per-page Essential Blocks stylesheet and per-page Astra "dynamic CSS".
* **The un-bundled originals listed in HTML comments no longer match what is served**: several (e.g.
  `eb-style-214.min.css`, Investigación) were edited after the cache was generated. Using them produced a different
  layout, so the migration uses the bundles actually served to visitors.
* Some Essential Blocks "custom CSS" is malformed (`//` comments, newlines saved as the letter `n`); browsers
  ignore those rules and so does the migrated CSS.
* Two background images referenced by the CSS are 404 on the original site (`Imagen-profesores-con-robot.jpg`,
  `foto-fondo-presentacion-DIA.jpg`); they are replaced by `none` (identical rendering) and commented.
* Result: one pruned stylesheet per page type in `src/css/theme/` (150–460 KB instead of ~1.4 MB per page), same
  cascade order, unused rules/font faces removed. See README › "CSS".

## 5. Assets

* Crawled: 928 asset URLs (215 MB incl. duplicates and unused originals). Classified in the crawl report as
  A (needed, 660 + 182 responsive derivatives), B (WordPress runtime/admin only, 10), external (84).
* Copied to `public/`: only the 290 files referenced by the final HTML/CSS/data (68 MB, of which 5.7 MB is the
  background video). Responsive `srcset` derivatives are not used by the templates (full images are served).
* Missing on the original site (404): see [crawl-report.md](crawl-report.md) › Failed resources.

## 6. SEO

Kept per page: `<title>`, meta description (only 2 pages had one), robots (the home page is `index, nofollow` on the
original and stays so), canonical, `hreflang` alternates (ES/EN), OpenGraph (locale, type, title, description,
url, site name, image, published/modified time), Twitter card, favicon (SVG), JSON-LD (simplified `WebPage` /
`Article` + `WebSite` + `Organization` graph instead of Yoast's full graph), `sitemap.xml`, `robots.txt`.

## 7. Accessibility baseline (original) and changes

* The original home and contact pages have no `<h1>`; the static site adds a visually hidden `<h1>` (no visual change).
* Tabs, pop-up and mobile menu got keyboard support and ARIA state (`aria-expanded`, `aria-selected`, `role=tab`),
  logos got `alt` text, the hidden sticky-header copy is removed from the tab order while hidden.
* Kept as on the original (visual fidelity): heading hierarchy inside Essential Blocks sections (several `h2`/`h5`
  used for styling), low-contrast texts, and a horizontal overflow of the mobile header (the menu button sticks
  out 16 px at 390 px) and of two pages at 390/768 px — measured identically on the live site.

## 8. Pre-existing problems found on the original site (not fixed, documented)

* 12 broken links in content (legacy Drupal URLs, old personal pages `~user`, `/dasg/`, malformed hrefs) — listed
  in `scripts/validation/known-broken.json`.
* A post (`…-silla-q/`) listed in "Top Stories", the news archives and the sidebar returns 404; another published
  post (`…-silla-q-2/`) is not listed anywhere.
* The personnel tag archives (`/tag/catedraticos/`, …) are empty ("no results") and `/tag/profesores-permanentes-laborales/` is 404.
* `/en/` is an empty page.
