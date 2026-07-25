const { test, expect } = require('@playwright/test');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

// acceptMatch body shape is fixed by Zoho's OpenAPI spec
// (match-a-transaction-request -> transactions_to_be_matched[{transaction_id,
// transaction_type}]). These lock it so a refactor cannot silently change it.
function run(txnStatus, matchObj, txnId) {
  const c = { module: { exports: {} }, posted: null };
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/Reconcile.js'), 'utf8'), c);
  c.zohoGet = () => ({ banktransaction: { status: txnStatus } });
  c.zohoPost = (p, body) => { c.posted = { path: p, body }; return { code: 0 }; };
  c.cacheBustAll = () => { c.busted = true; };   // lives in ZohoClient.js
  c.__m = matchObj;
  const id = txnId === undefined ? 'T1' : txnId;   // '' must reach the function
  const out = vm.runInContext(
    'acceptMatch(' + JSON.stringify(id) + ', __m)', c);
  return { posted: c.posted, out };
}

const MATCH = { id: 'INV9', type: 'invoice', label: 'INV-002841' };

test('acceptMatch posts the spec-mandated body to the match endpoint', () => {
  const { posted } = run('uncategorized', MATCH);
  expect(posted.path).toBe('banktransactions/uncategorized/T1/match');
  expect(posted.body).toEqual({
    transactions_to_be_matched: [{ transaction_id: 'INV9', transaction_type: 'invoice' }],
  });
});

test('acceptMatch refuses a txn Zoho already categorized', () => {
  expect(() => run('categorized', MATCH)).toThrow(/Already categorized/);
});

test('acceptMatch refuses a match missing id or type', () => {
  expect(() => run('uncategorized', { id: 'INV9' })).toThrow(/id and type/);
  expect(() => run('uncategorized', { type: 'invoice' })).toThrow(/id and type/);
});

test('acceptMatch refuses without a transaction id', () => {
  expect(() => run('uncategorized', MATCH, '')).toThrow(/transactionId required/);
});

// Booking as expense is what actually clears the backlog: most uncategorized
// rows (card charges, gateway fees, statutory payments) match no document.
function runExpense(txnStatus, obj, txnId) {
  const c = { module: { exports: {} }, posted: null, console: { error() {} } };
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(process.cwd(), 'src/Reconcile.js'), 'utf8'), c);
  c.zohoGet = () => ({ banktransaction: { status: txnStatus } });
  c.zohoPost = (p, body) => { c.posted = { path: p, body }; return { code: 0 }; };
  c.cacheBustAll = () => { c.busted = true; };
  c.__o = obj;
  vm.runInContext('categorizeAsExpense(' + JSON.stringify(txnId === undefined ? 'T1' : txnId) + ', __o)', c);
  return c;
}

const EXP = { accountId: 'ACC1', bankAccountId: 'BANK1', date: '2019-01-24',
              amount: 4530, description: 'INB/CCAVENUE.COM/CHARGE', referenceNumber: '' };

test('categorizeAsExpense posts to the expenses endpoint with both accounts', () => {
  const c = runExpense('uncategorized', EXP);
  expect(c.posted.path).toBe('banktransactions/uncategorized/T1/categorize/expenses');
  expect(c.posted.body.account_id).toBe('ACC1');
  expect(c.posted.body.paid_through_account_id).toBe('BANK1');
  expect(c.posted.body.amount).toBe(4530);
  expect(c.posted.body.date).toBe('2019-01-24');
});

test('booking busts the cache so the row cannot reappear', () => {
  expect(runExpense('uncategorized', EXP).busted).toBe(true);
});

test('booking refuses a txn Zoho already categorized (no double-count)', () => {
  expect(() => runExpense('categorized', EXP)).toThrow(/Already categorized/);
});

test('booking refuses without an expense account or bank account', () => {
  expect(() => runExpense('uncategorized', { ...EXP, accountId: '' })).toThrow(/expense account/);
  expect(() => runExpense('uncategorized', { ...EXP, bankAccountId: '' })).toThrow(/bankAccountId/);
});
