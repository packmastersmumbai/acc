/**
 * Pure text parsers for OCR'd bills. No GAS globals — loadable in a vm/test shim.
 *
 * GSTIN format: 2-digit state code + 10-char PAN + 1 entity digit + 'Z' + 1 check.
 *   e.g. 27AABFY9773F1ZN  →  state 27, PAN AABFY9773F.
 */

/**
 * Pack Masters' OWN GSTIN. A purchase bill names both parties, and on many
 * layouts the RECEIVER (us) is printed before the seller — returning it would
 * post the bill against ourselves, so it is excluded from supplier matching.
 */
var OWN_GSTIN = '27AFGPM0888K1ZY';

var GSTIN_RE = /\b(\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d])\b/g;

/**
 * The counterparty's GSTIN — the first one that is not ours.
 * @return {{gstin:string, pan:string, stateCode:string}|null}
 */
function parseGstin(text) {
  if (!text) return null;
  var t = String(text).toUpperCase();
  var re = new RegExp(GSTIN_RE.source, 'g');
  var first = null, m;
  while ((m = re.exec(t)) !== null) {
    if (!first) first = m[1];
    if (m[1] !== OWN_GSTIN) return _gstinParts_(m[1]);
  }
  // Only our own appeared (e.g. a sales invoice we issued) — return it rather
  // than nothing, so the caller still sees a valid, parseable id.
  return first ? _gstinParts_(first) : null;
}

function _gstinParts_(g) {
  return { gstin: g, stateCode: g.slice(0, 2), pan: g.slice(2, 12) };
}

/**
 * Best-effort bill field extraction from OCR text.
 * @return {{supplier:string, gstin:string|null, invoiceNo:string|null,
 *           amount:number|null, gstPct:number|null}}
 */
function parseBill(text) {
  var t = String(text || '');
  var g = parseGstin(t);

  // Invoice number: "Invoice/Bill No[.:] <token>" on the SAME line (no newline
  // crossing, so "TAX INVOICE\nGSTIN…" can't capture the GSTIN line). The
  // "no/number/#" keyword is required to avoid matching a bare "INVOICE" header.
  var invM = t.match(/(?:invoice|bill|inv)[ \t]*(?:no\.?|number|#)[ \t]*[:\-]?[ \t]*([A-Z0-9][A-Z0-9\/\-]{2,})/i);
  var invoiceNo = invM ? invM[1].trim() : null;

  // Amount: read the figure sitting on a total-ish LABEL. Never "largest number
  // on the page" — HSN codes (39231010), PIN codes and phone numbers all dwarf a
  // real total, and guessing wrong posts a wrong bill to Zoho silently.
  var amount = _labelledAmount_(t);

  var gstPct = _gstPct_(t);

  // Supplier: first non-empty line that isn't an obvious label/number.
  var supplier = _guessSupplier_(t);

  return { supplier: supplier, gstin: g ? g.gstin : null, invoiceNo: invoiceNo, amount: amount, gstPct: gstPct };
}

/** true if the party is out-of-state relative to PM (Maharashtra, code '27') → IGST. */
function interStateFrom(stateCode) { return stateCode !== '27'; }

/**
 * The bill's total GST rate.
 *
 * An INTRA-state bill splits the rate in half across CGST and SGST ("Add : SGST
 * 9%" + "Add : CGST 9%" = 18). Reading a single "9%" off such a bill would
 * halve the tax, so the two halves are summed. Inter-state bills carry one
 * IGST line and are read directly.
 */
function _gstPct_(t) {
  var VALID = { 0: 1, 5: 1, 12: 1, 18: 1, 28: 1 };

  var cgst = _rateAfter_(t, /c\s*gst/i);
  var sgst = _rateAfter_(t, /s\s*gst|ut\s*gst/i);
  if (cgst !== null && sgst !== null && VALID[cgst + sgst]) return cgst + sgst;

  var igst = _rateAfter_(t, /i\s*gst/i);
  if (igst !== null && VALID[igst]) return igst;

  // Fall back to a bare "18%" anywhere, then a rate near the word GST.
  var m = t.match(/\b(0|5|12|18|28)\s*%/) ||
          t.match(/(?:gst|tax)[^0-9%]{0,10}(0|5|12|18|28)\b/i);
  return m ? parseInt(m[1], 10) : null;
}

/** The percentage printed on the same line as a tax label, e.g. "SGST 9%". */
function _rateAfter_(t, labelRe) {
  var lines = String(t).split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    if (!labelRe.test(lines[i])) continue;
    var m = lines[i].match(/(\d{1,2}(?:\.\d+)?)\s*%/);
    if (m) return parseFloat(m[1]);
  }
  return null;
}

// ── helpers ──

/**
 * Total labels in descending authority. The first tier that matches wins, so a
 * "Grand Total" always beats a "Taxable Value" even when the latter is larger
 * (credit-note-adjusted bills do exactly this).
 */
var AMOUNT_LABELS = [
  /(?:grand\s*total|amount\s*payable|net\s*payable|invoice\s*total|bill\s*total)/i,
  /(?:total\s*(?:amount|value)?|balance\s*due)/i,
  /(?:sub\s*-?\s*total|taxable\s*(?:value|amount))/i
];

/** A rupee figure: Indian lakh grouping, western grouping, or plain decimals. */
var AMOUNT_RE = /(?:₹|rs\.?|inr)?\s*(\d{1,3}(?:,\d{2})*,\d{3}(?:\.\d{1,2})?|\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+\.\d{1,2})\b/i;

/**
 * The right-most figure on a line — totals sit in the last column, while the
 * same line often carries a rate or a quantity first.
 */
function _amountOnLine_(line) {
  var re = new RegExp(AMOUNT_RE.source, 'gi');
  var found = null, m;
  while ((m = re.exec(line)) !== null) {
    var n = parseFloat(m[1].replace(/,/g, ''));
    if (!isNaN(n)) found = n;
  }
  return found;
}

/**
 * @return {number|null} the labelled total, or null when nothing is labelled —
 *   null is deliberate: the screen shows "—" and the user types the figure,
 *   which is safer than posting a confident guess.
 */
function _labelledAmount_(t) {
  var lines = String(t || '').split(/\r?\n/);
  for (var tier = 0; tier < AMOUNT_LABELS.length; tier++) {
    var best = null;
    for (var i = 0; i < lines.length; i++) {
      if (!AMOUNT_LABELS[tier].test(lines[i])) continue;

      // Same line first — the common "Grand Total   1,74,378.00" case.
      var n = _amountOnLine_(lines[i]);

      // Table layouts put "TOTAL:" in one cell and its figures in the next row,
      // so the label line itself holds no number. Look ahead a few lines,
      // skipping the blank/tab-only cells OCR emits between them.
      if (n === null) {
        for (var j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          if (!lines[j].replace(/[\s\t]/g, '')) continue;   // empty cell
          n = _amountOnLine_(lines[j]);
          if (n !== null) break;
          break;  // first non-empty line had no figure — this label is a dud
        }
      }
      // A label can repeat (per-page totals); the largest within one tier wins.
      if (n !== null && (best === null || n > best)) best = n;
    }
    if (best !== null) return best;
  }
  return null;
}

/**
 * Header labels that introduce the seller but are NOT the seller's name.
 * "Sold By :" on its own line used to be returned as the supplier, so the real
 * name on the following line was never reached.
 */
var SUPPLIER_LABEL_RE = /^(sold\s*by|seller|supplier|vendor|from|billed\s*by|sold\s*to|ship(ped)?\s*by)\s*[:\-]?\s*$/i;
var NOT_SUPPLIER_RE = /^(tax\s+invoice|invoice|bill|gstin|gst\b|pan\b|date|no\.?|amount|total|irn|billing\s*address|shipping\s*address|place\s*of|state\/ut|order\s*number)\b/i;

function _guessSupplier_(t) {
  var lines = t.split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var ln = lines[i].trim();
    if (!ln) continue;
    if (SUPPLIER_LABEL_RE.test(ln)) continue;   // a label — the name follows it
    if (NOT_SUPPLIER_RE.test(ln)) continue;
    if (/^[\d\W]+$/.test(ln)) continue;         // pure numbers/punctuation
    if (ln.length < 3) continue;

    // The name is usually followed by its address on the same OCR line. Cut at
    // the first address-ish marker so "AEROL FORMULATIONS PRIVATE LIMITED *
    // Rect/Killa Nos…" yields just the company.
    return ln.split(/\s+[*|]|,\s|\s{2,}/)[0].trim();
  }
  return '';
}

// Export for Node/vm test shims without affecting GAS (which ignores module).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseGstin: parseGstin, parseBill: parseBill, interStateFrom: interStateFrom };
}
