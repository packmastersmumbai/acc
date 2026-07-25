const { test } = require('./helpers/fixture');
const { expect } = require('@playwright/test');

// Task 11 — reconcile queue. MOCK_UNCAT = 2 txns; MOCK_SUGGEST returns
// {label:'INV-002841', confidence:'amount+date'}. Accept is feature-flagged OFF.

test('first card + progress + suggested match with confidence tag', async ({ page, loadPage }) => {
  await loadPage('reconcile');

  await expect(page.locator('#progressLabel')).toHaveText('0 of 2 reviewed');
  await expect(page.locator('#cardHost')).toContainText('NEFT YASH POLY PLAST');
  await expect(page.locator('#suggestHost')).toContainText('INV-002841');
  await expect(page.locator('#suggestHost .tag')).toHaveText('amount+date');
});

test('Accept is disabled (spike gate); Skip advances the queue', async ({ page, loadPage }) => {
  await loadPage('reconcile');
  await expect(page.locator('#suggestHost .tag')).toBeVisible(); // first card loaded

  await expect(page.locator('#acceptBtn')).toBeDisabled();

  await page.locator('#skipBtn').click();
  await expect(page.locator('#progressLabel')).toHaveText('1 of 2 reviewed');
  await expect(page.locator('#cardHost')).toContainText('HENKEL ADHESIVES');
});

test('after skipping all, shows caught-up empty state', async ({ page, loadPage }) => {
  await loadPage('reconcile');
  await expect(page.locator('#suggestHost .tag')).toBeVisible();
  await page.locator('#skipBtn').click();
  await page.locator('#skipBtn').click();
  await expect(page.locator('#cardHost')).toContainText('All caught up');
  await expect(page.locator('#actions')).toBeHidden();
});

test('empty queue shows nothing-to-reconcile', async ({ page, loadPage }) => {
  // seed an empty uncategorized list BEFORE the page loads
  await loadPage('reconcile', { overrides: { uncategorized: 'function(){ return []; }' } });
  await expect(page.locator('#progressLabel')).toHaveText('Nothing to reconcile');
  await expect(page.locator('#cardHost')).toContainText('All caught up');
  await expect(page.locator('#actions')).toBeHidden();
});
