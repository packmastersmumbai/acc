/**
 * Force a Stitch-exported HTML page onto the "Industrial Ledger" design system.
 *
 * Stitch drifts the color tokens (Material green #005d42 / bg #f6fbf5, and one
 * screen went full Precision-Ledger blue). This rewrites the drift tokens to the
 * approved emerald/stone/hairline values, then GATES: if any known-bad token
 * survives, it throws — so a screen can never ship off-palette.
 *
 * Usage (programmatic): const { normalize, assertClean } = require('./normalize-palette');
 *   const fixed = normalize(rawHtml);   // throws if not clean after rewrite
 */

// drift → correct. Order matters (longest/most-specific first not needed here).
const REPLACEMENTS = [
  // primary emerald
  [/#005d42/gi, '#047857'], // Material dark green token → emerald
  [/#006c4e/gi, '#047857'], // surface-tint green → emerald
  // background stone
  [/#f6fbf5/gi, '#fafaf9'], // Material bg → warm stone
  // hairline
  [/#bdc9c1/gi, '#e7e5e4'], // Material outline-variant → hairline
];

// Tokens that must NOT survive normalization (the grep-gate).
const BANNED = [
  '#005d42', '#006c4e', '#f6fbf5', '#bdc9c1', // Material drift
  '#004ac6', '#0053db', '#faf8ff',            // Precision Ledger blue (Bharat orphan)
  "'Inter'", '"Inter"', 'family=Inter',       // wrong body font
];

function normalize(html) {
  let out = html;
  for (const [re, to] of REPLACEMENTS) out = out.replace(re, to);
  assertClean(out);
  return out;
}

function assertClean(html) {
  const hits = BANNED.filter((tok) => html.includes(tok));
  if (hits.length) {
    throw new Error('normalize-palette: banned tokens survived: ' + hits.join(', '));
  }
}

module.exports = { normalize, assertClean, REPLACEMENTS, BANNED };

// CLI: node tools/normalize-palette.js <in.html> <out.html>
if (require.main === module) {
  const fs = require('fs');
  const [, , inPath, outPath] = process.argv;
  if (!inPath || !outPath) { console.error('usage: normalize-palette.js <in> <out>'); process.exit(1); }
  const fixed = normalize(fs.readFileSync(inPath, 'utf8'));
  fs.writeFileSync(outPath, fixed);
  console.log('normalized → ' + outPath);
}
