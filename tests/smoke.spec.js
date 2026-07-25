const { test } = require('./helpers/fixture');
const { expect } = require('@playwright/test');

// Proves the Playwright + GAS-mock harness works before any real screen exists.
test('harness loads a page and the mock bridge is present', async ({ page, loadPage }) => {
  await loadPage('_smoke');
  await expect(page.locator('#t')).toHaveText('ok');

  // google.script.run mock is injected and chainable
  const hasMock = await page.evaluate(() =>
    typeof window.google?.script?.run?.withSuccessHandler === 'function');
  expect(hasMock).toBe(true);

  // and a seeded method returns Zoho-shaped data through the chain
  const home = await page.evaluate(() => new Promise((resolve) => {
    window.google.script.run.withSuccessHandler(resolve).getHomeData();
  }));
  expect(home.success).toBe(true);
  expect(home.unreconciled).toBe(517);
});
