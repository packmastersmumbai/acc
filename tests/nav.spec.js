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
