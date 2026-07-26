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

/** Zoho's TDS Receivable account for this org (verified in the chart). */
var TDS_RECEIVABLE_ACCOUNT_ID = '1161923000001082001';

/**
 * Mark an EXISTING invoice paid via a customer payment. Reads the balance live
 * and applies exactly that. (Does NOT create invoices — descoped.)
 *
 * TDS: an Indian customer deducts tax at source, so the cash received is LESS
 * than the invoice balance while the invoice must still clear in full. Zoho
 * models this as `tax_amount_withheld` + `tax_account_id` on the payment —
 * shape verified against real payments in this org (e.g. #124: amount 710661,
 * tax_amount_withheld 603, TDS Receivable). Without it, passing only the cash
 * received would leave every TDS invoice short-paid and permanently open.
 *
 * obj: {invoiceId, paymentMode?, date?, reference?, tdsAmount?}
 */
function markInvoicePaid(obj) {
  var inv = zohoGet('invoices/' + obj.invoiceId).invoice;
  var balance = parseFloat(inv.balance || 0);
  if (balance <= 0) return { success: true, alreadyPaid: true, applied: 0 };

  var tds = _validTds_(obj.tdsAmount, balance);
  var received = balance - tds;   // cash in hand; the invoice still clears fully

  var body = {
    customer_id: inv.customer_id,
    payment_mode: obj.paymentMode || 'Bank Transfer',
    date: obj.date || _todayIso_(),
    amount: received,
    reference_number: String(obj.reference || '').slice(0, 45),
    invoices: [{ invoice_id: obj.invoiceId, amount_applied: balance }]
  };

  if (tds > 0) {
    body.tax_amount_withheld = tds;
    body.tax_account_id = TDS_RECEIVABLE_ACCOUNT_ID;
    body.tds_type = 'income_tds';
  }

  var res = zohoPost('customerpayments', body);
  cacheBustAll();  // payment moves receivable/overdue
  return { success: true, payment_id: res.payment.payment_id,
           applied: balance, received: received, tds: tds };
}

/**
 * A usable TDS figure, or 0. Rejects anything that cannot be a real deduction —
 * a bad value here would silently under-apply the payment and leave the invoice
 * open, which is exactly the failure this feature exists to prevent.
 */
function _validTds_(raw, balance) {
  var n = parseFloat(raw);
  if (isNaN(n) || n <= 0) return 0;
  if (n >= balance) return 0;   // TDS can never equal or exceed the invoice
  return Math.round(n * 100) / 100;
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
