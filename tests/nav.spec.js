const { test } = require('./helpers/fixture');
const { expect } = require('@playwright/test');

// The shared nav partial must inject a consistent bottom nav on EVERY page that
// includes it — present and future. Locks navigation presence + current-page
// highlight + that window.go exists (iframe-safe navigation).

const PAGES = ['home', 'scan', 'party', 'reconcile', 'ledger'];

for (const p of PAGES) {
  test(`${p}: bottom nav is present with all destinations`, async ({ page, loadPage }) => {
    await loadPage(p, { query: 'p=' + p });
    await expect(page.locator('#pm-nav')).toBeVisible();
    for (const dest of ['home', 'scan', 'reconcile', 'ledger']) {
      await expect(page.locator(`#pm-nav a[data-go="${dest}"]`)).toBeVisible();
    }
    // window.go is the single iframe-safe navigation entry point
    expect(await page.evaluate(() => typeof window.go)).toBe('function');
  });
}

test('current page is highlighted in the nav', async ({ page, loadPage }) => {
  await loadPage('reconcile', { query: 'p=reconcile' });
  await expect(page.locator('#pm-nav a[data-go="reconcile"]')).toHaveClass(/active/);
  await expect(page.locator('#pm-nav a[data-go="home"]')).not.toHaveClass(/active/);
});

test('nav is injected once (no duplicate bars)', async ({ page, loadPage }) => {
  await loadPage('home', { query: 'p=home' });
  await expect(page.locator('#pm-nav')).toHaveCount(1);
});

// Regression: the fixed nav (z-60, bottom-0) used to sit ON TOP of a page's own
// fixed action bar, swallowing its clicks — party/ledger save buttons were dead.
test('a page action bar is not covered by the nav', async ({ page, loadPage }) => {
  await loadPage('party');

  const bar = page.locator('div.fixed.bottom-0');
  const nav = page.locator('#pm-nav');
  const barBox = await bar.boundingBox();
  const navBox = await nav.boundingBox();

  // the action bar must sit entirely above the nav, not overlap it
  expect(barBox.y + barBox.height).toBeLessThanOrEqual(navBox.y + 1);

  // and its button must actually receive the click
  await page.locator('#saveBtn').click({ timeout: 5000 });
});

// Regression: inside the GitHub Pages wrapper this frame is cross-origin to the
// top window, so assigning top.location.search THROWS and the old code fell
// through to navigating window.__appUrl — exposing the raw script.google.com
// URL. Navigation must go out as a postMessage instead.
test('framed navigation posts a message instead of using the raw GAS url', async ({ page, loadPage }) => {
  // Host page is irrelevant; what matters is that the child frame is sandboxed
  // WITHOUT allow-same-origin, making window.top genuinely cross-origin to it —
  // the exact condition that broke navigation in the wrapper.
  await page.goto('data:text/html,<body>host</body>');

  const navSrc = require('fs').readFileSync(
    require('path').join(process.cwd(), 'src/pages/shared/nav.html'), 'utf8');

  const posted = await page.evaluate(async (src) => {
    // a same-origin-inaccessible parent is simulated by sandboxing the frame:
    // a sandboxed iframe without allow-same-origin is cross-origin to us.
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-scripts');
    f.srcdoc = '<body>' + src +
      '<script>window.__appUrl="https://script.google.com/macros/s/DEPLOY/exec";' +
      'window.go("reconcile",{id:"42"});<\/script></body>';
    const got = new Promise((res) => {
      window.addEventListener('message', function h(ev) {
        if (ev.data && ev.data.type === 'pm-nav') { window.removeEventListener('message', h); res(ev.data); }
      });
      setTimeout(() => res(null), 3000);
    });
    document.body.appendChild(f);
    return got;
  }, navSrc);

  expect(posted).toBeTruthy();                 // not a raw-URL navigation
  expect(posted.type).toBe('pm-nav');
  expect(posted.qs).toContain('p=reconcile');
  expect(posted.qs).toContain('id=42');
});

test('nav highlights the page the server rendered, not a guessed one', async ({ page, loadPage }) => {
  await loadPage('reconcile');
  // __page comes from the server template; the wrapper's URL is unreadable here
  await expect(page.locator('#pm-nav a[data-go="reconcile"]')).toHaveClass(/active/);
});
