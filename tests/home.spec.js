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
