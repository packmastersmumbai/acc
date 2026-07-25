/**
 * Bill posting. Verified shape (_probe_writes2.py): a bill line needs a tax_id
 * (error 110802 without). Depends on zohoPost.
 *
 * WRITE PATH not exercised live during dev (user constraint); shape verified in
 * the session audit. TAX_ID is pure and unit-tested.
 */

// Verified tax_id map (Global Constraints). Keyed by "<pct>|<inter?>".
var TAX_IDS = {
  '0|false':  '1161923000000062115', // GST0
  '5|false':  '1161923000000062129', // GST5
  '18|false': '1161923000000062145', // GST18
  '0|true':   '1161923000000062093', // IGST0
  '5|true':   '1161923000000062123', // IGST5
  '18|true':  '1161923000000062139'  // IGST18
};

/** @param {number} pct 0|5|18  @param {boolean} inter out-of-state → IGST */
function TAX_ID(pct, inter) {
  var key = pct + '|' + (inter ? 'true' : 'false');
  var id = TAX_IDS[key];
  if (!id) throw new Error('No tax_id for GST ' + pct + '% inter=' + !!inter);
  return id;
}

/**
 * Post a purchase bill.
 * obj: {vendorId, billNumber, date, description, amount, gstPct, inter,
 *       expenseAccountId}. reference_number/bill_number capped at 45 chars.
 */
/**
 * Expense accounts offered when posting a scanned bill, default first.
 *
 * Cost of Goods Sold is the default because it is what this org actually uses:
 * across the 142 most recent bills, 268 line items hit COGS vs 6 everything
 * else (Other Expenses 5, Travel 1) — 97.8%. The rest of the chart exists but
 * is effectively unused for bills, so it is not offered here; a bill needing
 * one of those is rare enough to belong in Zoho directly.
 */
var EXPENSE_ACCOUNTS = [
  { id: '1161923000000034003', name: 'Cost of Goods Sold' },
  { id: '1161923000000000460', name: 'Other Expenses' },
  { id: '1161923000000000418', name: 'Travel Expense' },
  { id: '1161923000000000457', name: 'Repairs and Maintenance' },
  { id: '1161923000000000400', name: 'Office Supplies' }
];

var DEFAULT_EXPENSE_ACCOUNT_ID = '1161923000000034003'; // Cost of Goods Sold

/** Accounts the scan screen offers, default first. */
function getExpenseAccounts() { return EXPENSE_ACCOUNTS; }

/**
 * The FULL expense chart, for reconcile — bank rows are card charges, gateway
 * fees, statutory payments and the like, so the short bill list is too narrow.
 * Live from Zoho (cached) so accounts added there appear without a code change.
 * Falls back to the short list if the chart cannot be read.
 */
function getAllExpenseAccounts() {
  return cachedRead('expense_accounts', 3600, function () {
    try {
      // No filter_by: AccountType.* returns HTTP 400 on this org (verified), and
      // the whole chart is 70 rows on one page, so filter client-side instead.
      var TYPES = { expense: 1, cost_of_goods_sold: 1, other_expense: 1 };
      var r = zohoGet('chartofaccounts', { per_page: 200 });
      var out = [];
      (r.chartofaccounts || []).forEach(function (a) {
        if (!TYPES[a.account_type]) return;
        if (a.is_active === false) return;
        out.push({ id: a.account_id, name: a.account_name });
      });
      if (!out.length) return EXPENSE_ACCOUNTS;
      // default (COGS) first, then alphabetical
      out.sort(function (a, b) {
        if (a.id === DEFAULT_EXPENSE_ACCOUNT_ID) return -1;
        if (b.id === DEFAULT_EXPENSE_ACCOUNT_ID) return 1;
        return a.name.localeCompare(b.name);
      });
      return out;
    } catch (e) {
      console.error('getAllExpenseAccounts fell back: ' + e);
      return EXPENSE_ACCOUNTS;
    }
  });
}

function postBill(obj) {
  var line = {
    account_id: obj.expenseAccountId || DEFAULT_EXPENSE_ACCOUNT_ID,
    name: (obj.description || 'Goods').slice(0, 100),
    rate: obj.amount,
    quantity: 1,
    tax_id: TAX_ID(obj.gstPct, obj.inter)
  };
  var body = {
    vendor_id: obj.vendorId,
    bill_number: String(obj.billNumber || '').slice(0, 45),
    date: obj.date,
    line_items: [line]
  };
  // Link the archived scan (Drive) to the record it produced, so the bill in
  // Zoho points back at the original document. notes is a plain text field —
  // verified live to exist and be writable on bills.
  if (obj.scanUrl) body.notes = 'Scanned document: ' + obj.scanUrl;
  var res = zohoPost('bills', body);
  cacheBustAll();  // a new bill changes payable + attention
  return { success: true, bill_id: res.bill.bill_id };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TAX_ID: TAX_ID, TAX_IDS: TAX_IDS,
                     EXPENSE_ACCOUNTS: EXPENSE_ACCOUNTS,
                     DEFAULT_EXPENSE_ACCOUNT_ID: DEFAULT_EXPENSE_ACCOUNT_ID };
}
