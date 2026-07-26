/**
 * Document backup — the "+ documents" half of the goal line
 * ("backs up data + documents to Drive"). backupNow() writes the JSON record;
 * this pulls the FILES attached to Zoho records, which the JSON only names.
 *
 * VERIFIED against the live org before building:
 *   - The LIST response carries `has_attachment`, so the records worth
 *     downloading are found for free during the normal paging pass. No
 *     per-record detail fetch is needed — that would have been ~4,000 calls.
 *   - GET /{module}/{id}/attachment returns the raw bytes with a
 *     Content-Disposition filename (verified: a 23KB application/pdf).
 *   - This org currently has 5 attachments in total (5 invoices, 0 bills), so
 *     a full run is ~25 calls, not thousands.
 *
 * Files land beside the data backup:
 *   PackMasters Accounts / Backups / documents / <module>/<number>_<name>
 *
 * Already-saved files are skipped, so re-running is cheap and idempotent.
 * Depends on zohoGet, _ensureFolderPath_ (Documents.js), zohoApiBase_/zohoOrgId_.
 */

/** Modules whose attachments are worth keeping. */
var DOC_BACKUP_MODULES = [
  ['invoices', 'invoices', 'invoice_id', 'invoice_number'],
  ['bills', 'bills', 'bill_id', 'bill_number'],
  ['expenses', 'expenses', 'expense_id', 'expense_number']
];

/**
 * Copy every Zoho attachment not already in Drive.
 * @return {{checked:number, withAttachment:number, saved:number,
 *           skipped:number, failed:number, apiCalls:number, files:Array}}
 */
function backupDocuments() {
  var out = { checked: 0, withAttachment: 0, saved: 0, skipped: 0,
              failed: 0, apiCalls: 0, files: [] };

  DOC_BACKUP_MODULES.forEach(function (m) {
    var path = m[0], key = m[1], idField = m[2], numField = m[3];
    var folder = _ensureFolderPath_('Backups/documents/' + path);
    var page = 1;

    while (true) {
      var r = zohoGet(path, { per_page: 200, page: page });
      out.apiCalls++;
      var rows = r[key] || [];
      out.checked += rows.length;

      rows.forEach(function (row) {
        // has_attachment on the LIST row — no detail call needed
        if (!row.has_attachment) return;
        out.withAttachment++;

        // Match on the BASE name: the extension is only known after download,
        // so the existence check must not depend on it.
        var base = _docBaseName_(row[numField] || row[idField]);
        if (_fileExistsIn_(folder, base)) { out.skipped++; return; }

        try {
          var blob = _fetchAttachment_(path, row[idField]);
          out.apiCalls++;
          if (!blob) { out.failed++; return; }
          var file = folder.createFile(
            blob.setName(base + _docExtension_(blob.getContentType())));
          out.saved++;
          out.files.push({ module: path, number: row[numField], fileId: file.getId() });
        } catch (e) {
          // One unreadable attachment must not abandon the whole backup.
          out.failed++;
        }
      });

      if (!r.page_context || !r.page_context.has_more_page) break;
      page++;
      if (page > 60) break;   // same safety bound as Backup.js
    }
  });

  PropertiesService.getScriptProperties().setProperties({
    LAST_DOC_BACKUP_AT: Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm'),
    LAST_DOC_BACKUP_SAVED: String(out.saved),
    LAST_DOC_BACKUP_TOTAL: String(out.withAttachment)
  });
  return out;
}

/** {lastBackup, saved, total} for the settings screen. */
function getDocBackupStatus() {
  var p = PropertiesService.getScriptProperties();
  return {
    lastBackup: p.getProperty('LAST_DOC_BACKUP_AT') || null,
    saved: p.getProperty('LAST_DOC_BACKUP_SAVED')
      ? parseInt(p.getProperty('LAST_DOC_BACKUP_SAVED'), 10) : null,
    total: p.getProperty('LAST_DOC_BACKUP_TOTAL')
      ? parseInt(p.getProperty('LAST_DOC_BACKUP_TOTAL'), 10) : null
  };
}

// ── internals ──

/** Raw attachment bytes, or null when the record has none. */
function _fetchAttachment_(path, id) {
  var url = zohoApiBase_() + '/' + path + '/' + id + '/attachment' +
            '?organization_id=' + encodeURIComponent(zohoOrgId_());
  var res = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Zoho-oauthtoken ' + zohoToken_() },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) return null;
  var blob = res.getBlob();
  return blob.getBytes().length ? blob : null;
}

/** A stable, filesystem-safe base name so re-runs detect what is already saved. */
function _docBaseName_(number) {
  return String(number || 'unknown').replace(/[\\\/:*?"<>|]/g, '-');
}

/**
 * Extension from the served content type.
 *
 * Zoho attachments are NOT all PDFs — a live run found an application/vnd.ms-excel
 * among five invoices. Defaulting everything to '.pdf' saved the right bytes
 * under a lying name, which breaks anyone opening the backup later.
 */
var DOC_EXTENSIONS = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'text/csv': '.csv',
  'text/plain': '.txt',
  'application/zip': '.zip'
};

function _docExtension_(contentType) {
  var ct = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (DOC_EXTENSIONS[ct]) return DOC_EXTENSIONS[ct];
  // Unknown type: keep the bytes, but do not claim a format we did not verify.
  return '.bin';
}

/** Is a file with this base name already in the folder (any extension)? */
function _fileExistsIn_(folder, base) {
  var it = folder.getFiles();
  while (it.hasNext()) {
    if (it.next().getName().replace(/\.[^.]+$/, '') === base) return true;
  }
  return false;
}
