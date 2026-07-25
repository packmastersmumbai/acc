const { test } = require('./helpers/fixture');
const { expect } = require('@playwright/test');

// Task 9 — scan flow: capture → downscale → ocrExtract → parseBill →
// matchContactByGstin, branching matched vs no-match. Mock parseBill returns
// gstin 27AABFY9773F1ZN; matchContactByGstin returns MOCK_MATCH for that gstin,
// null otherwise.

// Drive the scan flow without a real camera/file: stub downscaleImage (its own
// downscale.spec.js already proves the <2MB reduction) so the test exercises the
// OCR → parse → match WIRING, which is what this screen is responsible for.
async function driveScan(page) {
  await page.evaluate(() => {
    window.downscaleImage = () => Promise.resolve({ base64: 'AAAA', mime: 'image/jpeg', bytes: 3 });
    window.__scanOnFile(new Blob(['x'], { type: 'image/jpeg' }));
  });
}

test('matched branch: parsed fields shown + matched party rendered', async ({ page, loadPage }) => {
  await loadPage('scan');
  await driveScan(page);

  // parsed fields populate from mock parseBill
  await expect(page.locator('#readSection')).toBeVisible();
  await expect(page.locator('#rGstin')).toHaveText('27AABFY9773F1ZN');
  await expect(page.locator('#rInvoice')).toHaveText('YPP/24-25/1182');

  // matched party appears (MOCK_MATCH), no-match hidden
  await expect(page.locator('#matchedSection')).toBeVisible();
  await expect(page.locator('#mName')).toHaveText('YARA FERTILISERS INDIA PVT. LTD.');
  await expect(page.locator('#matchedSection .tag-matched')).toHaveText('Matched');
  await expect(page.locator('#noMatchSection')).toBeHidden();
  await expect(page.locator('#actionBar')).toBeVisible();
});

test('no-match branch: red notice + create-supplier tile', async ({ page, loadPage }) => {
  await loadPage('scan');

  // Override parseBill to yield a gstin the mock match won't recognise, so the
  // page's OWN flow (parseBill → matchContactByGstin → null) drives the no-match
  // render — not a hand-forced DOM change.
  await page.evaluate(() => {
    window.__gasOverride('parseBill', () =>
      ({ supplier: 'Unknown Co', gstin: '99ZZZZZ0000Z1Z9', invoiceNo: 'X1', amount: 100, gstPct: 18 }));
  });

  await driveScan(page);

  await expect(page.locator('#noMatchSection')).toBeVisible();
  await expect(page.locator('#noMatchSection')).toContainText('No matching party found');
  await expect(page.locator('#createVendorBtn')).toBeVisible();
  await expect(page.locator('#matchedSection')).toBeHidden();
});
