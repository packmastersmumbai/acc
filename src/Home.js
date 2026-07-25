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
 * Pure — unit-tested. contacts: [{contact_name, outstanding_receivable_amount,
 * outstanding_payable_amount}]. Returns {recv, pay, attention:[{name,amount}]}.
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
      if (!byParty[k]) byParty[k] = { name: c.contact_name, amount: 0 };
      byParty[k].amount += bal;
    }
  });
  var attention = Object.keys(byParty).map(function (k) { return byParty[k]; })
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
    return { name: p.name, gap: '', amount: p.amount, overdue: false };
  });
  return { receivable: roll.recv, payable: roll.pay, overdue: overdue,
           unreconciled: unreconciled, attention: attention };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { normParty: normParty, rollupContacts: rollupContacts };
}
