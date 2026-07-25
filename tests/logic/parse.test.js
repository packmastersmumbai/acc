const { test, expect } = require('@playwright/test');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

// Load src/Parse.js as pure functions via a vm shim (no browser, no GAS).
const ctx = { module: { exports: {} } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/Parse.js'), 'utf8'), ctx);

test('parseGstin derives pan and state code', () => {
  const r = ctx.parseGstin('GSTIN 27AABFY9773F1ZN TAX INVOICE');
  expect(r.gstin).toBe('27AABFY9773F1ZN');
  expect(r.pan).toBe('AABFY9773F');
  expect(r.stateCode).toBe('27');
});

test('parseGstin returns null when no GSTIN present', () => {
  expect(ctx.parseGstin('just some text, no tax id here')).toBe(null);
  expect(ctx.parseGstin('')).toBe(null);
});

test('interStateFrom: 27 (Maharashtra) is intra, others inter', () => {
  expect(ctx.interStateFrom('27')).toBe(false);
  expect(ctx.interStateFrom('06')).toBe(true); // Haryana → IGST
  expect(ctx.interStateFrom('29')).toBe(true); // Karnataka → IGST
});

test('parseBill extracts supplier, gstin, invoice no, amount, gst%', () => {
  const ocr = [
    'Yash Poly Plast',
    'TAX INVOICE',
    'GSTIN 27AABFY9773F1ZN',
    'Invoice No: YPP/24-25/1182',
    'CGST 9% SGST 9% (GST 18%)',
    'Grand Total  1,74,378.00',
  ].join('\n');
  const b = ctx.parseBill(ocr);
  expect(b.gstin).toBe('27AABFY9773F1ZN');
  expect(b.invoiceNo).toBe('YPP/24-25/1182');
  expect(b.amount).toBe(174378);
  expect(b.gstPct).toBe(18);
  expect(b.supplier).toBe('Yash Poly Plast');
});

test('parseBill picks the largest figure as the total', () => {
  const b = ctx.parseBill('Qty 5\nRate 200\nSubtotal 1,000\nGST 18%\nTotal 1,180');
  expect(b.amount).toBe(1180);
  expect(b.gstPct).toBe(18);
});

test('parseBill degrades gracefully on sparse text', () => {
  const b = ctx.parseBill('handwritten note');
  expect(b.gstin).toBe(null);
  expect(b.supplier).toBe('handwritten note');
});
