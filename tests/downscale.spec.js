const { test } = require('./helpers/fixture');
const { expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Task 13 — verifies the shared image-downscale util AND the loading/empty/error
// state partials. Builds the probe page from the REAL partials at runtime (no
// committed duplicate) so the test can never drift from the shipped code.
const SHARED = path.join(__dirname, '../src/pages/shared');
async function loadShared(page) {
  const parts = ['downscale.html', 'states.html']
    .map((f) => fs.readFileSync(path.join(SHARED, f), 'utf8')).join('\n');
  const html =
    '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' +
    '<div id="stateHost"></div>' + parts + '</body></html>';
  // reuse the fixture's mock injection by writing through the same data-URL path
  const { GAS_MOCK_SCRIPT } = require('./helpers/gas-mock');
  const withMock = html.replace('<head>', '<head><script>' + GAS_MOCK_SCRIPT + '</script>');
  await page.goto('data:text/html;base64,' + Buffer.from(withMock).toString('base64'));
  await page.waitForLoadState('domcontentloaded');
}

test('downscaleImage reduces a >2MB image below the 2MB cap', async ({ page }) => {
  await loadShared(page);

  const result = await page.evaluate(async () => {
    // Build a large canvas and export it as a big JPEG blob (>2MB) with noise
    // so it doesn't compress away — a realistic "phone photo" stand-in.
    const big = document.createElement('canvas');
    big.width = 4000; big.height = 3000;
    const ctx = big.getContext('2d');
    const img = ctx.createImageData(big.width, big.height);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = (i * 7) % 255; img.data[i + 1] = (i * 13) % 255;
      img.data[i + 2] = (i * 29) % 255; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);

    const blob = await new Promise((r) => big.toBlob(r, 'image/jpeg', 1.0));
    const file = new File([blob], 'photo.jpg', { type: 'image/jpeg' });

    const out = await window.downscaleImage(file);
    return { inBytes: blob.size, outBytes: out.bytes, mime: out.mime, hasB64: !!out.base64 };
  });

  expect(result.inBytes).toBeGreaterThan(2 * 1024 * 1024); // the input really was >2MB
  expect(result.outBytes).toBeLessThanOrEqual(2 * 1024 * 1024);
  expect(result.mime).toBe('image/jpeg');
  expect(result.hasB64).toBe(true);
});

test('AppStates renders loading, empty, and error blocks', async ({ page }) => {
  await loadShared(page);

  // loading
  await page.evaluate(() => window.AppStates.loading('#stateHost', 'Reading bill…'));
  await expect(page.locator('#stateHost .st-spinner')).toBeVisible();
  await expect(page.locator('#stateHost .st-title')).toHaveText('Reading bill…');

  // empty
  await page.evaluate(() => window.AppStates.empty('#stateHost', 'No open bills', 'All settled.'));
  await expect(page.locator('#stateHost .st-title')).toHaveText('No open bills');
  await expect(page.locator('#stateHost .st-sub')).toHaveText('All settled.');

  // error with a working retry button
  await page.evaluate(() => {
    window.__retried = 0;
    window.AppStates.error('#stateHost', 'Could not reach Zoho', () => { window.__retried++; });
  });
  await expect(page.locator('#stateHost .st-retry')).toBeVisible();
  await page.locator('#stateHost .st-retry').click();
  expect(await page.evaluate(() => window.__retried)).toBe(1);

  // clear
  await page.evaluate(() => window.AppStates.clear('#stateHost'));
  await expect(page.locator('#stateHost')).toBeEmpty();
});
