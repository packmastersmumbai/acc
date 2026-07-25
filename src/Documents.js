/**
 * Documents: attach a proof file to a Zoho invoice, and file a copy in Drive.
 *
 * attachToInvoice: multipart POST /invoices/{id}/attachment, field name
 * `attachment` (verified in session audit). zohoReq_ is JSON-only, so this uses
 * its own UrlFetchApp multipart call with the same auth/error contract.
 * WRITE PATH not exercised against a live invoice during dev (user constraint).
 *
 * fileDocument: writes to the USER'S OWN Drive (non-transactional) — allowed.
 */

var DOC_ROOT = 'PackMasters Accounts'; // top-level Drive folder for the app

/**
 * Attach a base64 file to an invoice.
 * @return {{success:boolean, documentId:string}}
 */
function attachToInvoice(invoiceId, base64, name, mime) {
  var url = zohoApiBase_() + '/invoices/' + invoiceId + '/attachment'
    + '?organization_id=' + encodeURIComponent(zohoOrgId_());
  var blob = Utilities.newBlob(Utilities.base64Decode(base64), mime, name);

  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    muteHttpExceptions: true,
    headers: { Authorization: 'Zoho-oauthtoken ' + zohoToken_() },
    payload: { attachment: blob }   // UrlFetchApp builds multipart/form-data
  });

  var code = res.getResponseCode();
  var text = res.getContentText();
  var json; try { json = JSON.parse(text); } catch (e) { json = null; }
  if (code < 200 || code >= 300) throw new Error('attach HTTP ' + code + ': ' + text);
  if (json && typeof json.code === 'number' && json.code !== 0) {
    throw new Error('attach code ' + json.code + ': ' + (json.message || text));
  }
  return { success: true, documentId: (json && json.documents && json.documents[0] &&
           json.documents[0].document_id) || '' };
}

/**
 * File a document into DOC_ROOT/<folderPath> in Drive, creating folders as needed.
 * @param {string} folderPath e.g. 'Bills/2026-07' or 'Payments'
 * @return {{fileId:string, url:string}}
 */
function fileDocument(base64, name, mime, folderPath) {
  var folder = _ensureFolderPath_(DOC_ROOT + '/' + (folderPath || 'Misc'));
  var blob = Utilities.newBlob(Utilities.base64Decode(base64), mime, name);
  var file = folder.createFile(blob);
  return { fileId: file.getId(), url: file.getUrl() };
}

/**
 * Archive a scanned bill under Bills/<YYYY-MM>/ so the original survives OCR
 * (ocrExtract deletes its temp Doc, keeping nothing). Best-effort: archiving is
 * bookkeeping, so a Drive failure must not fail the scan the user is doing.
 * @return {{fileId:string, url:string}|null} null if archiving failed
 */
function archiveScan(base64, mime, supplier) {
  var stamp = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM');
  var when = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMdd-HHmmss');
  var ext = (mime === 'application/pdf') ? '.pdf' : '.jpg';
  var safe = String(supplier || 'scan').replace(/[^A-Za-z0-9 _-]/g, '').trim() || 'scan';

  try {
    return fileDocument(base64, when + ' ' + safe + ext, mime, 'Bills/' + stamp);
  } catch (e) {
    console.error('archiveScan failed: ' + e);
    return null;
  }
}

/** Get-or-create a nested folder path under My Drive; returns the leaf folder. */
function _ensureFolderPath_(pathStr) {
  var parts = pathStr.split('/').filter(function (p) { return p; });
  var parent = DriveApp.getRootFolder();
  for (var i = 0; i < parts.length; i++) {
    var it = parent.getFoldersByName(parts[i]);
    parent = it.hasNext() ? it.next() : parent.createFolder(parts[i]);
  }
  return parent;
}
