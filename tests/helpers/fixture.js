const { test: base } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { GAS_MOCK_SCRIPT } = require('./gas-mock');

const ROOT = path.join(__dirname, '../../src/pages');

/**
 * Load an HTML page, strip GAS template expressions, inject mock google.script.run,
 * and serve it as a data URL in the browser.
 */
async function loadPage(page, pageName) {
  const filePath = path.join(ROOT, pageName + '.html');
  let html = fs.readFileSync(filePath, 'utf8');

  // Resolve GAS includes: <?!= include('pages/xxx') ?> → the file's contents,
  // so tests exercise the REAL shared partials exactly as GAS serves them.
  html = html.replace(/<\?!?=\s*include\(\s*['"]([^'"]+)['"]\s*\)\s*\?>/g, (_, incPath) => {
    const rel = incPath.replace(/^pages\//, '');
    const incFile = path.join(ROOT, rel + '.html');
    return fs.existsSync(incFile) ? fs.readFileSync(incFile, 'utf8') : '';
  });

  // Strip GAS template tags: <?= expr ?> and <? ... ?>
  html = html.replace(/<\?=\s*[^?]+\?>/g, '"__GAS_TEMPLATE__"');
  html = html.replace(/<\?\s*[^?]+\?>/g, '');
  html = html.replace(/__GAS_TEMPLATE__/g, '""');

  // Inject mock before any other scripts. Prefer <head>; fall back to <html>
  // or bare-fragment pages (no head/html wrapper) so partial screens work too.
  const mockTag = `<script>${GAS_MOCK_SCRIPT}</script>`;
  if (html.includes('<head>')) {
    html = html.replace('<head>', '<head>' + mockTag);
  } else if (html.includes('<html')) {
    html = html.replace(/(<html[^>]*>)/, '$1' + mockTag);
  } else {
    html = mockTag + html;
  }

  // Data URL — no server needed
  const encoded = Buffer.from(html).toString('base64');
  await page.goto('data:text/html;base64,' + encoded);
  await page.waitForLoadState('domcontentloaded');
}

const test = base.extend({
  loadPage: async ({ page }, use) => {
    await use((pageName) => loadPage(page, pageName));
  },
});

module.exports = { test, loadPage };
