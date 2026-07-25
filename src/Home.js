/**
 * Home dashboard data: receivable, payable, overdue, unreconciled count, and an
 * "attention" list of the largest open balances (casing-duplicate parties merged).
 *
 * NOTE: the banktransactions endpoint's page_context has NO `total` key (verified
 * live — regression-guarded in the contract suite), so the unreconciled count is
 * derived by paging, not read from page_context. Depends on zohoGet.
 */

var AXIS_ACCOUNT_ID = '1161923000000540009';

/** normalize a party name for casing/space-insensitive dedup. */
function normParty(s) { return (s || '').toUpperCase().replace(/\s+/g, ' ').trim(); }

/**
 * Merge contacts into one entry per normalized name, summing outstanding.
 * Pure — unit-tested. contacts: [{contact_id, contact_name,
 * outstanding_receivable_amount, outstanding_payable_amount}].
 *
 * A merged row can span SEVERAL real Zoho contacts (casing duplicates), each
 * with its own contact_id. All are kept in contact_ids; contact_id is the one
 * with the largest balance — the row's click target, since that is the record
 * carrying most of the money. Returns
 * {recv, pay, attention:[{name, amount, contact_id, contact_ids}]}.
 */
function rollupContacts(contacts) {
  var recv = 0, pay = 0, byParty = {};
  (contacts || []).forEach(function (c) {
    var ro = parseFloat(c.outstanding_receivable_amount || 0);
    var po = parseFloat(c.outstanding_payable_amount || 0);
    recv += ro; pay += po;
    var bal = ro + po;
    if (bal > 0) {
      var k = normParty(c.contact_name);
      if (!byParty[k]) {
        byParty[k] = { name: c.contact_name, amount: 0,
                       contact_id: '', contact_ids: [], _topBal: -1 };
      }
      var e = byParty[k];
      e.amount += bal;
      if (c.contact_id) {
        e.contact_ids.push(c.contact_id);
        if (bal > e._topBal) { e._topBal = bal; e.contact_id = c.contact_id; }
      }
    }
  });
  var attention = Object.keys(byParty).map(function (k) {
      var e = byParty[k];
      return { name: e.name, amount: e.amount,
               contact_id: e.contact_id, contact_ids: e.contact_ids };
    })
    .sort(function (a, b) { return b.amount - a.amount; });
  return { recv: recv, pay: pay, attention: attention };
}

function getHomeData() {
  // receivable / payable / attention — from the contact list (carries outstanding)
  var all = [], page = 1;
  while (true) {
    var r = zohoGet('contacts', { per_page: 200, page: page });
    (r.contacts || []).forEach(function (c) { all.push(c); });
    if (!r.page_context || !r.page_context.has_more_page) break;
    page++;
  }
  var roll = rollupContacts(all);

  // overdue — sum balances of overdue invoices
  var overdue = 0; page = 1;
  while (true) {
    var ri = zohoGet('invoices', { per_page: 200, page: page, status: 'overdue' });
    (ri.invoices || []).forEach(function (i) { overdue += parseFloat(i.balance || 0); });
    if (!ri.page_context || !ri.page_context.has_more_page) break;
    page++;
  }

  // unreconciled — PAGE-COUNT (page_context has no `total`)
  var unreconciled = 0, up = 1;
  while (true) {
    var ru = zohoGet('banktransactions',
      { account_id: AXIS_ACCOUNT_ID, status: 'uncategorized', per_page: 200, page: up });
    unreconciled += (ru.banktransactions || []).length;
    if (!ru.page_context || !ru.page_context.has_more_page) break;
    up++;
  }

  var attention = roll.attention.slice(0, 8).map(function (p) {
    return { name: p.name, gap: '', amount: p.amount, overdue: false,
             contact_id: p.contact_id, contact_ids: p.contact_ids };
  });
  return { receivable: roll.recv, payable: roll.pay, overdue: overdue,
           unreconciled: unreconciled, attention: attention };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { normParty: normParty, rollupContacts: rollupContacts };
}
