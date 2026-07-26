/**
 * Expenses — the receipt half of "captures bills/receipts by photo".
 *
 * A BILL is money owed to a vendor and settled later; an EXPENSE is money
 * already spent (petty cash, fuel, courier, parking). They are different Zoho
 * endpoints and different accounting, so a photographed receipt must not be
 * posted as a bill: doing so would create a payable that is never paid.
 *
 * VERIFIED against the live API (probe, since this org had no expense to copy):
 *   account_id  and  amount  are the only REQUIRED fields.
 *   date, vendor_id, paid_through_account_id, reference_number, description,
 *   tax_id are optional.
 * Posting {account_id, amount} alone returns 201 and creates the record — this
 * endpoint is far less strict than /bills, so validate before calling it.
 *
 * Depends on zohoPost + getAllExpenseAccounts (Bills.js).
 */

/** Where the money came out of. Petty Cash first — the common receipt case. */
var PAID_THROUGH_ACCOUNTS = [
  { id: '1161923000000000361', name: 'Petty Cash' },
  { id: '1161923000000540009', name: 'PACK MASTERS (Axis)' },
  { id: '1161923000000507001', name: 'Pack Masters UBI' },
  { id: '1161923000000539111', name: 'PM IDFC' },
  { id: '1161923000000000358', name: 'Undeposited Funds' }
];

var DEFAULT_PAID_THROUGH_ID = '1161923000000000361';   // Petty Cash

/** Accounts the scan screen offers for "paid through", default first. */
function getPaidThroughAccounts() { return PAID_THROUGH_ACCOUNTS; }

/**
 * Record a receipt as an expense.
 *
 * obj: {amount, accountId?, paidThroughId?, date?, vendorId?, reference?,
 *       description?, gstPct?, inter?, scanUrl?}
 * @return {{success:true, expense_id:string, amount:number}}
 */
function postExpense(obj) {
  obj = obj || {};

  // Guard here, not in Zoho: /expenses accepts a bare {account_id, amount} and
  // writes it, so a stray call would silently book a real expense.
  var amount = parseFloat(obj.amount);
  if (isNaN(amount) || amount <= 0) {
    throw new Error('An expense needs a positive amount');
  }
  var accountId = obj.accountId || DEFAULT_EXPENSE_ACCOUNT_ID;
  if (!accountId) throw new Error('An expense needs an expense account');

  var body = {
    account_id: accountId,
    amount: amount,
    date: obj.date || _todayIso_(),
    paid_through_account_id: obj.paidThroughId || DEFAULT_PAID_THROUGH_ID,
    reference_number: String(obj.reference || '').slice(0, 45),
    description: String(obj.description || 'Receipt').slice(0, 500)
  };

  // A receipt usually names a shop that is not a Zoho contact; only attach a
  // vendor when we actually matched one.
  if (obj.vendorId) body.vendor_id = obj.vendorId;

  // GST on a receipt is claimable input credit, so pass the tax when we read it.
  // TAX_ID throws on a rate it does not know; the tax is optional here, so an
  // unrecognised rate must not abort an otherwise valid expense.
  if (obj.gstPct) {
    try {
      body.tax_id = TAX_ID(obj.gstPct, !!obj.inter);
      body.is_inclusive_tax = true;   // receipt totals are gross
    } catch (e) { /* post without tax rather than fail */ }
  }

  // Link back to the archived image, so the paper is findable from Zoho.
  if (obj.scanUrl) {
    body.description = (body.description + ' · ' + obj.scanUrl).slice(0, 500);
  }

  var res = zohoPost('expenses', body);
  cacheBustAll();   // an expense moves the P&L figures the dashboard reads
  return {
    success: true,
    expense_id: res.expense ? res.expense.expense_id : null,
    amount: amount
  };
}

/** Delete an expense. Used only to undo a mistaken post. */
function deleteExpense(expenseId) {
  if (!expenseId) throw new Error('deleteExpense needs an expense id');
  zohoDelete('expenses/' + expenseId);
  cacheBustAll();
  return { success: true, deleted: expenseId };
}
