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
