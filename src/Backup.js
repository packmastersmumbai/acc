/**
 * Backup: paginate every Zoho module → one dated JSON in Drive. Read-only from
 * Zoho, writes only to the user's own Drive (allowed). Ported from _backup_probe.py
 * (verified: ~5,856 records / ~23 MB across these modules). Depends on
 * zohoGet + fileDocument (Documents.js).
 */

var BACKUP_MODULES = [
  ['contacts', 'contacts'],
  ['invoices', 'invoices'],
  ['bills', 'bills'],
  ['customerpayments', 'customerpayments'],
  ['vendorpayments', 'vendorpayments'],
  ['creditnotes', 'creditnotes'],
  ['items', 'items'],
  ['purchaseorders', 'purchaseorders'],
  ['banktransactions', 'banktransactions']
];

function _allRows_(path, key) {
  var out = [], page = 1;
  while (true) {
    var r = zohoGet(path, { per_page: 200, page: page });
    (r[key] || []).forEach(function (row) { out.push(row); });
    if (!r.page_context || !r.page_context.has_more_page) break;
    page++;
    if (page > 60) break; // safety
  }
  return out;
}

/**
 * Run a full backup now. @return {{records:number, driveFileId:string}}
 */
function backupNow() {
  var backup = {}, total = 0;
  BACKUP_MODULES.forEach(function (m) {
    var rows = _allRows_(m[0], m[1]);
    backup[m[1]] = rows;
    total += rows.length;
  });
  var json = JSON.stringify(backup);
  var date = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
  var b64 = Utilities.base64Encode(Utilities.newBlob(json).getBytes());
  var filed = fileDocument(b64, date + '.json', 'application/json', 'Backups/data');

  // Stamp the run so the settings screen can report it — the nightly trigger
  // runs unattended, and without this there is no way to tell it ever fired.
  PropertiesService.getScriptProperties().setProperties({
    LAST_BACKUP_AT: Utilities.formatDate(new Date(), 'Asia/Kolkata', "yyyy-MM-dd HH:mm"),
    LAST_BACKUP_RECORDS: String(total)
  });

  return { records: total, driveFileId: filed.fileId };
}

/**
 * How often the unattended backup runs, in days. Three suits this org: the
 * books take ~11 new bills a month, so a nightly 22MB snapshot is mostly a
 * copy of yesterday. Changing this reschedules on the next install call.
 */
var BACKUP_EVERY_DAYS = 3;

/**
 * Install the recurring backup trigger at 02:00 IST. Idempotent — removes any
 * prior trigger first, so calling it twice does not double-schedule.
 * @param {number=} everyDays override the default interval
 */
function installNightlyBackup(everyDays) {
  removeNightlyBackup();
  var n = _backupInterval_(everyDays);
  ScriptApp.newTrigger('backupNow').timeBased()
    .everyDays(n)
    .atHour(2)
    .inTimezone('Asia/Kolkata')   // otherwise it fires in the script's tz
    .create();
  PropertiesService.getScriptProperties().setProperty('BACKUP_EVERY_DAYS', String(n));
  return getBackupStatus();
}

/** Clamp to what Apps Script accepts; fall back to the default. */
function _backupInterval_(n) {
  n = parseInt(n, 10);
  if (isNaN(n) || n < 1) {
    var stored = parseInt(
      PropertiesService.getScriptProperties().getProperty('BACKUP_EVERY_DAYS'), 10);
    n = isNaN(stored) ? BACKUP_EVERY_DAYS : stored;
  }
  return Math.min(Math.max(n, 1), 30);
}

/** Remove the nightly trigger. */
function removeNightlyBackup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'backupNow') ScriptApp.deleteTrigger(t);
  });
  return getBackupStatus();
}

/**
 * Whether the nightly backup is armed, and when it last produced a file — so the
 * settings screen can state the truth instead of assuming the trigger exists.
 * @return {{nightly:boolean, lastBackup:string|null, lastRecords:number|null}}
 */
function getBackupStatus() {
  var nightly = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'backupNow';
  });

  var props = PropertiesService.getScriptProperties();
  var last = props.getProperty('LAST_BACKUP_AT');
  var recs = props.getProperty('LAST_BACKUP_RECORDS');
  return {
    nightly: nightly,
    everyDays: _backupInterval_(),
    lastBackup: last || null,
    lastRecords: recs ? parseInt(recs, 10) : null
  };
}
