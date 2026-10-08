// One-off migration tool: extracts the editable content of the hand-templated pages
// (portada, presentación, investigación) from the crawled WordPress HTML into JSON.
// The page layout itself lives in src/templates/pages/*.njk.
//
// "style" objects hold the identifiers of the original Essential Blocks blocks. They select the
// block's generated CSS (src/css/pages/<page>/eb-block-style.css). When adding a new item, copy
// the "style" of an existing item.
//
// Never overwrites existing files unless --force. Usage: node scripts/migrate/import-pages.mjs [--force]
import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { ROOT, CACHE, cleanHtml } from './lib.mjs';

const FORCE = process.argv.includes('--force');
const load = (p) => cheerio.load(fs.readFileSync(path.join(CACHE, 'pages', p, '_', 'raw.html'), 'utf8'));
const used = new Set();
const html = ($, el) => cleanHtml($(el).html() || '', used).replace(/\s+$/g, '').trim();
const text = ($, el) => $(el).text().replace(/\s+/g, ' ').trim();
const id = (el, $, prefix) => { const c = ($(el).attr('class') || '').split(/\s+/).find((x) => x.startsWith('root-' + prefix)); return c ? c.slice(5 + prefix.length) : undefined; };
const src = ($, el) => cleanHtml(`<img src="${$(el).attr('src')}">`, used).match(/src="([^"]*)"/)[1];
const write = (rel, obj) => {
  const file = path.join(ROOT, 'data', rel);
  if (fs.existsSync(file) && !FORCE) { console.log('kept existing', rel); return; }
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
  console.log('wrote', rel);
};
const seo = ($) => ({
  title: $('title').first().text().trim(),
  description: $('meta[name="description"]').attr('content') || undefined,
  ogTitle: $('meta[property="og:title"]').attr('content') || undefined,
  ogType: $('meta[property="og:type"]').attr('content') || undefined,
  image: $('meta[property="og:image"]').attr('content') ? cleanHtml(`<img src="${$('meta[property="og:image"]').attr('content')}">`, used).match(/src="([^"]*)"/)[1] : undefined,
  modifiedTime: $('meta[property="article:modified_time"]').attr('content') || undefined,
  robots: $('meta[name="robots"]').attr('content') || undefined,
});

// ------------------------------------------------------------------ investigación
{
  const $ = load('investigacion_dia');
  const counters = $('.wp-block-essential-blocks-number-counter').map((_, c) => ({
    value: Number($(c).find('.eb-counter').attr('data-target')),
    text: text($, $(c).find('.eb-counter-title')),
    image: $(c).find('img.eb-counter-image').length ? src($, $(c).find('img.eb-counter-image')) : undefined,
    style: id(c, $, 'eb-counter-'),
  })).get();
  const tabsRoot = $('.eb-advanced-tabs-wrapper').first();
  const panels = {};
  tabsRoot.find('.eb-tab-wrapper').each((_, t) => { panels[$(t).attr('data-tab-id')] = t; });
  const groups = tabsRoot.find('ul.tabTitles > li').map((_, li) => {
    const tab = $(panels[$(li).attr('data-title-tab-id')]);
    const wrapper = tab.find('.wp-block-essential-blocks-wrapper').first();
    const heading = tab.find('.wp-block-essential-blocks-advanced-heading').first();
    const button = tab.find('.wp-block-essential-blocks-button').first();
    return {
      name: text($, $(li).find('.tab-title-text')),
      logo: src($, $(li).find('img')),
      title: html($, heading.find('.eb-ah-title')).replace(/^<strong>🔵<\/strong>\s*/, ''),
      descriptionHtml: html($, heading.find('.eb-ah-subtitle')),
      url: button.find('a').attr('href'),
      buttonLabel: text($, button.find('a')),
      style: {
        tabId: $(li).attr('data-title-tab-id'),
        wrapper: id(wrapper, $, 'eb-wrapper-'),
        wrapperAlign: wrapper.find('.eb-wrapper-outer').first().hasClass('eb-wrapper-align-center') ? 'outer' : 'inner',
        wrapperAlignWide: wrapper.hasClass('alignwide'),
        heading: id(heading, $, 'eb-advance-heading-'),
        button: id(button, $, 'eb-button-'),
      },
    };
  }).get();
  const intro = $('.root-eb-advance-heading-jtzjtfs');
  const groupsHead = $('.root-eb-advance-heading-mj42vni');
  const figure = $('.root-eb-advanced-image-inxkbd8');
  write('research.json', {
    page: { seo: seo($) },
    intro: { title: text($, intro.find('.eb-ah-title')), textHtml: html($, intro.find('.eb-ah-subtitle')) },
    counters,
    groupsIntro: { title: text($, groupsHead.find('.eb-ah-title')), text: text($, groupsHead.find('.eb-ah-subtitle')) },
    image: { src: src($, figure.find('img')), alt: '', caption: text($, figure.find('figcaption')) },
    areasTitle: text($, $('.root-eb-advance-heading-jw5b0j2 .eb-ah-title')),
    areas: $('ul.wp-block-list').first().find('li').map((_, li) => html($, li)).get(),
    groups,
  });
}

// ------------------------------------------------------------------ generic block readers
const animOf = ($, el) => ((($(el).children('.eb-parent-wrapper').first().attr('class') || '') + ' ' + ($(el).find('.eb-parent-wrapper').first().attr('class') || '')).match(/eb___(?!animated)(\w+)/) || [])[1];
const readHeading = ($, sel) => {
  const el = typeof sel === 'string' ? $(sel).first() : $(sel);
  const w = el.find('.eb-advance-heading-wrapper').first();
  const t = el.find('.eb-ah-title').first(); const s = el.find('.eb-ah-subtitle').first();
  return {
    id: id(el[0], $, 'eb-advance-heading-'), anim: animOf($, el), preset: (w.attr('class').match(/(button-1|preset-\d)/) || [])[0],
    anchor: el.attr('id') || undefined,
    titleTag: t.prop('tagName').toLowerCase(), title: html($, t),
    subtitleTag: s.length ? s.prop('tagName').toLowerCase() : undefined, subtitle: s.length ? html($, s) : undefined,
  };
};
const readInfobox = ($, el) => ({
  id: id(el, $, 'eb-infobox-'), anim: animOf($, el), url: $(el).find('a.info-click-link').attr('href'),
  image: $(el).find('img').length ? src($, $(el).find('img')) : undefined,
  title: html($, $(el).find('.title')), description: $(el).find('.description').length ? html($, $(el).find('.description')) : undefined,
});
const readCounter = ($, el) => ({
  id: id(el, $, 'eb-counter-'), anim: animOf($, el), value: Number($(el).find('.eb-counter').attr('data-target')),
  separator: $(el).find('.eb-counter').attr('data-separator'), showSeparator: $(el).find('.eb-counter').attr('data-isshowseparator') === 'true',
  title: text($, $(el).find('.eb-counter-title')), image: $(el).find('img').length ? src($, $(el).find('img')) : undefined,
});
const readImage = ($, sel) => { const el = $(sel).first(); return { id: id(el[0], $, 'eb-advanced-image-'), src: src($, el.find('img')), alt: el.find('img').attr('alt') || '', link: el.find('a').attr('href') || undefined, caption: el.find('figcaption').text() || undefined }; };
const colOf = ($, el) => id($(el).closest('.wp-block-essential-blocks-column')[0], $, 'eb-column-');

// ------------------------------------------------------------------ portada
{
  const $ = load('');
  const stats = $('.root-eb-row-xy4puiw .wp-block-essential-blocks-column').map((_, col) => ({
    column: id(col, $, 'eb-column-'),
    counter: readCounter($, $(col).find('.wp-block-essential-blocks-number-counter')[0]),
    note: readHeading($, $(col).find('.wp-block-essential-blocks-advanced-heading')[0]),
  })).get();
  const cardsIn = (rowSel) => $(rowSel).find('.wp-block-essential-blocks-infobox').map((_, b) => ({ column: colOf($, b), ...readInfobox($, b) })).get();
  const tabs = $('.root-eb-advanced-tabs-zhaw2n2');
  const expert = $('.root-eb-row-nqky1ee .wp-block-essential-blocks-column').map((_, col) => {
    const card = $(col).find('.experto-card');
    const bg = (card.find('.experto-image').attr('style') || '').match(/url\('?([^')]+)'?\)/);
    return { column: id(col, $, 'eb-column-'), url: card.find('a').attr('href'), image: bg ? bg[1] : '', title: text($, card.find('.experto-title')) };
  }).get();
  write('homepage.json', {
    page: { seo: seo($), alternates: [{ url: '/', hreflang: 'es' }, { url: '/en/', hreflang: 'en' }] },
    hero: {
      kicker: readHeading($, '.root-eb-advance-heading-ptwchyu'),
      title: readHeading($, '.root-eb-advance-heading-haqt3kp'),
      image: readImage($, '.root-eb-advanced-image-fm836dk'),
      claim: readHeading($, '.root-eb-advance-heading-su69xq8'),
      claimText: readHeading($, '.root-eb-advance-heading-8jmz39e'),
      logo: readImage($, '.root-eb-advanced-image-ppur0p4'),
    },
    reference: { heading: readHeading($, '.root-eb-advance-heading-ap8s6rv'), stats },
    research: {
      heading: readHeading($, '.root-eb-advance-heading-eti9iqo'),
      intro: readHeading($, '.root-eb-advance-heading-25qox4o'),
      rows: [cardsIn('.root-eb-row-w9ojcij'), cardsIn('.root-eb-row-v670q')],
      emptyColumns: ['9rn8j'],
    },
    education: {
      heading: readHeading($, '.root-eb-advance-heading-069ksky'),
      tabs: tabs.find('ul.tabTitles > li').map((i, li) => {
        const panel = tabs.find(`.eb-tab-wrapper[data-tab-id="${$(li).attr('data-title-tab-id')}"]`);
        const fl = panel.find('.wp-block-essential-blocks-feature-list');
        const first = fl.find('li').first();
        return {
          tabId: $(li).attr('data-title-tab-id'), title: text($, $(li).find('.tab-title-text')),
          list: {
            id: id(fl[0], $, 'eb-feature-list-'), icon: first.attr('data-icon'), iconColor: first.attr('data-icon-color'),
            items: fl.find('li.eb-feature-list-item').map((_, it) => ({ label: text($, $(it).find('.eb-feature-list-title')), url: $(it).find('a').attr('href'), newTab: $(it).attr('data-new-tab') === 'true' })).get(),
          },
        };
      }).get(),
      officialIntro: readHeading($, '.root-eb-advance-heading-asox4n5'),
      officialPrograms: cardsIn('.root-eb-row-ie8tx1s'),
      ownIntro: readHeading($, '.root-eb-advance-heading-yf8nuc2'),
      ownPrograms: cardsIn('.root-eb-row-4y0ocj0'),
      expertCourses: expert,
      coursesIntro: readHeading($, '.root-eb-advance-heading-zqcs1aa'),
      courses: cardsIn('.root-eb-row-oai7mf9'),
    },
    topStories: {
      heading: readHeading($, '.root-eb-advance-heading-e3mdc0b'),
      intro: readHeading($, '.root-eb-advance-heading-chg0qla'),
      perPage: 4,
    },
  });
}

// ------------------------------------------------------------------ presentación
{
  const $ = load('el-departamento-de-inteligencia-artificial-presentacion');
  const slugOf = (href) => (href || '').split('/').filter(Boolean).pop();
  const btn = (sel) => { const el = $(sel).first(); return { id: id(el[0], $, 'eb-button-'), label: text($, el.find('a')) }; };
  const members = $('.root-eb-row-fb2ii95 .wp-block-essential-blocks-team-member').map((_, tm) => {
    const d = $(tm).find('.eb-team-member-description');
    const lines = html($, d).split('<br>');
    return {
      person: slugOf($(tm).find('.eb-team-member-image a').attr('href')),
      column: colOf($, tm), id: id(tm, $, 'eb-team-member-'),
      nameHtml: html($, $(tm).find('.eb-team-member-name')).trim(),
      role: text($, $(tm).find('.eb-team-member-job-title')),
      email: text($, d.find('a').first()),
      phone: (lines[1] || '').trim(),
      office: (lines[2] || '').replace(/^Despacho:\s*/, '').trim(),
    };
  }).get();
  const grids = $('.wp-block-essential-blocks-post-grid').map((_, g) => {
    const w = $(g).closest('.wp-block-essential-blocks-wrapper');
    const inColumn = $(g).parent().hasClass('eb-column-inner');
    const q = JSON.parse($(g).find('.eb-post-grid-wrapper').attr('data-querydata') || '{}');
    const tagValue = (() => { try { return JSON.parse(q.taxonomies.post_tag.value).map((v) => v.value); } catch { return []; } })();
    const li = $(g).find('.ebpg-category-filter-list-item').first();
    return {
      id: id(g, $, 'eb-post-grid-'),
      label: text($, li), filterSlug: li.attr('data-ebpgcategory'),
      tags: tagValue.length ? tagValue : [li.attr('data-ebpgcategory')],
      orderBy: q.orderby, order: q.order,
      people: $(g).find('article').map((_, a) => slugOf($(a).find('a.ebpg-grid-post-link').attr('href'))).get(),
      container: inColumn ? { type: 'column', id: colOf($, g) } : { type: 'wrapper', id: id(w[0], $, 'eb-wrapper-'), align: (w.attr('class').match(/align(full|wide)/) || [''])[0], anchor: w.attr('id') || undefined, center: w.find('.eb-wrapper-outer').first().hasClass('eb-wrapper-align-center') ? 'outer' : 'inner' },
    };
  }).get();
  write('department.json', {
    page: { seo: seo($) },
    ecosystem: {
      heading: readHeading($, '.root-eb-advance-heading-3gmfy'),
      labels: ['uxiua', 'mqgcs', '4s2kl'].map((k) => readHeading($, `.root-eb-advance-heading-${k}`)),
      diagram: readImage($, '.root-eb-advanced-image-kn3hg'),
      diagramMobile: readImage($, '.root-eb-advanced-image-bzt3a'),
      research: { number: btn('.root-eb-button-o1nse'), text: readHeading($, '.root-eb-advance-heading-bo8xn') },
      researchMobile: { number: btn('.root-eb-button-a9cs9'), text: readHeading($, '.root-eb-advance-heading-ls4hq') },
      education: { number: btn('.root-eb-button-42hwv'), text: readHeading($, '.root-eb-advance-heading-p04ka') },
      innovation: { number: btn('.root-eb-button-fag3a'), text: readHeading($, '.root-eb-advance-heading-5g8rx') },
      innovationLogo: readImage($, '.root-eb-advanced-image-7zy3s'),
      innovationNote: readHeading($, '.root-eb-advance-heading-gj97s'),
      video: { popupId: '88t7y', embedUrl: $('.eb-popup-content iframe').attr('src'), title: $('.eb-popup-content iframe').attr('title') },
    },
    welcome: {
      title: text($, $('#carta-bienvenida h1')),
      columns: [readHeading($, '.root-eb-advance-heading-hm37kg9'), readHeading($, '.root-eb-advance-heading-fvxynmm')],
    },
    management: { heading: readHeading($, '#equipo-directivo .root-eb-advance-heading-eti9iqo'), members },
    teachers: {
      heading: readHeading($, '.root-eb-advance-heading-jt1qo1m'),
      intro: readHeading($, '.root-eb-advance-heading-ip7sr34'),
      awardsIntro: text($, $('.root-eb-column-6bsg4x9 > .eb-parent-wrapper p.has-text-color').first()),
      awards: $('.root-eb-column-6bsg4x9 ul.wp-block-list > li').map((_, li) => html($, li).replace(/<br>$/, '')).get(),
    },
    grids,
  });
}

fs.writeFileSync(path.join(CACHE, 'pages-assets.json'), JSON.stringify([...used].sort(), null, 1));
