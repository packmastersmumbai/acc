/**
 * Party ledger: a contact's open invoices (for the mark-paid flow).
 * Read-only. Depends on zohoGet.
 */
function getPartyLedger(contactId) {
  var c = zohoGet('contacts/' + contactId).contact;
  var invoices = [], page = 1;
  while (true) {
    var r = zohoGet('invoices', { customer_id: contactId, per_page: 200, page: page });
    (r.invoices || []).forEach(function (i) {
      if (parseFloat(i.balance || 0) > 0) {
        invoices.push({
          invoice_id: i.invoice_id, invoice_number: i.invoice_number,
          date: i.date, balance: parseFloat(i.balance), status: i.status
        });
      }
    });
    if (!r.page_context || !r.page_context.has_more_page) break;
    page++;
  }
  return {
    contact_name: c.contact_name,
    outstanding: parseFloat(c.outstanding_receivable_amount || 0),
    invoices: invoices
  };
}
