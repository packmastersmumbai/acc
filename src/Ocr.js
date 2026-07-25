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

  // Insert as a Google Doc with OCR. Drive v2 advanced service.
  var file = Drive.Files.insert(
    { title: 'ocr-' + Date.now(), mimeType: 'application/vnd.google-apps.document' },
    blob,
    { ocr: true, ocrLanguage: 'en', convert: true }
  );

  try {
    Utilities.sleep(3000); // give Drive OCR a moment to finish
    var doc = DocumentApp.openById(file.id);
    var text = doc.getBody().getText();
    return text || '';
  } finally {
    try { Drive.Files.remove(file.id); } catch (e) { /* best-effort cleanup */ }
  }
}
