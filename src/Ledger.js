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
