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

// The attention row's reason must carry facts the user CANNOT see at a glance.
// Stating the direction ("they owe us") only restates the column the figure
// already sits in, so it is deliberately absent.
test('the gap never restates the direction the column already shows', () => {
  const roll = ctx.rollupContacts([
    { contact_id: 'v', contact_name: 'Yash Poly Plast', outstanding_payable_amount: '5000', outstanding_receivable_amount: 0 },
    { contact_id: 'c', contact_name: 'Henkel', outstanding_receivable_amount: '10000', outstanding_payable_amount: 0 },
  ]);
  roll.attention.forEach((p) => {
    expect(p.gap).not.toMatch(/they owe us|we owe them/i);
  });
  // side is still exposed for callers that need the direction programmatically
  expect(roll.attention.find((p) => p.name === 'Henkel').side).toBe('receivable');
  expect(roll.attention.find((p) => p.name === 'Yash Poly Plast').side).toBe('payable');
});

test('a party owed on BOTH sides is flagged as such, not silently netted', () => {
  const roll = ctx.rollupContacts([
    { contact_id: 'b', contact_name: 'Dorf Ketal', outstanding_receivable_amount: '4000', outstanding_payable_amount: '1000' },
  ]);
  expect(roll.attention[0].side).toBe('both');
  expect(roll.attention[0].gap).toContain('owed both ways');
  expect(roll.attention[0].amount).toBe(5000);
});

test('a casing-merged party spanning duplicates says so in the gap', () => {
  const roll = ctx.rollupContacts([
    { contact_id: 'a', contact_name: 'Yash Poly Plast', outstanding_payable_amount: '3000', outstanding_receivable_amount: 0 },
    { contact_id: 'b', contact_name: 'YASH POLY PLAST', outstanding_payable_amount: '5000', outstanding_receivable_amount: 0 },
  ]);
  expect(roll.attention[0].gap).toBe('2 duplicate records');
});

test('overdue age and open-document count are what the gap actually reports', () => {
  // attentionGap_(side, idCount, oldestDays, docCount)
  expect(ctx.attentionGap_('receivable', 1, 47, 3)).toBe('47d overdue · 3 open');
  expect(ctx.attentionGap_('receivable', 1, 0, 1)).toBe('');
  expect(ctx.attentionGap_('both', 2, 12, 5)).toBe('12d overdue · 5 open · owed both ways · 2 duplicate records');
});

test('rollupContacts sorts attention by largest balance and skips zero-balance', () => {
  const roll = ctx.rollupContacts([
    { contact_name: 'Small', outstanding_payable_amount: '100', outstanding_receivable_amount: 0 },
    { contact_name: 'Big', outstanding_payable_amount: '90000', outstanding_receivable_amount: 0 },
    { contact_name: 'Settled', outstanding_payable_amount: '0', outstanding_receivable_amount: 0 },
  ]);
  expect(roll.attention.map((p) => p.name)).toEqual(['Big', 'Small']); // Settled excluded
});
