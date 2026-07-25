/**
 * OCR via Drive: convert an uploaded image/PDF to a Google Doc with OCR, read the
 * text, delete the temp Doc. Ported from the verified flow in _ocr_test.py
 * (multipart upload as Google Doc, ocrLanguage=en, export text/plain, cleanup).
 *
 * Uses the advanced Drive service (v2) — enable "Drive" in appsscript.json
 * (already declared). No Cloud Vision key needed.
 *
 * @param {string} base64  image/PDF bytes, base64-encoded (client downscales first)
 * @param {string} mime    e.g. 'image/jpeg', 'image/png', 'application/pdf'
 * @return {string} extracted plain text ('' if none)
 */
function ocrExtract(base64, mime) {
  var bytes = Utilities.base64Decode(base64);
  var blob = Utilities.newBlob(bytes, mime, 'capture');

  // Upload with the SOURCE mime type and let ocr:true drive the conversion.
  // Declaring mimeType application/vnd.google-apps.document here is rejected —
  // "OCR is not supported for files of type application/vnd.google-apps.document"
  // — because Drive reads that field as the type of the bytes being uploaded.
  var file = Drive.Files.insert(
    { title: 'ocr-' + Date.now() },
    blob,
    { ocr: true, ocrLanguage: 'en', convert: true }
  );

  try {
    Utilities.sleep(3000); // give Drive OCR a moment to finish

    // Export the Doc as plain text over Drive's own export link. DocumentApp
    // would be the obvious reader, but it needs the /auth/documents scope that
    // this web app does not request — calling it threw on EVERY scan. Drive
    // export uses the /auth/drive scope we already hold.
    var url = 'https://www.googleapis.com/drive/v3/files/' + file.id +
              '/export?mimeType=text/plain';
    var res = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) {
      throw new Error('OCR export failed (' + res.getResponseCode() + ')');
    }
    return res.getContentText() || '';
  } finally {
    try { Drive.Files.remove(file.id); } catch (e) { /* best-effort cleanup */ }
  }
}
