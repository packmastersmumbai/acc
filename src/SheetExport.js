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
  var ss = _openOrCreateSheet_();
  var summary = [], total = 0;

  SHEET_TABS.forEach(function (spec) {
    var rows = _allRows_(spec[0], spec[1]);          // reused from Backup.js
    _writeTab_(ss, spec[2], spec[3], rows);
    summary.push({ name: spec[2], rows: rows.length });
    total += rows.length;
  });

  var bank = _allBankRows_();
  _writeTab_(ss, BANK_TAB[0], BANK_TAB[1], bank);
  summary.push({ name: BANK_TAB[0], rows: bank.length });
  total += bank.length;

  _writeStampTab_(ss, summary, total);

  // Drop the default "Sheet1" a new spreadsheet is born with.
  var blank = ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1) ss.deleteSheet(blank);

  PropertiesService.getScriptProperties().setProperties({
    LAST_SHEET_EXPORT_AT: Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm'),
    LAST_SHEET_EXPORT_ROWS: String(total),
    SHEET_ID: ss.getId()
  });

  return { spreadsheetId: ss.getId(), url: ss.getUrl(), tabs: summary, records: total };
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
function installNightlySheetExport() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'exportToSheet') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('exportToSheet').timeBased().everyDays(1).atHour(3).create();
  return getSheetStatus();
}

function removeNightlySheetExport() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'exportToSheet') ScriptApp.deleteTrigger(t);
  });
  return getSheetStatus();
}

/** Whether the nightly export trigger is armed. */
function isSheetExportScheduled() {
  return ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'exportToSheet';
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
  // keep it beside the backups rather than loose in My Drive
  try {
    DriveApp.getFileById(ss.getId()).moveTo(_ensureFolderPath_('Exports'));
  } catch (e) { /* filing is cosmetic; never fail the export over it */ }
  props.setProperty('SHEET_ID', ss.getId());
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
function _writeStampTab_(ss, summary, total) {
  var sheet = ss.getSheetByName('About') || ss.insertSheet('About', 0);
  sheet.clear();
  var grid = [
    ['PackMasters Accounts — Zoho export'],
    ['Generated', Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm') + ' IST'],
    ['Source', 'Zoho Books org ' + zohoOrgId_() + ' (live read)'],
    ['Note', 'Summary columns only. The complete record is the dated JSON in Backups/data/.'],
    [''],
    ['Tab', 'Rows']
  ];
  summary.forEach(function (s) { grid.push([s.name, s.rows]); });
  grid.push(['TOTAL', total]);

  sheet.getRange(1, 1, grid.length, 2).setValues(grid.map(function (r) {
    return [r[0] || '', r.length > 1 ? r[1] : ''];
  }));
  sheet.getRange(1, 1).setFontWeight('bold');
  sheet.getRange(6, 1, 1, 2).setFontWeight('bold');
  sheet.autoResizeColumns(1, 2);
  ss.setActiveSheet(sheet);
}
