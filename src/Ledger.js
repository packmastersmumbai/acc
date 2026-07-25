/**
 * Party ledger: a contact's open documents (for the mark-paid / pay-bill flows).
 *
 * A party is a customer OR a vendor, so the ledger is side-aware: customers own
 * invoices (money in), vendors own bills (money out). Reading only the invoice
 * side left every vendor's ledger blank and stranded payVendorBill with no
 * screen. Read-only. Depends on zohoGet.
 */

/** Zoho contact_type 'vendor' → we owe them; anything else is a customer. */
function isVendorContact_(c) { return (c && c.contact_type) === 'vendor'; }

/**
 * Parties with something open, for the ledger's picker. The Ledger nav tab
 * carries no contact id, so without this the screen had nothing to show and
 * fell back to a hardcoded id that does not exist in this org (404).
 * @return {Array<{contact_id,contact_name,contact_type,side,outstanding}>}
 */
function listOpenParties() {
  var out = [], page = 1;
  while (true) {
    var r = zohoGet('contacts', { per_page: 200, page: page });
    (r.contacts || []).forEach(function (c) {
      var ro = parseFloat(c.outstanding_receivable_amount || 0);
      var po = parseFloat(c.outstanding_payable_amount || 0);
      if (ro <= 0 && po <= 0) return;
      out.push({
        contact_id: c.contact_id,
        contact_name: c.contact_name,
        contact_type: c.contact_type,
        side: isVendorContact_(c) ? 'vendor' : 'customer',
        outstanding: isVendorContact_(c) ? po : ro
      });
    });
    if (!r.page_context || !r.page_context.has_more_page) break;
    page++;
  }
  return out.sort(function (a, b) { return b.outstanding - a.outstanding; });
}

/** Page an open-document list, keeping only rows that still carry a balance. */
function openDocuments_(path, idKey, contactId, numberKey, idField) {
  var out = [], page = 1;
  while (true) {
    var params = { per_page: 200, page: page };
    params[idKey] = contactId;
    var r = zohoGet(path, params);
    (r[path] || []).forEach(function (d) {
      var bal = parseFloat(d.balance || 0);
      if (bal <= 0) return;
      out.push({
        doc_id: d[idField], doc_number: d[numberKey],
        date: d.date, due_date: d.due_date || '', balance: bal, status: d.status
      });
    });
    if (!r.page_context || !r.page_context.has_more_page) break;
    page++;
  }
  return out;
}

/**
 * @return {{contact_id, contact_name, side:'vendor'|'customer', outstanding,
 *           documents:Array, invoices:Array}}
 *   `documents` is the side-correct list. `invoices` is kept as an alias so the
 *   existing customer screen and its specs keep working unchanged.
 */
function getPartyLedger(contactId) {
  var c = zohoGet('contacts/' + contactId).contact;
  var vendor = isVendorContact_(c);

  var documents = vendor
    ? openDocuments_('bills', 'vendor_id', contactId, 'bill_number', 'bill_id')
    : openDocuments_('invoices', 'customer_id', contactId, 'invoice_number', 'invoice_id');

  var outstanding = parseFloat(
    (vendor ? c.outstanding_payable_amount : c.outstanding_receivable_amount) || 0);

  return {
    contact_id: contactId,
    contact_name: c.contact_name,
    side: vendor ? 'vendor' : 'customer',
    outstanding: outstanding,
    documents: documents,
    // legacy alias — customer screens/specs read `invoices`
    invoices: documents.map(function (d) {
      return { invoice_id: d.doc_id, invoice_number: d.doc_number,
               date: d.date, balance: d.balance, status: d.status };
    })
  };
}
