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
