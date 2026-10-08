/*
 * DIA – site behaviour (vanilla JS, no dependencies).
 *
 * Re-implements the visual behaviour that the WordPress site obtained from
 * jQuery + Astra theme/addon + Essential Blocks scripts:
 *   1. Responsive header state          (Astra frontend.js: ast-desktop / ast-header-break-point)
 *   2. Mobile menu + sub-menu toggles    (Astra frontend.js + Astra Pro addon)
 *   3. Desktop dropdown keyboard support (Astra frontend.js)
 *   4. Slide-in sticky header            (Astra Pro addon "astExtSticky", style "slide")
 *   5. Scroll-to-top button              (Astra frontend.js)
 *   6. Smooth scroll to in-page anchors  (Astra frontend.js "is_scroll_to_id")
 *   7. Entrance animations               (Essential Blocks eb-animation-load.js)
 *   8. Animated number counters          (Essential Blocks number-counter/frontend.js)
 *   9. Advanced tabs                     (Essential Blocks advanced-tabs/frontend.js)
 *  10. Post grid pagination             (Essential Blocks post-grid, formerly AJAX → now client-side)
 *  11. Equal-height info boxes           (custom inline jQuery snippet of the old site)
 *
 * Everything degrades gracefully: without JavaScript all content is still in the HTML.
 */
(function () {
  'use strict';

  // Base path the site is published under ("/" or e.g. "/repo/" on GitHub Pages), taken from this script's own URL.
  var BASE = ((document.currentScript && document.currentScript.getAttribute('src')) || '').replace(/assets\/js\/.*$/, '') || '/';
  var BREAK_POINT = 921; // astra.break_point
  var body = document.body;
  var html = document.documentElement;
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ------------------------------------------------------------ 0. build the sticky header clone */
  // Astra Pro rendered a second copy of the header (#ast-fixed-header) that slides in on
  // scroll. It is pure enhancement, so it is cloned here instead of duplicated in the HTML
  // (keeps the static markup free of duplicate ids).
  (function buildFixedHeader() {
    var masthead = document.getElementById('masthead');
    if (!masthead || document.getElementById('ast-fixed-header')) return;
    var fixed = document.createElement('header');
    fixed.id = 'ast-fixed-header';
    fixed.className = masthead.className;
    fixed.style.visibility = 'hidden';
    fixed.setAttribute('data-type', 'fixed-header');
    fixed.setAttribute('aria-hidden', 'true');
    ['ast-desktop-header', 'ast-mobile-header'].forEach(function (id) {
      var src = document.getElementById(id);
      if (src) fixed.appendChild(src.cloneNode(true));
    });
    $$('[id]', fixed).forEach(function (el) {
      if (el.id !== 'ast-desktop-header' && el.id !== 'ast-mobile-header') el.id += '-sticky';
    });
    var logo = masthead.getAttribute('data-sticky-logo');
    $$('.site-logo-img a', fixed).forEach(function (a) {
      a.className = 'sticky-custom-logo';
      a.removeAttribute('aria-label');
      var img = a.querySelector('img');
      if (img && logo) {
        img.src = logo;
        img.setAttribute('width', masthead.getAttribute('data-sticky-logo-width') || '');
        img.setAttribute('height', masthead.getAttribute('data-sticky-logo-height') || '');
        img.setAttribute('srcset', logo + ' 1x, ' + (masthead.getAttribute('data-sticky-logo-2x') || logo) + ' 2x');
        img.setAttribute('sizes', '(max-width: ' + img.getAttribute('width') + 'px) 100vw, ' + img.getAttribute('width') + 'px');
        img.removeAttribute('fetchpriority');
      }
    });
    // Links in the hidden clone must not be reachable by keyboard until it is shown.
    $$('a, button, [tabindex]', fixed).forEach(function (el) { el.setAttribute('data-sticky-tabindex', el.getAttribute('tabindex') || ''); el.setAttribute('tabindex', '-1'); });
    masthead.appendChild(fixed);
  })();

  /* ------------------------------------------------------------ 1. breakpoint */
  function updateBreakpoint() {
    var overflow = body.style.overflow;
    body.style.overflow = 'hidden';
    var width = html.clientWidth;
    body.style.overflow = overflow;
    if (width > BREAK_POINT || width === 0) {
      $$('#masthead .main-header-menu-toggle').forEach(function (t) { t.classList.remove('toggled'); });
      body.classList.remove('ast-header-break-point');
      body.classList.add('ast-desktop');
    } else {
      body.classList.add('ast-header-break-point');
      body.classList.remove('ast-desktop');
    }
  }
  updateBreakpoint();

  /* ------------------------------------------------------------ 2. mobile menu */
  function collapseSubmenus(root) {
    $$('.menu-item-has-children', root).forEach(function (li) {
      li.classList.remove('ast-submenu-expanded');
      $$('.sub-menu', li).forEach(function (s) { s.style.display = 'none'; });
      $$('.ast-menu-toggle', li).forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
    });
  }

  function toggleMobileMenu(button) {
    var header = button.closest('#ast-fixed-header') || document.getElementById('masthead');
    var nav = header.querySelector('#ast-mobile-header .main-header-bar-navigation');
    if (!nav) return;
    collapseSubmenus(nav);
    nav.classList.toggle('toggle-on');
    var open = nav.classList.contains('toggle-on');
    $$('.main-header-menu-toggle', header.querySelector('#ast-mobile-header')).forEach(function (t) {
      t.classList.toggle('toggled', open);
      t.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    nav.style.display = open ? 'block' : '';
    body.classList.toggle('ast-main-header-nav-open', open);
    if (header.id === 'ast-fixed-header') {
      header.style.maxHeight = open ? window.innerHeight + 'px' : '';
      header.style.overflowY = open ? 'auto' : '';
    }
  }

  $$('#ast-mobile-header .main-header-menu-toggle').forEach(function (btn) {
    btn.addEventListener('click', function (e) { e.preventDefault(); toggleMobileMenu(btn); });
  });

  // Sub-menu toggles (mobile). Same semantics as Astra's AstraToggleSubMenu().
  $$('#ast-mobile-header ul.main-header-menu .ast-menu-toggle').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      var li = btn.parentNode;
      $$('.menu-item-has-children', li).forEach(function (child) {
        child.classList.remove('ast-submenu-expanded');
        var s = child.querySelector('.sub-menu'); if (s) s.style.display = 'none';
      });
      Array.prototype.forEach.call(li.parentNode.children, function (sib) {
        if (sib === li || !sib.classList.contains('menu-item-has-children')) return;
        sib.classList.remove('ast-submenu-expanded');
        $$('.sub-menu', sib).forEach(function (s) { s.style.display = 'none'; });
      });
      li.classList.toggle('ast-submenu-expanded');
      var expanded = li.classList.contains('ast-submenu-expanded');
      li.querySelector('.sub-menu').style.display = expanded ? 'block' : 'none';
      btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    });
  });

  // Anchor links inside the mobile menu close it (Astra: headerType "dropdown").
  $$('.ast-mobile-header-content a[href*="#"]').forEach(function (a) {
    if (a.parentElement.classList.contains('menu-item-has-children')) return;
    a.addEventListener('click', function () {
      $$('.menu-toggle.toggled').forEach(function (t) { t.click(); });
    }, true);
  });

  var lastWidth = window.innerWidth;
  window.addEventListener('resize', function () {
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    if (window.innerWidth !== lastWidth) {
      lastWidth = window.innerWidth;
      $$('.menu-toggle.toggled').forEach(function (t) { t.click(); });
      body.classList.remove('ast-main-header-nav-open');
    }
    updateBreakpoint();
    if (!body.classList.contains('ast-header-break-point')) {
      $$('.main-header-bar-navigation').forEach(function (nav) {
        nav.classList.remove('toggle-on'); nav.style.display = '';
        $$('.sub-menu', nav).forEach(function (s) { s.style.display = ''; });
      });
    }
  });

  /* ------------------------------------------------------------ 3. desktop dropdown keyboard support */
  var arrows = $$('nav.site-navigation .menu-item-has-children > a .ast-header-navigation-arrow');
  function closeDesktopMenus() {
    $$('nav.site-navigation .sub-menu').forEach(function (s) { s.classList.remove('toggled-on'); });
    $$('nav.site-navigation .menu-item-has-children').forEach(function (li) { li.classList.remove('ast-menu-hover'); });
    arrows.forEach(function (a) { a.setAttribute('aria-expanded', 'false'); });
  }
  arrows.forEach(function (arrow) {
    arrow.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var li = arrow.closest('li');
      if (!li.classList.contains('ast-menu-hover') && li.parentNode.classList.contains('ast-nav-menu')) closeDesktopMenus();
      setTimeout(function () {
        li.querySelector('.sub-menu').classList.toggle('toggled-on');
        li.classList.toggle('ast-menu-hover');
        var expanded = li.classList.contains('ast-menu-hover');
        arrow.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        arrow.closest('.menu-link').setAttribute('aria-expanded', expanded ? 'true' : 'false');
      }, 10);
    });
  });
  document.addEventListener('click', function (e) { if (!e.target.closest('nav.site-navigation')) closeDesktopMenus(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDesktopMenus(); });

  /* ------------------------------------------------------------ 4. sticky header (slide) */
  var masthead = document.getElementById('masthead');
  var fixedHeader = document.getElementById('ast-fixed-header');
  if (masthead && fixedHeader) {
    fixedHeader.classList.add('ast-sticky-shrunk');
    var stickUpTo = 0;
    var updateStickAttrs = function () {
      var rect = masthead.getBoundingClientRect();
      stickUpTo = rect.top + window.pageYOffset + masthead.offsetHeight + 100
        - (parseInt(getComputedStyle(body).paddingTop, 10) || 0)
        - (parseInt(getComputedStyle(html).paddingTop, 10) || 0);
      fixedHeader.setAttribute('data-stick-support', 'on');
      fixedHeader.setAttribute('data-stick-maxwidth', String(body.clientWidth));
    };
    var sticked = null;
    var onScroll = function () {
      var stick = window.pageYOffset > Math.max(stickUpTo, 0);
      if (stick === sticked) return;
      sticked = stick;
      if (stick) {
        fixedHeader.style.top = '0px';
        fixedHeader.classList.add('ast-header-slide', 'ast-sticky-active', 'ast-header-sticked');
        fixedHeader.style.visibility = 'visible';
        fixedHeader.style.transform = 'translateY(0)';
        html.classList.add('ast-header-stick-slide-active');
        setFixedFocusable(true);
        var content = fixedHeader.querySelector('.ast-mobile-header-content');
        if (content) { content.style.top = fixedHeader.offsetHeight + 'px'; content.style.width = body.clientWidth + 'px'; }
      } else {
        fixedHeader.classList.remove('ast-sticky-active', 'ast-header-sticked');
        fixedHeader.style.transform = 'translateY(-100%)';
        fixedHeader.style.visibility = 'hidden';
        fixedHeader.style.top = '';
        html.classList.remove('ast-header-stick-slide-active');
        setFixedFocusable(false);
      }
    };
    var setFixedFocusable = function (on) {
      if (on) fixedHeader.removeAttribute('aria-hidden'); else fixedHeader.setAttribute('aria-hidden', 'true');
      $$('[data-sticky-tabindex]', fixedHeader).forEach(function (el) {
        var orig = el.getAttribute('data-sticky-tabindex');
        if (!on) el.setAttribute('tabindex', '-1');
        else if (orig) el.setAttribute('tabindex', orig);
        else el.removeAttribute('tabindex');
      });
    };
    updateStickAttrs();
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', function () { updateStickAttrs(); sticked = null; onScroll(); });
    window.addEventListener('load', function () { updateStickAttrs(); sticked = null; onScroll(); });
  }

  /* ------------------------------------------------------------ 5. scroll to top */
  function smoothScrollTo(e, top) {
    if (e) e.preventDefault();
    window.scrollTo({ top: top, left: 0, behavior: 'smooth' });
  }
  var scrollTop = document.getElementById('ast-scroll-top');
  if (scrollTop) {
    var toggleScrollTop = function () {
      var threshold = masthead ? masthead.offsetHeight + 100 : 300;
      scrollTop.style.display = window.pageYOffset > threshold ? 'block' : 'none';
    };
    toggleScrollTop();
    window.addEventListener('scroll', toggleScrollTop, { passive: true });
    scrollTop.addEventListener('click', function (e) { smoothScrollTo(e, 0); });
    scrollTop.addEventListener('keydown', function (e) { if (e.key === 'Enter') smoothScrollTo(e, 0); });
  }

  /* ------------------------------------------------------------ 6. smooth scroll to anchors */
  function offsetTop(el) { var t = 0; while (el) { t += el.offsetTop; el = el.offsetParent; } return t; }
  function stickyOffset() {
    var t = 0;
    var header = document.querySelector('.site-header');
    if (header) $$('div[data-stick-support]', header).forEach(function (d) { t += d.clientHeight; });
    return t;
  }
  function findTarget(hash) {
    if (!hash || hash.length < 2) return null;
    try { return document.getElementById(decodeURIComponent(hash.slice(1))); } catch (err) { return null; }
  }
  var pageUrl = location.href.split('#')[0];
  $$('a[href*="#"]:not([href="#"]):not([href="#0"]):not(.skip-link):not(.nav-links a):not([href*="tab-"])').forEach(function (a) {
    if (a.href.split('#')[0] !== pageUrl || !a.hash) return;
    a.addEventListener('click', function (e) {
      var target = findTarget(a.hash);
      if (!target) return;
      var top = offsetTop(target) - stickyOffset();
      if (top) smoothScrollTo(e, top);
    });
  });
  window.addEventListener('load', function () {
    var target = findTarget(location.hash);
    if (target) { var top = offsetTop(target) - stickyOffset(); if (top) smoothScrollTo(null, top); }
  });

  /* ------------------------------------------------------------ 7. entrance animations */
  var animated = $$('.eb___animated');
  function runAnimations() {
    var vh = window.innerHeight || html.clientHeight;
    var vw = window.innerWidth || html.clientWidth;
    animated.forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (!(r.top >= 0 && r.top <= vh && r.left >= 0 && r.right <= vw)) return;
      var from = []; var to = [];
      el.classList.forEach(function (c) { if (c.indexOf('eb___') !== -1) { from.push(c); to.push(c.replace('eb___', 'eb__')); } });
      if (!from.length) return;
      el.classList.add.apply(el.classList, to);
      el.classList.remove.apply(el.classList, from);
    });
  }
  if (animated.length) {
    setTimeout(function () { runAnimations(); window.addEventListener('scroll', runAnimations, true); }, 500);
  }

  /* ------------------------------------------------------------ 8. counters */
  $$('.eb-counter-wrapper .eb-counter').forEach(function (el) {
    var target = +el.getAttribute('data-target');
    var duration = +el.getAttribute('data-duration');
    var start = +el.getAttribute('data-startValue');
    var showSep = el.getAttribute('data-isShowSeparator') === 'true';
    var sep = el.getAttribute('data-separator') || ',';
    var fmt = function (n) { return showSep ? String(n).replace(/\B(?=(\d{3})+(?!\d))/g, sep) : String(n); };
    var current = start < target ? start : 0;
    var step = (target - current) / duration * 53;
    var started = false;
    // The HTML contains the final value (readable without JS); animate from the start value.
    el.textContent = fmt(current);
    var tick = function () {
      current += step;
      el.textContent = fmt(Math.floor(current));
      if (current < target) setTimeout(tick, 53); else el.textContent = fmt(target);
    };
    var check = function () {
      if (started) return;
      var r = el.getBoundingClientRect();
      if (r.top + r.height / 2 < window.innerHeight) { started = true; tick(); }
    };
    check();
    window.addEventListener('scroll', check, { passive: true });
  });

  /* ------------------------------------------------------------ 9. advanced tabs */
  $$('.eb-advanced-tabs-wrapper > .eb-tabs-nav > ul.tabTitles').forEach(function (list) {
    var wrapper = list.closest('.eb-advanced-tabs-wrapper');
    var panels = function () { return Array.prototype.slice.call(wrapper.children[1].children); };
    var titles = Array.prototype.slice.call(list.children);
    var activate = function (title) {
      titles.forEach(function (t) {
        var on = t === title;
        t.classList.toggle('active', on); t.classList.toggle('inactive', !on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      panels().forEach(function (p) {
        var on = p.dataset.tabId === title.dataset.titleTabId;
        p.classList.toggle('active', on); p.classList.toggle('inactive', !on);
      });
    };
    var hash = location.hash.slice(1);
    var initial = titles.filter(function (t) { return hash && t.getAttribute('data-title-custom-id') === hash; })[0]
      || list.querySelector('li.active') || titles[0];
    if (initial) activate(initial);
    titles.forEach(function (t) {
      t.addEventListener('click', function () { activate(t); });
      t.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(t); } });
    });
  });

  /* ------------------------------------------------------------ 10. post grid pagination */
  // The old site fetched each page through the WordPress REST API. All posts are now
  // rendered statically (grouped by data-page) and this only switches the visible group,
  // reproducing Essential Blocks' pager windowing (show/hide classes + "..." separators).
  $$('.eb-post-grid-wrapper .ebpostgrid-pagination').forEach(function (pager) {
    var grid = pager.closest('.eb-post-grid-wrapper');
    var items = $$('.ebpg-grid-post[data-page]', grid);
    var buttons = $$('.ebpg-pagination-item', pager);
    var prevBtn = pager.querySelector('.ebpg-pagination-item-previous');
    var nextBtn = pager.querySelector('.ebpg-pagination-item-next');
    var n = buttons.length;
    var render = function (page) {
      items.forEach(function (it) { it.hidden = +it.getAttribute('data-page') !== page; });
      buttons.forEach(function (b) {
        var i = +b.dataset.pagenumber;
        var show = (page === 1 && i <= 3) || (i >= page && i <= page + 2) || i === n || (i === 1 && (page >= n - 2 || page >= 4));
        b.classList.toggle('active', i === page);
        b.classList.toggle('show', show); b.classList.toggle('hide', !show);
        if (i === page) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      });
      $$('.ebpg-pagination-item-separator', pager).forEach(function (s) { s.remove(); });
      var sep = '<button class="ebpg-pagination-item-separator" type="button" tabindex="-1" aria-hidden="true">...</button>';
      if (page < n - 2) buttons[n - 1].insertAdjacentHTML('beforebegin', sep);
      if (page >= n - 2 || (n > 4 && page >= 4)) buttons[1].insertAdjacentHTML('afterend', sep);
      if (prevBtn) prevBtn.disabled = page === 1;
      if (nextBtn) nextBtn.disabled = page === n;
      pager.setAttribute('data-current', page);
    };
    if (!n) return;
    pager.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b || b.disabled) return;
      var current = +pager.getAttribute('data-current') || 1;
      if (b === prevBtn) render(Math.max(1, current - 1));
      else if (b === nextBtn) render(Math.min(n, current + 1));
      else if (b.dataset.pagenumber) render(+b.dataset.pagenumber);
    });
    render(1);
  });

  /* ------------------------------------------------------------ 12. category dropdown (blog sidebar) */
  // WordPress navigated to /?category_name=slug; the static site goes to the category archive.
  $$('select[data-category-nav]').forEach(function (sel) {
    sel.addEventListener('change', function () {
      if (sel.value && sel.value !== '-1') location.href = BASE + 'category/' + encodeURIComponent(sel.value) + '/';
    });
  });

  /* ------------------------------------------------------------ 13. video pop-up (Essential Blocks popup, "button click" type) */
  // The iframe only receives its src when opened, and is reset on close (stops the video),
  // like the original script did by reassigning the src.
  $$('.eb-popup-container[data-popup-type="btn_click"]').forEach(function (popup) {
    var trigger = popup.querySelector('.eb-popup-button-anchor');
    var overlay = popup.querySelector('.eb-popup-overlay');
    var modal = popup.querySelector('.modal-main-wrap');
    var close = popup.querySelector('.eb-popup-close-icon');
    var frame = popup.querySelector('iframe[data-src]');
    if (!trigger || !overlay || !modal) return;
    var open = function () {
      if (frame && !frame.getAttribute('src')) frame.setAttribute('src', frame.getAttribute('data-src'));
      overlay.style.display = 'block'; modal.style.display = 'block';
      if (close) close.focus();
    };
    var shut = function () {
      overlay.style.display = 'none'; modal.style.display = 'none';
      if (frame) frame.removeAttribute('src');
      trigger.focus();
    };
    trigger.addEventListener('click', open);
    trigger.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    if (close && popup.getAttribute('data-close-btn') === 'true') {
      close.addEventListener('click', shut);
      close.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); shut(); } });
    }
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && modal.style.display === 'block') shut(); });
  });

  /* ------------------------------------------------------------ 14. video background (was the "Video Background" jQuery plugin) */
  // <div data-video-bg-mp4="…" data-video-bg-poster="…" data-video-bg-overlay="rgba(…)">
  // Mobile devices get the poster image instead of the video, like the original plugin.
  $$('[data-video-bg-mp4]').forEach(function (host) {
    var isMobile = /(Android|iPod|iPhone|iPad|BlackBerry|IEMobile|Opera Mini)/.test(navigator.userAgent);
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.style.zIndex = '1';
    var box = document.createElement('div');
    box.className = 'vidbg-container';
    box.setAttribute('aria-hidden', 'true');
    var poster = host.getAttribute('data-video-bg-poster');
    var video = null;
    if (isMobile) {
      if (poster) box.style.backgroundImage = 'url(' + poster + ')';
    } else {
      video = document.createElement('video');
      video.muted = true; video.loop = true; video.autoplay = true;
      video.setAttribute('playsinline', ''); video.setAttribute('muted', '');
      var source = document.createElement('source');
      source.src = host.getAttribute('data-video-bg-mp4'); source.type = 'video/mp4';
      video.appendChild(source);
      box.appendChild(video);
      var fit = function () {
        if (!video.videoWidth) return;
        var ratio = video.videoWidth / video.videoHeight;
        if (host.offsetWidth / host.offsetHeight > ratio) { video.style.width = host.offsetWidth + 'px'; video.style.height = 'auto'; }
        else { video.style.width = 'auto'; video.style.height = host.offsetHeight + 'px'; }
      };
      video.addEventListener('loadedmetadata', function () { fit(); video.style.opacity = '1'; });
      window.addEventListener('resize', fit);
      var play = video.play(); if (play && play.catch) play.catch(function () {});
    }
    var overlay = host.getAttribute('data-video-bg-overlay');
    if (overlay) { var o = document.createElement('div'); o.className = 'vidbg-overlay'; o.style.background = overlay; box.appendChild(o); }
    host.insertBefore(box, host.firstChild);
  });

  /* ------------------------------------------------------------ 11. equal-height info boxes */
  function equalizeInfoboxes() {
    $$('.wp-block-essential-blocks-row').forEach(function (row) {
      var boxes = $$('.eb-infobox-wrapper', row);
      if (!boxes.length) return;
      boxes.forEach(function (b) { b.style.height = 'auto'; });
      var max = 0;
      boxes.forEach(function (b) { max = Math.max(max, parseFloat(getComputedStyle(b).height) || 0); });
      boxes.forEach(function (b) { b.style.height = max + 'px'; });
    });
  }
  equalizeInfoboxes();
  window.addEventListener('resize', equalizeInfoboxes);
  window.addEventListener('load', equalizeInfoboxes);
})();
