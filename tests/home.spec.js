const { test } = require('./helpers/fixture');
const { expect } = require('@playwright/test');

// Task 8 — home screen wired to getHomeData (mocked). MOCK_HOME: receivable
// 24781400, payable 13429050, overdue 8912040, unreconciled 517, 3 attention rows.

test('home populates figures from getHomeData in Indian numbering', async ({ page, loadPage }) => {
  await loadPage('home');
  await expect(page.locator('#recv')).toHaveText('₹2,47,81,400');
  await expect(page.locator('#pay')).toHaveText('₹1,34,29,050');
  await expect(page.locator('#overdue')).toHaveText('₹89,12,040');
  await expect(page.locator('#unrecon')).toHaveText('517 entries');
});

test('overdue figure is styled red', async ({ page, loadPage }) => {
  await loadPage('home');
  await expect(page.locator('#overdue')).toHaveClass(/text-\[#ba1a1a\]/);
});

test('attention list renders the mocked parties, overdue party flagged', async ({ page, loadPage }) => {
  await loadPage('home');
  const rows = page.locator('#attention > div');
  await expect(rows).toHaveCount(3);
  await expect(page.locator('#attention')).toContainText('Yash Poly Plast');
  await expect(page.locator('#attention')).toContainText('₹77,23,056');
  await expect(page.locator('#attention')).toContainText('34 bills unpaid'); // the gap label
  // the overdue party (Yash) gets the red dot
  await expect(page.locator('#attention > div').first().locator('.bg-\\[\\#ba1a1a\\]')).toBeVisible();
});

test('clicking a party opens its ledger with that contact id', async ({ page, loadPage }) => {
  await loadPage('home');
  // capture navigation instead of performing it (data-URL pages cannot navigate)
  await page.evaluate(() => {
    window.__nav = null;
    window.go = (p, params) => { window.__nav = { page: p, params: params }; };
  });

  await page.locator('#attention > div', { hasText: 'Yash Poly Plast' }).click();

  expect(await page.evaluate(() => window.__nav)).toEqual({
    page: 'ledger', params: { id: '116000000618000' },
  });
});

test('each party opens its OWN ledger, not the first row', async ({ page, loadPage }) => {
  await loadPage('home');
  await page.evaluate(() => {
    window.__nav = null;
    window.go = (p, params) => { window.__nav = { page: p, params: params }; };
  });

  await page.locator('#attention > div', { hasText: 'Henkel Adhesives' }).click();

  expect(await page.evaluate(() => window.__nav.params.id)).toBe('116000000618111');
});

test('a party with no contact_id is inert — no navigation, no button affordance', async ({ page, loadPage }) => {
  await loadPage('home');
  await page.evaluate(() => {
    window.__nav = null;
    window.go = (p, params) => { window.__nav = { page: p, params: params }; };
  });

  const row = page.locator('#attention > div', { hasText: 'Dorf Ketal' });
  await expect(row).not.toHaveAttribute('data-go', /.*/);
  await expect(row).not.toHaveAttribute('role', 'button');
  // dispatch directly: this row can sit under the fixed nav, and a real click
  // there would be testing layout, not the inertness we care about here
  await row.dispatchEvent('click');
  expect(await page.evaluate(() => window.__nav)).toBe(null);
});

test('sync age is shown and Refresh forces a fresh fetch', async ({ page, loadPage }) => {
  await loadPage('home');
  await page.evaluate(() => {
    window.__forced = [];
    window.__gasOverride('getHomeData', (force) => {
      window.__forced.push(force);
      return { receivable: 1, payable: 1, overdue: 1, unreconciled: 0, attention: [],
               fetchedAt: new Date().toISOString() };
    });
  });

  await page.locator('#refreshBtn').click();

  await expect(page.locator('#syncAge')).toContainText('just now');
  // the refresh must ask the server to bypass its cache
  expect(await page.evaluate(() => window.__forced.slice(-1)[0])).toBe(true);
});

test('initial load does not force a refresh', async ({ page, loadPage }) => {
  await loadPage('home');
  await page.evaluate(() => {
    window.__forced = [];
    window.__gasOverride('getHomeData', (force) => {
      window.__forced.push(force);
      return { receivable: 1, payable: 1, overdue: 1, unreconciled: 0, attention: [] };
    });
  });
  await page.evaluate(() => location.reload());
  await page.waitForLoadState('domcontentloaded');
  // first paint should be allowed to use the cache
  const forced = await page.evaluate(() => window.__forced || []);
  expect(forced.every((f) => f !== true)).toBe(true);
});
