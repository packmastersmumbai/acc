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

/** List all uncategorized bank txns for an account (paged). */
function uncategorized(bankAccountId) {
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
  return { success: true, transactionId: transactionId };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { suggestMatch: suggestMatch, uncategorized: uncategorized };
}
