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
