const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// The GitHub Pages launcher. Two things must hold:
//  1. it navigates on a pm-nav message from the APP — which, because GAS wraps
//     the page in its own sandbox frame, is a GRANDCHILD window, not the direct
//     child. A check against app.contentWindow rejects every real navigation.
//  2. it must not trust the query string it is handed: that value lands in an
//     iframe src, so an unchecked string is a redirect vector.
const LAUNCHER = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');

// Serve the launcher from a real https origin, and stand in for Google's
// origins, so the launcher's origin check is genuinely exercised.
async function serve(page) {
  await page.route('https://pm.test/**', (r) =>
    r.fulfill({ contentType: 'text/html', body: LAUNCHER }));

  // GAS shell (child) -> app page (grandchild). The grandchild is what posts.
  await page.route('https://script.google.com/**', (r) =>
    r.fulfill({
      contentType: 'text/html',
      body: '<body>gas-shell<iframe id="inner" src="https://x.googleusercontent.com/app"></iframe>' +
            '<script>window.addEventListener("message",function(e){' +
            'if(e.data&&e.data.__send)document.getElementById("inner").contentWindow.postMessage(e.data,"*");});' +
            '</script></body>',
    }));

  await page.route('https://x.googleusercontent.com/**', (r) =>
    r.fulfill({
      contentType: 'text/html',
      body: '<body>app<script>window.addEventListener("message",function(e){' +
            'if(e.data&&e.data.__send)top.postMessage({type:"pm-nav",qs:e.data.__send},"*");});' +
            '</script></body>',
    }));

  await page.goto('https://pm.test/acc/');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(400);   // let the frame chain load
}

/** Ask the app grandchild to navigate, exactly as window.go does. */
async function navigateVia(page, qs) {
  await page.evaluate((q) => {
    document.getElementById('app').contentWindow.postMessage({ __send: q }, '*');
  }, qs);
  await page.waitForTimeout(400);
  return page.evaluate(() => document.getElementById('app').src);
}

test('a pm-nav message from the nested app frame re-points the iframe', async ({ page }) => {
  await serve(page);
  const src = await navigateVia(page, 'p=reconcile&id=42');
  expect(src).toContain('p=reconcile');
  expect(src).toContain('id=42');
  expect(src).toContain('script.google.com/macros/s/');
});

test('the clean wrapper url is kept, not the GAS url', async ({ page }) => {
  await serve(page);
  await navigateVia(page, 'p=scan');
  expect(page.url()).toContain('pm.test');
  expect(page.url()).not.toContain('script.google.com');
});

test('unknown query keys are dropped, not forwarded into the iframe src', async ({ page }) => {
  await serve(page);
  const src = await navigateVia(page, 'p=home&evil=https://attacker.test&redirect=x');
  expect(src).toContain('p=home');
  expect(src).not.toContain('attacker.test');
  expect(src).not.toContain('evil');
  expect(src).not.toContain('redirect');
});

test('a message from a non-Google origin is ignored', async ({ page }) => {
  await serve(page);
  const before = await page.evaluate(() => document.getElementById('app').src);
  await page.evaluate(() => {
    // same shape, wrong sender: the top window itself
    window.postMessage({ type: 'pm-nav', qs: 'p=reconcile' }, '*');
  });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => document.getElementById('app').src)).toBe(before);
});
