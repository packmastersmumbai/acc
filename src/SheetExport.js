/**
 * Export the Zoho data to a Google Sheet — one flat tab per module.
 *
 * Deliberately NOT the raw backup: that JSON is 22MB with nested line_items and
 * ~76 fields on invoices, which is neither readable nor safely inside Sheets'
 * 10M-cell ceiling as the org grows. Each tab carries the columns you would
 * actually filter or pivot on; the JSON in Drive remains the complete record.
 *
 * Reads Zoho live (same pagination as Backup.js) and writes only to the user's
 * own Drive. Depends on zohoGet + _ensureFolderPath_ (Documents.js).
 */

var SHEET_NAME = 'PackMasters Accounts Data';

/**
 * Tab specs: [zoho path, response key, [[header, field] ...]].
 * Fields are verified against a real backup — not guessed.
 */
var SHEET_TABS = [
  ['contacts', 'contacts', 'Contacts', [
    ['Name', 'contact_name'], ['Type', 'contact_type'], ['GSTIN', 'gst_no'],
    ['Receivable', 'outstanding_receivable_amount'],
    ['Payable', 'outstanding_payable_amount'],
    ['Email', 'email'], ['Mobile', 'mobile'], ['Status', 'status'],
    ['Contact ID', 'contact_id']
  ]],
  ['invoices', 'invoices', 'Invoices', [
    ['Invoice #', 'invoice_number'], ['Date', 'date'], ['Due', 'due_date'],
    ['Customer', 'customer_name'], ['Total', 'total'], ['Balance', 'balance'],
    ['Status', 'status'], ['Invoice ID', 'invoice_id']
  ]],
  ['bills', 'bills', 'Bills', [
    ['Bill #', 'bill_number'], ['Date', 'date'], ['Due', 'due_date'],
    ['Vendor', 'vendor_name'], ['Total', 'total'], ['Balance', 'balance'],
    ['Status', 'status'], ['GSTIN', 'gst_no'], ['Bill ID', 'bill_id']
  ]],
  ['customerpayments', 'customerpayments', 'Payments In', [
    ['Date', 'date'], ['Customer', 'customer_name'], ['Amount', 'amount'],
    ['Mode', 'payment_mode'], ['Reference', 'reference_number'],
    ['Invoices', 'invoice_numbers'], ['Payment ID', 'payment_id']
  ]],
  ['vendorpayments', 'vendorpayments', 'Payments Out', [
    ['Date', 'date'], ['Vendor', 'vendor_name'], ['Amount', 'amount'],
    ['Mode', 'payment_mode'], ['Reference', 'reference_number'],
    ['Payment ID', 'payment_id']
  ]],
  ['creditnotes', 'creditnotes', 'Credit Notes', [
    ['Note #', 'creditnote_number'], ['Date', 'date'], ['Customer', 'customer_name'],
    ['Total', 'total'], ['Balance', 'balance'], ['Status', 'status']
  ]]
];

/** Bank transactions need the account filter, so they get their own pass. */
var BANK_TAB = ['Bank Transactions', [
  ['Date', 'date'], ['Account', 'account_name'], ['Amount', 'amount'],
  ['Dr/Cr', 'debit_or_credit'], ['Description', 'description'],
  ['Status', 'status'], ['Reference', 'reference_number'],
  ['Transaction ID', 'transaction_id']
]];

/**
 * Rebuild every tab from live Zoho.
 * @return {{spreadsheetId, url, tabs:Array<{name,rows}>, records:number}}
 */
function exportToSheet() {
  return _export_(false);
}

/**
 * Delta export: probe each module (1 call each), skip the ones that have not
 * changed, and re-read only those that have. On a quiet night this is ~9 calls
 * instead of ~35. banktransactions is always pulled whole — it has no
 * last_modified_time and its date_start filter is silently ignored (verified).
 */
function exportChangedToSheet() {
  return _export_(true);
}

function _export_(useDelta) {
  var ss = _openOrCreateSheet_();
  var summary = [], total = 0, calls = 0, skipped = [];

  var detect = useDelta ? detectChanges() : null;
  if (detect) calls += detect.calls;

  SHEET_TABS.forEach(function (spec) {
    var tabName = spec[2];

    // Unchanged AND already on the sheet → leave the tab alone.
    if (detect && detect.unchanged.indexOf(spec[0]) !== -1 && _tabHasRows_(ss, tabName)) {
      var kept = Math.max(0, ss.getSheetByName(tabName).getLastRow() - 1);
      summary.push({ name: tabName, rows: kept, skipped: true });
      total += kept;
      skipped.push(tabName);
      return;
    }

    var got = fetchDelta(spec[0], spec[1], null);   // full read for this tab
    calls += got.calls;
    _writeTab_(ss, tabName, spec[3], got.rows);
    summary.push({ name: tabName, rows: got.rows.length, skipped: false });
    total += got.rows.length;
  });

  // Always full — no incremental handle exists for this module.
  var bank = _allBankRows_();
  calls += Math.ceil(bank.length / 200) || 1;
  _writeTab_(ss, BANK_TAB[0], BANK_TAB[1], bank);
  summary.push({ name: BANK_TAB[0], rows: bank.length, skipped: false });
  total += bank.length;

  _writeStampTab_(ss, summary, total, calls, skipped);

  // Only advance the watermarks once every tab has been written successfully —
  // a mid-run failure must not convince the next run that it is up to date.
  if (detect) saveWatermarks(detect.probes);

  // Drop the default "Sheet1" a new spreadsheet is born with.
  var blank = ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1) ss.deleteSheet(blank);

  PropertiesService.getScriptProperties().setProperties({
    LAST_SHEET_EXPORT_AT: Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm'),
    LAST_SHEET_EXPORT_ROWS: String(total),
    SHEET_ID: ss.getId()
  });

  return { spreadsheetId: ss.getId(), url: ss.getUrl(), tabs: summary,
           records: total, apiCalls: calls, skipped: skipped };
}

/** Does this tab already hold data rows (beyond its header)? */
function _tabHasRows_(ss, tabName) {
  var sheet = ss.getSheetByName(tabName);
  return !!sheet && sheet.getLastRow() > 1;
}

/** {sheetId, url, scheduled, lastExport, lastRows} for the settings screen. */
function getSheetStatus() {
  var p = PropertiesService.getScriptProperties();
  var id = p.getProperty('SHEET_ID');
  return {
    sheetId: id || null,
    url: id ? 'https://docs.google.com/spreadsheets/d/' + id + '/edit' : null,
    scheduled: isSheetExportScheduled(),
    lastExport: p.getProperty('LAST_SHEET_EXPORT_AT') || null,
    lastRows: p.getProperty('LAST_SHEET_EXPORT_ROWS')
      ? parseInt(p.getProperty('LAST_SHEET_EXPORT_ROWS'), 10) : null
  };
}

/** Nightly export at 03:00 IST — an hour after the backup. Idempotent. */
var SHEET_TRIGGER_FNS = ['exportToSheet', 'exportChangedToSheet'];

function installNightlySheetExport() {
  removeNightlySheetExport();
  // The scheduled run is the DELTA one — an unattended job should not re-pull
  // 6,900 records to discover nothing moved.
  ScriptApp.newTrigger('exportChangedToSheet').timeBased().everyDays(1).atHour(3).create();
  return getSheetStatus();
}

function removeNightlySheetExport() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (SHEET_TRIGGER_FNS.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  return getSheetStatus();
}

/** Whether a nightly export trigger is armed (either variant). */
function isSheetExportScheduled() {
  return ScriptApp.getProjectTriggers().some(function (t) {
    return SHEET_TRIGGER_FNS.indexOf(t.getHandlerFunction()) !== -1;
  });
}

// ── internals ──

/** The spreadsheet, reused across runs so its URL and any filters survive. */
function _openOrCreateSheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SHEET_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id); }
    catch (e) { /* trashed or unreachable — fall through and make a new one */ }
  }
  var ss = SpreadsheetApp.create(SHEET_NAME);

  // Record the id BEFORE filing it. SpreadsheetApp.create drops the file in My
  // Drive root; if the move then failed we would lose track of it entirely and
  // mint a duplicate on the next run.
  props.setProperty('SHEET_ID', ss.getId());

  // keep it beside the backups rather than loose in My Drive
  try {
    DriveApp.getFileById(ss.getId()).moveTo(_ensureFolderPath_('Exports'));
  } catch (e) { /* filing is cosmetic; never fail the export over it */ }
  return ss;
}

/** Uncategorized-inclusive bank rows across every bank account. */
function _allBankRows_() {
  var out = [], page = 1;
  while (true) {
    var r = zohoGet('banktransactions', { per_page: 200, page: page });
    (r.banktransactions || []).forEach(function (t) { out.push(t); });
    if (!r.page_context || !r.page_context.has_more_page) break;
    page++;
    if (page > 60) break;   // same safety bound as Backup.js
  }
  return out;
}

/**
 * Replace a tab's contents with these rows. Written in ONE setValues call —
 * a per-row write would take minutes and hit the 6-minute execution cap.
 */
function _writeTab_(ss, tabName, cols, rows) {
  var sheet = ss.getSheetByName(tabName) || ss.insertSheet(tabName);
  sheet.clear();

  var header = cols.map(function (c) { return c[0]; });
  var grid = [header];
  rows.forEach(function (row) {
    grid.push(cols.map(function (c) {
      var v = row[c[1]];
      if (v === null || v === undefined) return '';
      // arrays (e.g. invoice_numbers) flatten to a readable list
      return Object.prototype.toString.call(v) === '[object Array]' ? v.join(', ') : v;
    }));
  });

  sheet.getRange(1, 1, grid.length, header.length).setValues(grid);
  sheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  if (grid.length > 1) sheet.autoResizeColumns(1, header.length);
}

/** A first tab saying when this was built and what is in it. */
function _writeStampTab_(ss, summary, total, calls, skipped) {
  var sheet = ss.getSheetByName('About') || ss.insertSheet('About', 0);
  sheet.clear();
  var grid = [
    ['PackMasters Accounts — Zoho export'],
    ['Generated', Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm') + ' IST'],
    ['Source', 'Zoho Books org ' + zohoOrgId_() + ' (live read)'],
    ['API calls', calls == null ? '' : calls],
    ['Unchanged (skipped)', (skipped && skipped.length) ? skipped.join(', ') : 'none'],
    ['Note', 'Summary columns only. The complete record is the dated JSON in Backups/data/.'],
    [''],
    ['Tab', 'Rows']
  ];
  summary.forEach(function (s) {
    grid.push([s.name + (s.skipped ? '  (unchanged)' : ''), s.rows]);
  });
  grid.push(['TOTAL', total]);

  sheet.getRange(1, 1, grid.length, 2).setValues(grid.map(function (r) {
    return [r[0] || '', r.length > 1 ? r[1] : ''];
  }));
  sheet.getRange(1, 1).setFontWeight('bold');
  // bold the "Tab | Rows" header wherever it landed — its row moves whenever a
  // metadata line is added above it
  var hdr = 0;
  for (var i = 0; i < grid.length; i++) if (grid[i][0] === 'Tab') { hdr = i + 1; break; }
  if (hdr) sheet.getRange(hdr, 1, 1, 2).setFontWeight('bold');
  sheet.autoResizeColumns(1, 2);
  ss.setActiveSheet(sheet);
}
