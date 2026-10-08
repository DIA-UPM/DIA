// Declares every page of the static site: URL, template, data and page-level settings.
// URLs match the original WordPress URLs (see docs/url-migration.md).
const COMMON = 'wp-custom-logo ehf-template-astra ehf-stylesheet-astra-child ast-desktop';
const TAIL = 'ast-hfb-header ast-full-width-layout ast-sticky-main-shrink ast-sticky-header-shrink ast-inherit-site-logo-sticky ast-sticky-custom-logo ast-primary-sticky-enabled elementor-default elementor-kit- astra-addon-4.8.6';
const LOGO = 'ast-replace-site-logo-transparent ast-inherit-site-logo-transparent';
const BODY = {
  home: `home page-template-default page ${COMMON} ast-page-builder-template ast-no-sidebar astra-4.8.6 group-blog ast-single-post ${LOGO} ast-theme-transparent-header ${TAIL}`,
  page: `page-template-default page ${COMMON} ast-plain-container ast-no-sidebar astra-4.8.6 group-blog ast-single-post ${LOGO} ast-theme-transparent-header ${TAIL}`,
  pageTitled: `page-template-default page ${COMMON} ast-plain-container ast-no-sidebar astra-4.8.6 group-blog ast-single-post ${LOGO} ast-theme-transparent-header ${TAIL.replace('elementor-default', 'ast-normal-title-enabled elementor-default')}`,
  post: `post-template-default single single-post single-format-standard ${COMMON} ast-plain-container ast-right-sidebar astra-4.8.6 group-blog ast-blog-single-style-1 ast-single-post ${LOGO} ast-theme-transparent-header ${TAIL.replace('elementor-default', 'ast-normal-title-enabled elementor-default')}`,
  person: `personaldia-template-default single single-personaldia ${COMMON} ast-plain-container ast-no-sidebar astra-4.8.6 group-blog ast-blog-single-style-1 ast-custom-post-type ast-single-post ${LOGO} ast-theme-transparent-header ${TAIL.replace('elementor-default', 'ast-normal-title-enabled elementor-default')}`,
  blog: `blog ${COMMON} ast-plain-container ast-no-sidebar astra-4.8.6 group-blog ${LOGO} ast-theme-transparent-header ast-hfb-header blog-masonry ast-blog-grid-3 ast-blog-layout-4 ast-pagination-square ${TAIL.replace('ast-hfb-header ', '')}`,
  archive: `archive ${COMMON} ast-plain-container ast-no-sidebar astra-4.8.6 group-blog ${LOGO} ast-hfb-header blog-masonry ast-blog-grid-3 ast-blog-layout-4 ast-pagination-square ${TAIL.replace('ast-hfb-header ', '')}`,
  archivePlain: `archive ${COMMON} ast-plain-container ast-no-sidebar astra-4.8.6 group-blog ${LOGO} ast-hfb-header ast-blog-grid-3 ast-blog-layout-4 ast-pagination-square ${TAIL.replace('ast-hfb-header ', '').replace(' elementor-kit-', '')}`,
  en: `blog ${COMMON} ast-plain-container ast-no-sidebar astra-4.8.6 group-blog ${LOGO} ast-theme-transparent-header ast-hfb-header ast-blog-grid-3 ast-blog-layout-4 ast-pagination-square ${TAIL.replace('ast-hfb-header ', '').replace(' elementor-kit-', '')}`,
  personArchive: `archive post-type-archive post-type-archive-personaldia ${COMMON} ast-plain-container ast-no-sidebar astra-4.8.6 group-blog ${LOGO} ast-hfb-header blog-masonry ast-blog-grid-3 ast-blog-layout-4 ast-pagination-square ${TAIL.replace('ast-hfb-header ', '')}`,
};

const PER_PAGE = 10;
const dateLabel = (iso) => new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' });

/** WordPress paginate_links() with end_size = 1, mid_size = 1. */
export function paginate(total, current, base) {
  if (total <= 1) return null;
  const url = (n) => (n === 1 ? base : `${base}page/${n}/`);
  const items = []; let dots = false;
  for (let n = 1; n <= total; n++) {
    if (n === current) { items.push({ n, current: true }); dots = true; continue; }
    if (n <= 1 || n > total - 1 || Math.abs(n - current) <= 1) { items.push({ n, url: url(n) }); dots = true; } else if (dots) { items.push({ dots: true }); dots = false; }
  }
  return { items, prev: current > 1 ? url(current - 1) : null, next: current < total ? url(current + 1) : null };
}

const newsCard = (n) => ({
  url: n.publishPage === false ? `/${n.slug}/` : `/${n.slug}/`,
  title: n.title,
  dateLabel: n.date ? dateLabel(n.date) : n.dateLabel,
  readingTime: n.readingTime,
  excerptHtml: n.excerptHtml,
  thumbnail: n.thumbnail,
  thumbnailClass: 'attachment-400x250 size-400x250',
  articleClass: `post type-post status-publish format-standard${n.thumbnail ? ' has-post-thumbnail' : ''} hentry${(n.categories || []).map((c) => ' category-' + c).join('')}${(n.tags || []).map((t) => ' tag-' + t).join('')}`,
});
const personCard = (p) => ({
  url: `/personaldia/${p.slug}/`,
  title: p.name,
  dateLabel: dateLabel(p.date),
  readingTime: p.readingTime,
  thumbnail: p.thumbnail,
  thumbnailClass: 'attachment-large size-large wp-post-image',
  articleClass: `personaldia type-personaldia status-publish has-post-thumbnail hentry${(p.categories || [p.category]).filter(Boolean).map((t) => ' tag-' + t).join('')}`,
});

function archiveRoutes(base, cards, { archive, bodyClass, css, seo, menuUrl, menuParent }) {
  const pages = Math.max(1, Math.ceil(cards.length / PER_PAGE));
  const out = [];
  for (let n = 1; n <= pages; n++) {
    out.push({
      url: n === 1 ? base : `${base}page/${n}/`,
      template: 'pages/archive.njk',
      context: { archive, items: cards.slice((n - 1) * PER_PAGE, n * PER_PAGE), pagination: paginate(pages, n, base) },
      page: { bodyClass: (cards.length ? bodyClass : bodyClass.replace(' blog-masonry', '').replace(' elementor-kit-', '')) + (n > 1 ? ` paged paged-${n}` : ''), css, menuUrl: menuUrl && n > 1 ? menuUrl : undefined, menuParent, seo: { ...seo, title: n === 1 ? seo.title : seo.title.replace(/ - /, ` - Página ${n} de ${pages} - `) } },
    });
  }
  return out;
}

export function buildRoutes(data) {
  const { news, personnel, taxonomies, site } = data;
  const routes = [];
  const byDate = (a, b) => (b.date || '').localeCompare(a.date || '');
  const allNews = Object.values(news).sort(byDate);
  // "listed": false = the post has its own page but WordPress never showed it in listings
  const listedNews = allNews.filter((n) => n.listed !== false);
  const people = Object.values(personnel).sort(byDate);
  const recentNews = listedNews.slice(0, 5);

  // ---------------------------------------------------------------- structured pages
  routes.push({ url: '/', template: 'pages/home.njk', context: { home: data.homepage, topStories: listedNews }, page: { ...data.homepage.page, bodyClass: BODY.home, css: 'home' } });
  routes.push({ url: '/el-departamento-de-inteligencia-artificial-presentacion/', template: 'pages/department.njk', context: { dept: data.department, personnel }, page: { ...data.department.page, bodyClass: BODY.page, css: 'presentacion' } });
  routes.push({ url: '/investigacion_dia/', template: 'pages/research.njk', context: { research: data.research }, page: { ...data.research.page, bodyClass: BODY.pageTitled, css: 'investigacion' } });
  routes.push({ url: '/contacto/', template: 'pages/contact.njk', context: { contact: data.contact }, page: { ...data.contact.page, bodyClass: BODY.page, css: 'contacto' } });

  // ---------------------------------------------------------------- news
  for (const n of allNews) {
    if (n.publishPage === false) continue;
    routes.push({ url: `/${n.slug}/`, template: 'pages/post.njk', context: { post: n, recentNews }, page: { bodyClass: BODY.post, css: 'post', menuParent: '/noticias/', seo: { ...n.seo, image: n.image?.src || n.seo?.image } , schemaType: 'Article' } });
  }
  const blog = data.newsPage;
  routes.push(...archiveRoutes("/noticias/", listedNews.map(newsCard), { archive: { banner: true, title: blog.title, descriptionHtml: blog.descriptionHtml }, bodyClass: BODY.blog, css: 'archive', seo: blog.seo, menuUrl: '/noticias/' }));
  for (const c of taxonomies.categories.filter((c) => c.archive)) {
    routes.push(...archiveRoutes(`/category/${c.slug}/`, listedNews.filter((n) => (n.categories || []).includes(c.slug)).map(newsCard), { archive: { banner: true, title: c.name }, bodyClass: `${BODY.archive} category category-${c.slug}`, css: 'archive', seo: c.seo, menuParent: '/noticias/' }));
  }
  for (const t of taxonomies.tags.filter((t) => t.archive)) {
    // WordPress tag archives only list news posts (never personnel), exactly like the original site.
    routes.push(...archiveRoutes(`/tag/${t.slug}/`, listedNews.filter((n) => (n.tags || []).includes(t.slug)).map(newsCard), { archive: { banner: true, title: t.name }, bodyClass: `${BODY.archive} tag tag-${t.slug}`, css: 'archive', seo: t.seo, menuParent: '/noticias/' }));
  }
  for (const a of taxonomies.authors.filter((a) => a.archive)) {
    const cards = allNews.filter((n) => a.posts.includes(n.slug)).map(newsCard);
    routes.push(...archiveRoutes(`/author/${a.slug}/`, cards, { archive: a.banner ? { banner: true, vcard: true, title: a.name } : { authorBox: true, title: a.name }, bodyClass: `${a.banner ? BODY.archive : BODY.archivePlain} author author-${a.slug}`, css: 'archive', seo: a.seo, menuParent: '/noticias/' }));
  }

  // ---------------------------------------------------------------- personnel
  for (const p of people) {
    routes.push({ url: `/personaldia/${p.slug}/`, template: 'pages/person.njk', context: { person: p }, page: { bodyClass: BODY.person, css: 'personal', menuParent: '/noticias/', seo: p.seo, schemaType: 'WebPage' } });
  }
  const pa = data.personnelPage;
  routes.push(...archiveRoutes('/personaldia/', people.map(personCard), { archive: { description: pa.description, title: pa.title }, bodyClass: BODY.personArchive, css: 'personal-archive', seo: pa.seo, menuParent: '/noticias/' }));

  // ---------------------------------------------------------------- English home, search, 404
  if (data.english) routes.push({ url: '/en/', template: 'pages/archive.njk', context: { archive: data.english.archive, items: [] }, page: { ...data.english.page, lang: 'en-GB', bodyClass: BODY.en, css: 'en' } });
  routes.push({ url: '/buscar/', template: 'pages/search.njk', context: {}, page: { bodyClass: BODY.archivePlain + ' search', css: 'archive', noindex: true, seo: { title: `Buscar - ${site.name}`, robots: 'noindex, follow' } } });
  routes.push({ url: '/404/', file: '404.html', template: 'pages/404.njk', context: {}, page: { bodyClass: 'error404 wp-custom-logo ehf-template-astra ehf-stylesheet-astra-child ast-desktop ast-plain-container ast-no-sidebar astra-4.8.6 group-blog ast-replace-site-logo-transparent ast-inherit-site-logo-transparent ast-hfb-header ast-full-width-layout ast-sticky-main-shrink ast-sticky-header-shrink ast-inherit-site-logo-sticky ast-sticky-custom-logo ast-primary-sticky-enabled elementor-default astra-addon-4.8.6', css: 'archive', noindex: true, seo: { title: `Página no encontrada - ${site.name}`, robots: 'noindex, follow' } } });
  return routes;
}
