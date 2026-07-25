const { test, expect } = require('@playwright/test');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ctx = { module: { exports: {} } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/Home.js'), 'utf8'), ctx);

test('normParty collapses casing and whitespace', () => {
  expect(ctx.normParty('Yash Poly Plast')).toBe('YASH POLY PLAST');
  expect(ctx.normParty('YASH  POLY   PLAST ')).toBe('YASH POLY PLAST');
});

test('rollupContacts merges casing-duplicate parties into one entry', () => {
  const roll = ctx.rollupContacts([
    { contact_name: 'Yash Poly Plast', outstanding_payable_amount: '5000', outstanding_receivable_amount: 0 },
    { contact_name: 'YASH POLY PLAST', outstanding_payable_amount: '3000', outstanding_receivable_amount: 0 },
    { contact_name: 'Henkel', outstanding_receivable_amount: '10000', outstanding_payable_amount: 0 },
  ]);
  // one merged Yash entry at 8000, not two
  const yash = roll.attention.filter((p) => ctx.normParty(p.name) === 'YASH POLY PLAST');
  expect(yash.length).toBe(1);
  expect(yash[0].amount).toBe(8000);
  // totals
  expect(roll.pay).toBe(8000);
  expect(roll.recv).toBe(10000);
});

test('rollupContacts sorts attention by largest balance and skips zero-balance', () => {
  const roll = ctx.rollupContacts([
    { contact_name: 'Small', outstanding_payable_amount: '100', outstanding_receivable_amount: 0 },
    { contact_name: 'Big', outstanding_payable_amount: '90000', outstanding_receivable_amount: 0 },
    { contact_name: 'Settled', outstanding_payable_amount: '0', outstanding_receivable_amount: 0 },
  ]);
  expect(roll.attention.map((p) => p.name)).toEqual(['Big', 'Small']); // Settled excluded
});
