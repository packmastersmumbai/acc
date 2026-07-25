const { test } = require('./helpers/fixture');
const { expect } = require('@playwright/test');

// Task 10 — create-party form prefilled from the scanned bill (URL params),
// submitting createContact.

test('prefills name + GSTIN from document with the emerald marker', async ({ page, loadPage }) => {
  await loadPage('party', { query: 'name=Yash+Poly+Plast&gstin=27AABFY9773F1ZN' });

  await expect(page.locator('#nameFromDoc')).toBeVisible();
  await expect(page.locator('#nameVal')).toHaveText('Yash Poly Plast');
  await expect(page.locator('#nameFromDoc .tag')).toHaveText('from document');

  await expect(page.locator('#gstinVal')).toHaveText('27AABFY9773F1ZN');
  // PAN + place-of-supply derived from GSTIN
  await expect(page.locator('#panVal')).toHaveText('AABFY9773F');
  await expect(page.locator('#pocVal')).toHaveText('MH');

  // free-entry inputs are hidden when we have document values
  await expect(page.locator('#nameInput')).toBeHidden();
  await expect(page.locator('#gstinInput')).toBeHidden();
});

test('with no params, shows editable inputs instead of document markers', async ({ page, loadPage }) => {
  await loadPage('party');
  await expect(page.locator('#nameInput')).toBeVisible();
  await expect(page.locator('#gstinInput')).toBeVisible();
  await expect(page.locator('#nameFromDoc')).toBeHidden();
});

test('save calls createContact with the right body and confirms', async ({ page, loadPage }) => {
  await loadPage('party', { query: 'name=Yash+Poly+Plast&gstin=27AABFY9773F1ZN' });

  // capture the body passed to the mock
  await page.evaluate(() => {
    window.__captured = null;
    window.__gasOverride('createContact', (obj) => { window.__captured = obj; return { success: true, contact_id: 'C1', contact_name: obj.name }; });
  });

  await page.locator('#saveBtn').click();
  await expect(page.locator('#statusHost')).toContainText('Saved');

  const body = await page.evaluate(() => window.__captured);
  expect(body.name).toBe('Yash Poly Plast');
  expect(body.gstin).toBe('27AABFY9773F1ZN');
  expect(body.contactType).toBe('vendor');
});

test('save without a name shows a validation error, no call', async ({ page, loadPage }) => {
  await loadPage('party'); // no prefill; empty inputs
  await page.locator('#saveBtn').click();
  await expect(page.locator('#statusHost')).toContainText('name is required');
});
