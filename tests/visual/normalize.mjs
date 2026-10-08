// Brings a page (live WordPress site OR local static build) into a deterministic
// visual state before taking a screenshot:
//   - waits for web fonts and images (including lazy-loaded ones, by scrolling through the page)
//   - lets entrance animations / counters finish, then forces their final state
//   - disables CSS animations and transitions
//   - hides third-party / time-dependent content (Google Maps iframe) and freezes background video
//   - returns to the top so the sticky header is in its initial (hidden) state
export async function normalizePage(page) {
  await page.waitForLoadState('load');
  await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    await document.fonts.ready;
    const step = Math.max(200, Math.floor(window.innerHeight * 0.6));
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo({ top: y, behavior: 'instant' });
      await sleep(120);
    }
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
    await sleep(300);
    window.scrollTo({ top: 0, behavior: 'instant' });
    await sleep(1500); // counters (1s) + animate.css (1s)
    // Force final state of anything that did not become fully visible while scrolling.
    document.querySelectorAll('.eb___animated').forEach((el) => {
      [...el.classList].filter((c) => c.startsWith('eb___')).forEach((c) => { el.classList.remove(c); el.classList.add(c.replace('eb___', 'eb__')); });
    });
    document.querySelectorAll('.eb-counter[data-target]').forEach((el) => {
      const t = el.getAttribute('data-target');
      el.textContent = el.getAttribute('data-isshowseparator') === 'true' ? t.replace(/\B(?=(\d{3})+(?!\d))/g, el.getAttribute('data-separator') || ',') : t;
    });
    const style = document.createElement('style');
    style.textContent = `*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition:none!important;caret-color:transparent!important}
      iframe[src*="google.com/maps"]{visibility:hidden!important}
      #ast-scroll-top{display:none!important}`;
    document.head.appendChild(style);
    document.querySelectorAll('img').forEach((img) => { img.loading = 'eager'; });
    // background video: freeze on its first frame
    await Promise.all([...document.querySelectorAll('video')].map((v) => new Promise((r) => { v.pause(); if (v.readyState < 1) { r(); return; } v.onseeked = r; v.currentTime = 0; setTimeout(r, 3000); })));
    await Promise.all([...document.images].filter((i) => !i.complete).map((i) => new Promise((r) => { i.onload = i.onerror = r; setTimeout(r, 8000); })));
    await sleep(200);
  });
}
