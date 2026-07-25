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

test('rollupContacts carries contact_id so rows can open a ledger', () => {
  const roll = ctx.rollupContacts([
    { contact_id: '111', contact_name: 'Henkel', outstanding_receivable_amount: '10000', outstanding_payable_amount: 0 },
  ]);
  expect(roll.attention[0].contact_id).toBe('111');
  expect(roll.attention[0].contact_ids).toEqual(['111']);
});

test('merged casing-duplicates keep every id, and open the largest-balance one', () => {
  const roll = ctx.rollupContacts([
    { contact_id: 'small', contact_name: 'Yash Poly Plast', outstanding_payable_amount: '3000', outstanding_receivable_amount: 0 },
    { contact_id: 'big',   contact_name: 'YASH POLY PLAST', outstanding_payable_amount: '5000', outstanding_receivable_amount: 0 },
  ]);
  const yash = roll.attention[0];
  expect(yash.amount).toBe(8000);
  // no id silently lost in the merge...
  expect(yash.contact_ids.sort()).toEqual(['big', 'small']);
  // ...and the click target is the record holding most of the money
  expect(yash.contact_id).toBe('big');
});

test('contacts with no contact_id stay inert rather than borrowing another id', () => {
  const roll = ctx.rollupContacts([
    { contact_name: 'Nameless', outstanding_payable_amount: '500', outstanding_receivable_amount: 0 },
  ]);
  expect(roll.attention[0].contact_id).toBe('');
  expect(roll.attention[0].contact_ids).toEqual([]);
});

test('rollupContacts sorts attention by largest balance and skips zero-balance', () => {
  const roll = ctx.rollupContacts([
    { contact_name: 'Small', outstanding_payable_amount: '100', outstanding_receivable_amount: 0 },
    { contact_name: 'Big', outstanding_payable_amount: '90000', outstanding_receivable_amount: 0 },
    { contact_name: 'Settled', outstanding_payable_amount: '0', outstanding_receivable_amount: 0 },
  ]);
  expect(roll.attention.map((p) => p.name)).toEqual(['Big', 'Small']); // Settled excluded
});
