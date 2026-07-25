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

/** Our own name, so a purchase bill's "Bill To" block never becomes the supplier. */
function _isOwnName_(s) { return /pack\s*masters/i.test(s || ''); }

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
  var invoiceNo = invM ? invM[1].trim() : _invoiceNoNearLabel_(t);

  // Amount: read the figure sitting on a total-ish LABEL. Never "largest number
  // on the page" — HSN codes (39231010), PIN codes and phone numbers all dwarf a
  // real total, and guessing wrong posts a wrong bill to Zoho silently.
  // Prefer the amount spelled out in words — "Amount Chargeable (in words)" is
  // the one figure on a bill that OCR cannot transpose and that no summary row
  // can outrank. Tally invoices print the grand total in the item table with no
  // label, so figure-based reads pick the taxable value and under-post.
  var amount = _amountFromWords_(t);
  if (amount === null) amount = _labelledAmount_(t);

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
  if (m) return parseInt(m[1], 10);

  // Column-wise OCR detaches every rate from its label, leaving a bare pair of
  // equal halves ("9%" ... "9%") that the label lookups above cannot see. Two
  // identical halves summing to a legal slab is unambiguously CGST+SGST.
  return _halvesSum_(t, VALID);
}

/**
 * Two identical percentages that add up to a legal GST slab — the CGST/SGST
 * halves of an intra-state bill, after OCR stripped their labels.
 * @return {number|null} the summed rate, or null if the halves are ambiguous.
 */
function _halvesSum_(t, valid) {
  var pcts = [], re = /(\d{1,2}(?:\.\d+)?)\s*%/g, m;
  while ((m = re.exec(String(t))) !== null) pcts.push(parseFloat(m[1]));
  if (pcts.length < 2) return null;

  // Every percentage on the page must be the SAME half; a mixed set means we
  // cannot tell which pair belongs to the total, so refuse rather than guess.
  var first = pcts[0];
  for (var i = 1; i < pcts.length; i++) if (pcts[i] !== first) return null;
  return valid[first * 2] ? first * 2 : null;
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

var NUM_WORDS = {
  zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9,
  ten:10, eleven:11, twelve:12, thirteen:13, fourteen:14, fifteen:15, sixteen:16,
  seventeen:17, eighteen:18, nineteen:19, twenty:20, thirty:30, forty:40,
  fifty:50, sixty:60, seventy:70, eighty:80, ninety:90
};
var NUM_SCALES = { hundred:100, thousand:1000, lakh:100000, lakhs:100000,
                   crore:10000000, crores:10000000, million:1000000 };

/**
 * The invoice total as spelled out on the bill, e.g.
 *   "INR Twelve Thousand Two Hundred Seventy Two Only"  -> 12272
 *   "Rs. Seventy Three Thousand Three Hundred Thirty Two Only" -> 73332
 * Words are immune to the column/row scrambling that defeats figure parsing,
 * and Indian invoices are legally required to carry them.
 * @return {number|null}
 */
function _amountFromWords_(t) {
  var lines = String(t || '').split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    // Anchor on a currency word followed by number words and "only".
    var m = lines[i].match(/(?:INR|Rs\.?|Rupees?|Indian\s+Rupees?)\s+([A-Za-z\s\-]+?)\s*only\b/i);
    if (!m) continue;
    // "Tax Amount (in words)" states the TAX, not the invoice total — skip it.
    if (/tax\s+amount/i.test(lines[i])) continue;
    var n = _wordsToNumber_(m[1]);
    if (n > 0) return n;
  }
  return null;
}

/** Parse Indian-English number words (incl. lakh/crore) into a number. */
function _wordsToNumber_(s) {
  var words = String(s).toLowerCase().replace(/-/g, ' ').split(/\s+/);
  var total = 0, chunk = 0, saw = false;
  for (var i = 0; i < words.length; i++) {
    var w = words[i];
    if (w === 'and' || !w) continue;
    if (NUM_WORDS.hasOwnProperty(w)) { chunk += NUM_WORDS[w]; saw = true; continue; }
    if (NUM_SCALES.hasOwnProperty(w)) {
      var scale = NUM_SCALES[w];
      if (scale === 100) { chunk = (chunk || 1) * 100; }
      else { total += (chunk || 1) * scale; chunk = 0; }
      saw = true;
      continue;
    }
    return 0;   // an unknown word means this is prose, not an amount
  }
  return saw ? total + chunk : 0;
}

/** Looks like a document number: has a digit, and a separator or mixed case. */
var INV_TOKEN_RE = /^[A-Z0-9][A-Z0-9\/\-]{3,}$/i;

/**
 * OCR of a two-column header often emits the VALUE line before its LABEL line
 * ("RBQ/2026-27/142" then "INVOICE NO.:"), so a same-line or forward-only match
 * finds nothing. Scan both directions around the label.
 */
function _invoiceNoNearLabel_(t) {
  var lines = String(t || '').split(/\r?\n/);
  var labelRe = /(invoice|bill)\s*(no\.?|number|#)/i;
  for (var i = 0; i < lines.length; i++) {
    if (!labelRe.test(lines[i])) continue;

    // Tally runs the value onto the label's OWN line and then continues with
    // the next field: "Invoice No. 701/26-27 Delivery Note". Take the first
    // document-shaped token after the label before looking at neighbours.
    var tail = lines[i].replace(/^.*?(invoice|bill)\s*(no\.?|number|#)\s*[:\-]?\s*/i, '');
    var tok = tail.split(/\s+/)[0];
    if (tok && INV_TOKEN_RE.test(tok) && /\d/.test(tok) && !/^\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4}$/.test(tok)) {
      return tok.replace(/[.,;:]+$/, '');
    }

    // nearest non-empty neighbours: behind first (the observed OCR order), then ahead
    var probes = [i - 1, i - 2, i + 1, i + 2];
    for (var k = 0; k < probes.length; k++) {
      var j = probes[k];
      if (j < 0 || j >= lines.length) continue;
      // A neighbour line often carries the value THEN the next field
      // ("RBLB/0247/26-27 Delivery Note"), so test its first token.
      var ln = lines[j].trim().split(/\s+/)[0].replace(/[.,;:]+$/, '');
      if (!ln || !INV_TOKEN_RE.test(ln)) continue;
      if (!/\d/.test(ln)) continue;                 // must carry a digit
      if (/^\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4}$/.test(ln)) continue;  // a date
      // A GSTIN/PAN sitting next to the label is an id, never a document
      // number — Tally stacks "GSTIN/UIN" above "Invoice No." in the same block.
      if (new RegExp('^' + GSTIN_RE.source.replace(/\\b/g, '') + '$', 'i').test(ln)) continue;
      if (/^[A-Z]{5}\d{4}[A-Z]$/i.test(ln)) continue;                // bare PAN
      return ln;
    }
  }
  return null;
}

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
  return _trailingFigureBlockMax_(lines);
}

/**
 * Last resort for photographed bills. When OCR reads a totals table column-wise
 * it emits ALL the labels, then ALL the figures — so no label sits near its
 * value and every tier above fails.
 *
 * In that block the grand total is the largest figure: it is the taxable value
 * plus tax, and everything else there (tax halves, discount, round-off) is
 * smaller by construction. Only trust it when the block is unambiguously a
 * totals block — several money-shaped lines clustered at the end.
 */
function _trailingFigureBlockMax_(lines) {
  var figures = [];
  for (var i = Math.max(0, lines.length - 25); i < lines.length; i++) {
    var re = new RegExp(AMOUNT_RE.source, 'gi'), m;
    while ((m = re.exec(lines[i])) !== null) {
      var n = parseFloat(m[1].replace(/,/g, ''));
      if (!isNaN(n) && n > 0) figures.push(n);
    }
  }
  // Fewer than 4 figures is not a totals table — refuse rather than guess.
  if (figures.length < 4) return null;
  return Math.max.apply(null, figures);
}

/**
 * Header labels that introduce the seller but are NOT the seller's name.
 * "Sold By :" on its own line used to be returned as the supplier, so the real
 * name on the following line was never reached.
 */
var SUPPLIER_LABEL_RE = /^(sold\s*by|seller|supplier|vendor|from|billed\s*by|sold\s*to|ship(ped)?\s*by)\s*[:\-]?\s*$/i;
var NOT_SUPPLIER_RE = /^(tax\s+invoice|invoice|bill|gstin|gst\b|pan\b|date|no\.?|amount|total|irn|ack\s*(no|date)|e-?invoice|e-?way|billing\s*address|shipping\s*address|consignee|buyer|place\s*of|state\s*name|state\/ut|order\s*number|description|declaration|company'?s)\b/i;

/**
 * Document banners that are not company names: "(ORIGINAL FOR RECIPIENT)",
 * "e-Invoice", "TAX INVOICE CUM DELIVERY CHALLAN". They survive the other
 * filters because they are pure prose, so they are matched anywhere in a line.
 */
var BANNER_RE = /^\(?\s*(original|duplicate|triplicate)\s+for\b|^e-?invoice$|^\(?(original|office|transporter)\s*copy/i;

/**
 * A company's legal form. A line carrying one of these is the full registered
 * name, so it beats a bare fragment — logos routinely OCR as two lines
 * ("SHUBH" / "PROPACK PVT. LTD.") sitting ABOVE the real name.
 */
var ENTITY_SUFFIX_RE = /\b(private\s+limited|pvt\.?\s*ltd|limited|ltd|llp|enterprises?|industries|corporation|corp|company|co\.|& sons|traders|packaging|udyog)\b/i;

/**
 * Drop everything after the legal-form suffix — that is where the name ends.
 * Uses the LAST suffix in the line: "Rukson Packaging Pvt.Ltd" contains both
 * "Packaging" and "Pvt.Ltd", and cutting at the first would lose the form.
 */
function _trimAfterEntitySuffix_(s) {
  var re = new RegExp(ENTITY_SUFFIX_RE.source, 'gi'), m, end = -1;
  while ((m = re.exec(s)) !== null) end = m.index + m[0].length;
  if (end < 0) return s;
  if (s.charAt(end) === '.') end++;   // keep the dot on "Pvt.Ltd."
  return s.slice(0, end).trim();
}

function _guessSupplier_(t) {
  var lines = t.split(/\r?\n/);

  // First pass: the best full name in the header region — a line with a legal
  // suffix that is not an address line. Bounded to the top of the document so a
  // "For <BUYER> Ltd." footer cannot win.
  var limit = Math.min(lines.length, 20);
  var best = null;
  for (var h = 0; h < limit; h++) {
    var cand = lines[h].trim();
    if (!cand || !ENTITY_SUFFIX_RE.test(cand)) continue;
    if (NOT_SUPPLIER_RE.test(cand) || SUPPLIER_LABEL_RE.test(cand)) continue;
    if (/\d{6}|gstin|phone|pan[:\s]|e-?mail|@/i.test(cand)) continue;  // address/contact line
    if (_isOwnName_(cand)) continue;                                   // the buyer is us
    // OCR runs the name straight into its address ("Rukson Packaging Pvt.Ltd
    // R-273, TTC..."). Cut just after the legal suffix — that is where the
    // registered name ends.
    cand = _trimAfterEntitySuffix_(cand.split(/\s{2,}|,\s/)[0].trim());
    // A split logo yields a FRAGMENT ("PROPACK PVT. LTD.") above the full
    // registered name. Both carry a suffix, so prefer the longer one.
    if (!best || cand.length > best.length) best = cand;
  }
  if (best) return best;

  for (var i = 0; i < lines.length; i++) {
    var ln = lines[i].trim();
    if (!ln) continue;
    if (SUPPLIER_LABEL_RE.test(ln)) continue;   // a label — the name follows it
    if (NOT_SUPPLIER_RE.test(ln)) continue;
    if (BANNER_RE.test(ln)) continue;           // document banner, not a company
    if (_isOwnName_(ln)) continue;              // the buyer is us
    if (/^[\d\W]+$/.test(ln)) continue;         // pure numbers/punctuation
    if (ln.length < 3) continue;
    // Scanner edge artifacts: a run of underscores/dashes, or a digit-heavy
    // garble off a torn header (e.g. "LLL231 131/UD"). A real company name is
    // overwhelmingly letters, so require most of the line to be alphabetic.
    if (/^[_\-=~.]{3,}$/.test(ln)) continue;
    var compact = ln.replace(/\s/g, '');
    if (compact.replace(/[^a-z]/gi, '').length / compact.length < 0.7) continue;

    // The name is usually followed by its address on the same OCR line. Cut at
    // the first address-ish marker so "AEROL FORMULATIONS PRIVATE LIMITED *
    // Rect/Killa Nos…" yields just the company.
    return _trimAfterEntitySuffix_(ln.split(/\s+[*|]|,\s|\s{2,}/)[0].trim());
  }
  return '';
}

// Export for Node/vm test shims without affecting GAS (which ignores module).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseGstin: parseGstin, parseBill: parseBill, interStateFrom: interStateFrom };
}
