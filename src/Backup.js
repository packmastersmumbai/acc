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

/** Install a nightly (02:00 IST) backup trigger. Idempotent — removes any prior. */
function installNightlyBackup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'backupNow') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('backupNow').timeBased().everyDays(1).atHour(2).create();
  return getBackupStatus();
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
    lastBackup: last || null,
    lastRecords: recs ? parseInt(recs, 10) : null
  };
}
