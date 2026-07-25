const { test } = require('./helpers/fixture');
const { expect } = require('@playwright/test');

// Task 11 — reconcile as a ROW LIST (200/page), each row with Skip/Accept tiles.
// MOCK_UNCAT = 2 txns. Accept is feature-flagged OFF.

test('renders transactions as rows with Skip/Accept tiles', async ({ page, loadPage }) => {
  await loadPage('reconcile');
  const rows = page.locator('.rc-row');
  await expect(rows).toHaveCount(2);
  await expect(page.locator('#rowHost')).toContainText('NEFT YASH POLY PLAST');
  // each row has both tiles
  await expect(rows.first().locator('[data-act="skip"]')).toBeVisible();
  await expect(rows.first().locator('[data-act="accept"]')).toBeVisible();
  await expect(page.locator('#progressLabel')).toHaveText('0 of 2 reviewed');
});

test('Accept tiles are disabled (spike gate)', async ({ page, loadPage }) => {
  await loadPage('reconcile');
  await expect(page.locator('.rc-row').first().locator('[data-act="accept"]')).toBeDisabled();
});

test('Skip marks a row reviewed and advances progress', async ({ page, loadPage }) => {
  await loadPage('reconcile');
  await page.locator('.rc-row').first().locator('[data-act="skip"]').click();
  await expect(page.locator('.rc-row').first()).toHaveClass(/done/);
  await expect(page.locator('#progressLabel')).toHaveText('1 of 2 reviewed');
});

test('empty queue shows nothing-to-reconcile', async ({ page, loadPage }) => {
  await loadPage('reconcile', { overrides: { uncategorized: 'function(){ return []; }' } });
  await expect(page.locator('#progressLabel')).toHaveText('Nothing to reconcile');
  await expect(page.locator('#rowHost')).toContainText('No uncategorized transactions');
  await expect(page.locator('#pager')).toBeHidden();
});

test('pager appears and pages by 200 when over a page of rows', async ({ page, loadPage }) => {
  // 250 synthetic txns -> 2 pages
  const many = 'function(){ var a=[]; for (var i=0;i<250;i++) a.push({transactionId:"t"+i,date:"2026-04-01",amount:1000+i,type:i%2?"credit":"debit",narration:"txn "+i}); return a; }';
  await loadPage('reconcile', { overrides: { uncategorized: many } });
  await expect(page.locator('.rc-row')).toHaveCount(200);         // page 1 shows 200
  await expect(page.locator('#pager')).toBeVisible();
  await expect(page.locator('#pagerLabel')).toHaveText('Page 1 / 2');
  await page.locator('#nextBtn').click();
  await expect(page.locator('.rc-row')).toHaveCount(50);          // page 2 shows remaining 50
  await expect(page.locator('#pagerLabel')).toHaveText('Page 2 / 2');
});
