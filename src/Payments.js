/**
 * Payments. Verified shapes:
 *  - vendorpayments (_probe_writes2.py): {vendor_id, payment_mode, date, amount,
 *    bills:[{bill_id, amount_applied}]}  — key is amount_applied, NOT amount.
 *  - customerpayments (_pmt.py):        {customer_id, payment_mode, date, amount,
 *    invoices:[{invoice_id, amount_applied}]}.
 * markInvoicePaid reads the invoice balance LIVE before applying (Global
 * Constraints), so a stale UI figure never over/under-applies.
 *
 * WRITE PATHS not exercised live during dev (user constraint); shapes verified
 * in the session audit. Depends on zohoGet/zohoPost.
 */

/**
 * Mark an EXISTING invoice paid in full via a customer payment. Reads balance
 * live, applies exactly that. (Does NOT create invoices — descoped.)
 * obj: {invoiceId, paymentMode?, date?, reference?}
 */
function markInvoicePaid(obj) {
  var inv = zohoGet('invoices/' + obj.invoiceId).invoice;
  var balance = parseFloat(inv.balance || 0);
  if (balance <= 0) return { success: true, alreadyPaid: true, applied: 0 };

  var body = {
    customer_id: inv.customer_id,
    payment_mode: obj.paymentMode || 'Bank Transfer',
    date: obj.date || _todayIso_(),
    amount: balance,
    reference_number: String(obj.reference || '').slice(0, 45),
    invoices: [{ invoice_id: obj.invoiceId, amount_applied: balance }]
  };
  var res = zohoPost('customerpayments', body);
  cacheBustAll();  // payment moves receivable/overdue
  return { success: true, payment_id: res.payment.payment_id, applied: balance };
}

/**
 * Pay a vendor bill (full or partial).
 * obj: {vendorId, billId, amount, paymentMode?, date?, reference?}
 */
function payVendorBill(obj) {
  var body = {
    vendor_id: obj.vendorId,
    payment_mode: obj.paymentMode || 'Bank Transfer',
    date: obj.date || _todayIso_(),
    amount: obj.amount,
    reference_number: String(obj.reference || '').slice(0, 45),
    bills: [{ bill_id: obj.billId, amount_applied: obj.amount }]
  };
  var res = zohoPost('vendorpayments', body);
  cacheBustAll();  // payment moves payable
  return { success: true, payment_id: res.payment.payment_id };
}

function _todayIso_() {
  return Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
}
