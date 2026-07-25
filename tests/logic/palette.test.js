const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { normalize, assertClean } = require('../../tools/normalize-palette');

// Enforces the Industrial Ledger palette: no shipped screen (src/pages/*.html)
// may contain a banned drift token, and the normalizer must clean a drifted page.

test('normalize rewrites Material drift to emerald/stone and passes the gate', () => {
  const drifted =
    '<style>body{background:#f6fbf5}.btn{background:#005d42}.hr{border-color:#bdc9c1}</style>';
  const out = normalize(drifted);
  expect(out).toContain('#047857'); // emerald
  expect(out).toContain('#fafaf9'); // stone
  expect(out).toContain('#e7e5e4'); // hairline
  expect(out).not.toContain('#005d42');
  expect(out).not.toContain('#f6fbf5');
});

test('normalize refuses an un-fixable page (Precision Ledger blue + Inter)', () => {
  const blue = "<style>body{font-family:'Inter'}.p{color:#004ac6}</style>";
  expect(() => normalize(blue)).toThrow(/banned tokens survived/);
});

test('every shipped page in src/pages (incl. shared/) is palette-clean', () => {
  const root = path.join(__dirname, '../../src/pages');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? walk(p) : (e.name.endsWith('.html') ? [p] : []);
  });
  for (const p of walk(root)) {
    const html = fs.readFileSync(p, 'utf8');
    expect(() => assertClean(html), `${path.relative(root, p)} has banned palette tokens`).not.toThrow();
  }
});
