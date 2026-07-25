const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// The GitHub Pages launcher: it must re-point its iframe on a pm-nav message
// and must NOT trust the query string it is handed — the value lands in an
// iframe src, so an unchecked string is a redirect vector.
async function loadLauncher(page) {
  const html = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
  await page.goto('data:text/html;base64,' + Buffer.from(html).toString('base64'));
  await page.waitForLoadState('domcontentloaded');
}

// Deliver a pm-nav message whose `source` really is the app iframe's window —
// the launcher rejects messages from anywhere else, and `source` cannot be
// forged on a synthetic MessageEvent. Point the frame at a local stub first,
// since script.google.com will not load inside a data: URL page.
async function navigateVia(page, qs) {
  // Park the frame on a stub that posts on demand. It must send the message
  // itself so `source` is genuinely the app frame; a data: frame is
  // opaque-origin, so the test cannot reach into it from the parent.
  await page.evaluate(async () => {
    const app = document.getElementById('app');
    app.src = 'data:text/html,<body>stub<' + 'script>' +
      'window.addEventListener("message",function(e){' +
      'if(e.data&&e.data.__send)parent.postMessage({type:"pm-nav",qs:e.data.__send},"*");});' +
      '<' + '/script></body>';
    await new Promise((r) => app.addEventListener('load', r, { once: true }));
  });

  await page.evaluate((q) => {
    document.getElementById('app').contentWindow.postMessage({ __send: q }, '*');
  }, qs);

  await page.waitForTimeout(300);
  return page.evaluate(() => document.getElementById('app').src);
}

test('a pm-nav message re-points the iframe and keeps the clean url', async ({ page }) => {
  await loadLauncher(page);
  const src = await navigateVia(page, 'p=reconcile&id=42');
  expect(src).toContain('p=reconcile');
  expect(src).toContain('id=42');
  expect(src).toContain('script.google.com/macros/s/');
});

test('unknown query keys are dropped, not forwarded into the iframe src', async ({ page }) => {
  await loadLauncher(page);
  const src = await navigateVia(page, 'p=home&evil=https://attacker.test&redirect=x');

  expect(src).toContain('p=home');
  expect(src).not.toContain('attacker.test');
  expect(src).not.toContain('evil');
  expect(src).not.toContain('redirect');
});

test('a message with no allowed keys is ignored entirely', async ({ page }) => {
  await loadLauncher(page);
  // navigateVia parks the frame on a stub; with no allowed keys the launcher
  // must leave it exactly there rather than rebuilding a GAS url.
  const after = await navigateVia(page, 'evil=1');
  expect(after).toContain('stub');
  expect(after).not.toContain('script.google.com');
});

test('the iframe always points at the configured GAS deployment', async ({ page }) => {
  await loadLauncher(page);
  const src = await page.evaluate(() => document.getElementById('app').src);
  expect(src).toContain('script.google.com/macros/s/');
});
