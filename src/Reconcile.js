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
 * SPIKE — accept a match (categorize). Body is UNVERIFIED; do NOT call in dev.
 * Resolve the exact POST body by capturing the Zoho web-UI request (devtools)
 * with the user's authorization for ONE real categorize, or from Zoho API docs.
 * Until then the reconcile UI keeps Accept disabled (feature flag, Task 11).
 */
function acceptMatch(transactionId, matchObj) {
  throw new Error('acceptMatch is a gated spike: POST body unverified. ' +
    'Resolve via authorized devtools capture before enabling.');
  // Likely body (to confirm):
  // { transactions_to_be_matched: [{ transaction_id: matchObj.id,
  //                                  transaction_type: matchObj.type }] }
  // return zohoPost('banktransactions/uncategorized/' + transactionId + '/match', body);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { suggestMatch: suggestMatch, uncategorized: uncategorized };
}
