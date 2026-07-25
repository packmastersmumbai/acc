/**
 * Bank reconciliation: list uncategorized txns, suggest a match per txn.
 *
 * Verified (contract-tested): uncategorized uses the BASE endpoint +
 * status=uncategorized (NOT the /uncategorized collection); the match-discovery
 * endpoint returns code 0 with matching_transactions/matching_documents.
 *
 * acceptMatch (the WRITE) is a SPIKE gated on the user — the POST body is unknown
 * and categorizing is a live write (banned during dev). It is NOT guessed here.
 * Depends on zohoGet/zohoPost.
 */

/** List all uncategorized bank txns for an account (paged, cached). */
function uncategorized(bankAccountId, force) {
  if (force) cacheBust('uncategorized');
  return cachedRead('uncategorized', 300, function () {
    return uncategorizedFresh_(bankAccountId);
  });
}

/** Uncached — pages the whole uncategorized list (hundreds of rows). */
function uncategorizedFresh_(bankAccountId) {
  var out = [], page = 1;
  while (true) {
    var r = zohoGet('banktransactions',
      { account_id: bankAccountId, status: 'uncategorized', per_page: 200, page: page });
    (r.banktransactions || []).forEach(function (t) {
      out.push({
        transactionId: t.transaction_id, date: t.date,
        amount: parseFloat(t.amount), type: t.transaction_type,
        narration: t.description || t.payee || ''
      });
    });
    if (!r.page_context || !r.page_context.has_more_page) break;
    page++;
  }
  return out;
}

/**
 * Ask Zoho for the best match for a txn. Returns the top-ranked candidate with a
 * confidence label, or null if none. Read-only.
 */
function suggestMatch(txn) {
  var m = zohoGet('banktransactions/uncategorized/' + txn.transactionId + '/match');
  var docs = (m.matching_transactions && m.matching_transactions.length)
    ? m.matching_transactions
    : (m.matching_documents || []);
  if (!docs.length) return null;
  var top = docs[0];
  var amtEqual = Math.abs(parseFloat(top.amount || 0) - Math.abs(txn.amount)) < 1;
  return {
    type: top.transaction_type || top.type,
    id: top.transaction_id || top.invoice_id || top.bill_id,
    label: top.reference_number || top.entity_number || top.name || '',
    confidence: amtEqual ? 'amount+date' : 'amount'
  };
}

/**
 * Book an uncategorized txn as an expense — the path that actually CLEARS the
 * backlog. Zoho finds no match for most of these rows (they are card charges,
 * gateway fees, statutory payments — not settlements of any invoice or bill),
 * so matching alone would leave them stuck.
 *
 * Endpoint + body per Zoho's OpenAPI spec (categorize-as-expense-request).
 * paid_through_account_id is the BANK account the money left; account_id is the
 * expense head it is booked to.
 *
 * @param {string} transactionId
 * @param {{accountId:string, bankAccountId:string, date:string, amount:number,
 *          description:string, referenceNumber:string}} obj
 */
function categorizeAsExpense(transactionId, obj) {
  if (!transactionId) throw new Error('categorizeAsExpense: transactionId required');
  if (!obj || !obj.accountId) throw new Error('categorizeAsExpense: an expense account is required');
  if (!obj.bankAccountId) throw new Error('categorizeAsExpense: bankAccountId required');

  // Same staleness guard as acceptMatch: the row list may be stale, and
  // re-booking an already-categorized txn would double-count the expense.
  var current = zohoGet('banktransactions/' + transactionId).banktransaction;
  var status = current && (current.status || current.transaction_status);
  if (status && status !== 'uncategorized') {
    throw new Error('Already ' + status + ' in Zoho — refresh before booking');
  }

  var body = {
    account_id: obj.accountId,
    paid_through_account_id: obj.bankAccountId,
    date: obj.date,
    amount: obj.amount,
    reference_number: String(obj.referenceNumber || '').slice(0, 100),
    description: String(obj.description || '').slice(0, 500)
  };
  zohoPost('banktransactions/uncategorized/' + transactionId + '/categorize/expenses', body);
  cacheBustAll();
  return { success: true, transactionId: transactionId };
}

/**
 * Accept a match — categorizes an uncategorized bank txn against a document.
 * This is a WRITE.
 *
 * Body confirmed against Zoho's official OpenAPI spec (bank-transactions.yml,
 * schema match-a-transaction-request): a transactions_to_be_matched array of
 * {transaction_id, transaction_type}.
 *
 * Re-verifies the txn is STILL uncategorized immediately before posting: the
 * caller's list may be minutes or days old, and matching an already-categorized
 * txn corrupts the reconciliation.
 */
function acceptMatch(transactionId, matchObj) {
  if (!transactionId) throw new Error('acceptMatch: transactionId required');
  if (!matchObj || !matchObj.id || !matchObj.type) {
    throw new Error('acceptMatch: match must carry both id and type');
  }

  var current = zohoGet('banktransactions/' + transactionId).banktransaction;
  var status = current && (current.status || current.transaction_status);
  if (status && status !== 'uncategorized') {
    throw new Error('Already ' + status + ' in Zoho — refresh before accepting');
  }

  var body = {
    transactions_to_be_matched: [
      { transaction_id: matchObj.id, transaction_type: matchObj.type }
    ]
  };
  zohoPost('banktransactions/uncategorized/' + transactionId + '/match', body);
  // this txn just left the uncategorized list and moved a balance
  cacheBustAll();
  return { success: true, transactionId: transactionId };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { suggestMatch: suggestMatch, uncategorized: uncategorized };
}
