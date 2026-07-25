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
        byParty[k] = { name: c.contact_name, amount: 0, recv: 0, pay: 0,
                       contact_id: '', contact_ids: [], _topBal: -1 };
      }
      var e = byParty[k];
      e.amount += bal;
      e.recv += ro; e.pay += po;
      if (c.contact_id) {
        e.contact_ids.push(c.contact_id);
        if (bal > e._topBal) { e._topBal = bal; e.contact_id = c.contact_id; }
      }
    }
  });
  var attention = Object.keys(byParty).map(function (k) {
      var e = byParty[k];
      var side = partySide_(e.recv, e.pay);
      // stats is filled by the caller (getHomeDataFresh_) from the overdue set;
      // rollupContacts alone only knows balances, so gaps refine there.
      return { name: e.name, amount: e.amount, side: side,
               gap: attentionGap_(side, e.contact_ids.length, 0, 0),
               contact_id: e.contact_id, contact_ids: e.contact_ids };
    })
    .sort(function (a, b) { return b.amount - a.amount; });
  return { recv: recv, pay: pay, attention: attention };
}

/** Which direction the money runs. 'both' is kept distinct — netting it would
 *  hide a party we are simultaneously chasing and paying. */
function partySide_(recv, pay) {
  if (recv > 0 && pay > 0) return 'both';
  return recv > 0 ? 'receivable' : 'payable';
}

/**
 * The reason a party is on the attention list. Direction ("they owe us") is
 * deliberately NOT stated — it restates the column the figure already sits in
 * and tells the user nothing. Only facts they cannot see at a glance go here:
 * how overdue the oldest document is, how many documents are open, and whether
 * the party is split across duplicate Zoho records.
 */
function attentionGap_(side, idCount, oldestDays, docCount) {
  var bits = [];
  if (oldestDays > 0) bits.push(oldestDays + 'd overdue');
  if (docCount > 1) bits.push(docCount + ' open');
  if (side === 'both') bits.push('owed both ways');
  // Casing duplicates are a real data problem the user should fix in Zoho —
  // the merge hides them from the figure, not from the reason.
  if (idCount > 1) bits.push(idCount + ' duplicate records');
  return bits.join(' · ');
}

function getHomeData(force) {
  if (force) cacheBust('home_data');
  return cachedRead('home_data', 600, getHomeDataFresh_);
}

/** Uncached read — pages every contact, invoice and uncategorized txn. */
function getHomeDataFresh_() {
  // receivable / payable / attention — from the contact list (carries outstanding)
  var all = [], page = 1;
  while (true) {
    var r = zohoGet('contacts', { per_page: 200, page: page });
    (r.contacts || []).forEach(function (c) { all.push(c); });
    if (!r.page_context || !r.page_context.has_more_page) break;
    page++;
  }
  var roll = rollupContacts(all);

  // overdue — sum balances of overdue invoices, and remember WHICH customers are
  // overdue so the attention list can flag the right rows instead of guessing.
  var overdue = 0, overdueBy = {}; page = 1;
  var todayMs = new Date().getTime();
  while (true) {
    var ri = zohoGet('invoices', { per_page: 200, page: page, status: 'overdue' });
    (ri.invoices || []).forEach(function (i) {
      overdue += parseFloat(i.balance || 0);
      if (!i.customer_name) return;
      var k = normParty(i.customer_name);
      if (!overdueBy[k]) overdueBy[k] = { days: 0, count: 0 };
      overdueBy[k].count++;
      // Age of the OLDEST unpaid document — the number that says how bad it is.
      if (i.due_date) {
        var d = Math.floor((todayMs - new Date(i.due_date).getTime()) / 86400000);
        if (d > overdueBy[k].days) overdueBy[k].days = d;
      }
    });
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

  // `gap`/`side` come from the rollup — it is the only place that knows which
  // way the money runs and how many duplicate records were merged.
  var attention = roll.attention.slice(0, 8).map(function (p) {
    var od = overdueBy[normParty(p.name)];
    return { name: p.name,
             gap: attentionGap_(p.side, p.contact_ids.length,
                                od ? od.days : 0, od ? od.count : 0),
             side: p.side, amount: p.amount, overdue: !!od,
             contact_id: p.contact_id, contact_ids: p.contact_ids };
  });
  return { receivable: roll.recv, payable: roll.pay, overdue: overdue,
           unreconciled: unreconciled, attention: attention,
           fetchedAt: new Date().toISOString() };  // drives the "synced N ago" label
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { normParty: normParty, rollupContacts: rollupContacts };
}
