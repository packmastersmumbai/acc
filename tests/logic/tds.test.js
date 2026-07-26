const { test, expect } = require('@playwright/test');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

// Payments.js with stubbed Zoho + GAS globals, so the TDS split can be asserted
// without a deploy or a live write.
function load(invoice) {
  const posted = [];
  const ctx = {
    module: { exports: {} },
    zohoGet: () => ({ invoice: invoice }),
    zohoPost: (p, body) => {
      posted.push({ path: p, body: body });
      return { payment: { payment_id: 'P1' } };
    },
    cacheBustAll: () => {},
    Utilities: { formatDate: () => '2026-07-26' },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/Payments.js'), 'utf8'), ctx);
  ctx.__posted = posted;
  return ctx;
}

const INV = { customer_id: 'C1', balance: '100000' };

test('no TDS: cash received equals the invoice balance', () => {
  const ctx = load(INV);
  const r = ctx.markInvoicePaid({ invoiceId: 'I1' });
  const body = ctx.__posted[0].body;
  expect(body.amount).toBe(100000);
  expect(body.invoices[0].amount_applied).toBe(100000);
  expect('tax_amount_withheld' in body).toBe(false);
  expect(r.tds).toBe(0);
});

// The whole point: cash in is LESS than the invoice, but the invoice still
// clears fully. Applying only the cash would leave it permanently open.
test('TDS: invoice clears in full while less cash is received', () => {
  const ctx = load(INV);
  const r = ctx.markInvoicePaid({ invoiceId: 'I1', tdsAmount: 2000 });
  const body = ctx.__posted[0].body;

  expect(body.amount).toBe(98000);                        // cash received
  expect(body.invoices[0].amount_applied).toBe(100000);   // invoice cleared
  expect(body.tax_amount_withheld).toBe(2000);
  expect(body.tds_type).toBe('income_tds');
  expect(r.received).toBe(98000);
  expect(r.applied).toBe(100000);
});

test('TDS books to the TDS Receivable account, not a guess', () => {
  const ctx = load(INV);
  ctx.markInvoicePaid({ invoiceId: 'I1', tdsAmount: 603 });
  // verified against real payment #124 in this org
  expect(ctx.__posted[0].body.tax_account_id).toBe('1161923000001082001');
});

test('a TDS at or above the balance is refused, not applied', () => {
  // Would post a zero/negative payment and leave the invoice open.
  for (const bad of [100000, 150000]) {
    const ctx = load(INV);
    const r = ctx.markInvoicePaid({ invoiceId: 'I1', tdsAmount: bad });
    expect(r.tds).toBe(0);
    expect(ctx.__posted[0].body.amount).toBe(100000);
  }
});

test('junk TDS input is ignored rather than corrupting the payment', () => {
  for (const bad of ['', null, undefined, 'abc', -50, 0]) {
    const ctx = load(INV);
    const r = ctx.markInvoicePaid({ invoiceId: 'I1', tdsAmount: bad });
    expect(r.tds).toBe(0);
    expect(ctx.__posted[0].body.amount).toBe(100000);
  }
});

test('TDS is rounded to paise, never carried as float noise', () => {
  const ctx = load(INV);
  const r = ctx.markInvoicePaid({ invoiceId: 'I1', tdsAmount: 237.2857 });
  expect(r.tds).toBe(237.29);
  expect(ctx.__posted[0].body.amount).toBe(100000 - 237.29);
});

test('an already-paid invoice is not double-paid', () => {
  const ctx = load({ customer_id: 'C1', balance: '0' });
  const r = ctx.markInvoicePaid({ invoiceId: 'I1', tdsAmount: 500 });
  expect(r.alreadyPaid).toBe(true);
  expect(ctx.__posted.length).toBe(0);
});

test('vendor payments are untouched by the TDS path', () => {
  const ctx = load(INV);
  ctx.payVendorBill({ vendorId: 'V1', billId: 'B1', amount: 5000 });
  const body = ctx.__posted[0].body;
  expect(body.bills[0].amount_applied).toBe(5000);
  expect('tax_amount_withheld' in body).toBe(false);
});
