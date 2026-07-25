const { test, expect } = require('@playwright/test');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ctx = { module: { exports: {} } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/Bills.js'), 'utf8'), ctx);

test('TAX_ID maps intra-state (GST) correctly', () => {
  expect(ctx.TAX_ID(18, false)).toBe('1161923000000062145');
  expect(ctx.TAX_ID(5, false)).toBe('1161923000000062129');
  expect(ctx.TAX_ID(0, false)).toBe('1161923000000062115');
});

test('TAX_ID maps inter-state (IGST) correctly', () => {
  expect(ctx.TAX_ID(18, true)).toBe('1161923000000062139');
  expect(ctx.TAX_ID(5, true)).toBe('1161923000000062123');
  expect(ctx.TAX_ID(0, true)).toBe('1161923000000062093');
});

test('TAX_ID throws for an unmapped rate', () => {
  expect(() => ctx.TAX_ID(12, false)).toThrow();
});

// postBill body: the archived Drive URL must reach Zoho so the bill record
// points back at the document it was scanned from.
function postBillBody(obj) {
  const c = { module: { exports: {} }, captured: null };
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/Bills.js'), 'utf8'), c);
  c.zohoPost = (path_, body) => { c.captured = { path: path_, body: body }; return { bill: { bill_id: 'B1' } }; };
  vm.runInContext('postBill(' + JSON.stringify(obj) + ')', c);
  return c.captured.body;
}

const BASE = { vendorId: 'V1', billNumber: 'YPP/1', date: '2026-07-25',
               amount: 1000, gstPct: 18, inter: false, expenseAccountId: 'E1' };

test('postBill links the archived scan into the bill notes', () => {
  const body = postBillBody({ ...BASE, scanUrl: 'https://drive.google.com/file/d/abc/view' });
  expect(body.notes).toBe('Scanned document: https://drive.google.com/file/d/abc/view');
});

test('postBill omits notes when there is no archived scan', () => {
  const body = postBillBody(BASE);
  expect(body.notes).toBeUndefined();
});
