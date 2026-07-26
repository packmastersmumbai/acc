/**
 * Change detection for Zoho modules.
 *
 * Re-pulling ~6,900 records nightly when nothing moved is wasted quota and
 * wall-clock. This finds what actually changed since the last run:
 *
 *   1. PROBE  — one call per module (per_page=1, newest-first) returns that
 *               module's newest last_modified_time. Comparing it to the stored
 *               watermark says whether anything changed at all.
 *   2. FETCH  — only for modules whose probe moved, page with
 *               last_modified_time=<watermark> so Zoho returns just the delta.
 *
 * VERIFIED LIMITS (probed against the live org, do not assume otherwise):
 *   - banktransactions has NO last_modified_time field, and its `date_start`
 *     parameter is SILENTLY IGNORED (same 1,037 rows for every value tested).
 *     It therefore cannot be fetched incrementally and is always pulled whole.
 *   - Zoho touches last_modified_time on status changes and applied payments,
 *     not only on edits, so a 30-day window still returns ~47% of invoices.
 *     Short windows are where the saving is.
 *
 * Depends on zohoGet.
 */

/** Modules that support last_modified_time. banktransactions deliberately absent. */
var DELTA_MODULES = [
  ['invoices', 'invoices'],
  ['bills', 'bills'],
  ['contacts', 'contacts'],
  ['customerpayments', 'customerpayments'],
  ['vendorpayments', 'vendorpayments'],
  ['creditnotes', 'creditnotes'],
  ['items', 'items'],
  ['purchaseorders', 'purchaseorders']
];

/** Modules with no incremental handle — always fetched in full. */
var FULL_ONLY_MODULES = [['banktransactions', 'banktransactions']];

/**
 * The newest last_modified_time in a module, in ONE call.
 * @return {string|null} ISO-ish Zoho timestamp, or null if the module is empty
 *   or does not support the sort (caller must then treat it as always-changed).
 */
function probeNewest(path, key) {
  try {
    var r = zohoGet(path, { per_page: 1, sort_column: 'last_modified_time', sort_order: 'D' });
    var rows = r[key] || [];
    return rows.length ? (rows[0].last_modified_time || null) : null;
  } catch (e) {
    return null;   // unsupported sort → caller falls back to a full pull
  }
}

/**
 * Which modules changed since their stored watermark.
 * Costs one call per module (8 today) regardless of how much data exists.
 * @return {{changed:Array, unchanged:Array, probes:Object, calls:number}}
 */
function detectChanges() {
  var marks = _watermarks_();
  var changed = [], unchanged = [], probes = {}, calls = 0;

  DELTA_MODULES.forEach(function (m) {
    var newest = probeNewest(m[0], m[1]);
    calls++;
    probes[m[0]] = newest;

    // No timestamp at all → we cannot reason about it; treat as changed.
    if (!newest) { changed.push(m[0]); return; }
    if (marks[m[0]] && marks[m[0]] >= newest) unchanged.push(m[0]);
    else changed.push(m[0]);
  });

  return { changed: changed, unchanged: unchanged, probes: probes, calls: calls };
}

/**
 * Rows changed since the watermark. Falls back to a full pull when no
 * watermark exists (first run) or the module has no incremental handle.
 * @return {{rows:Array, calls:number, full:boolean}}
 */
function fetchDelta(path, key, since) {
  var out = [], page = 1, calls = 0;
  while (true) {
    var params = { per_page: 200, page: page };
    if (since) params.last_modified_time = since;
    var r = zohoGet(path, params);
    calls++;
    (r[key] || []).forEach(function (row) { out.push(row); });
    if (!r.page_context || !r.page_context.has_more_page) break;
    page++;
    if (page > 60) break;   // same safety bound as Backup.js
  }
  return { rows: out, calls: calls, full: !since };
}

/** Stored per-module watermarks. */
function _watermarks_() {
  var raw = PropertiesService.getScriptProperties().getProperty('DELTA_WATERMARKS');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (e) { return {}; }
}

/** Record each module's newest timestamp AFTER a successful run. */
function saveWatermarks(probes) {
  var marks = _watermarks_();
  Object.keys(probes || {}).forEach(function (k) {
    if (probes[k]) marks[k] = probes[k];
  });
  PropertiesService.getScriptProperties()
    .setProperty('DELTA_WATERMARKS', JSON.stringify(marks));
  return marks;
}

/** Forget every watermark, so the next run pulls everything. */
function resetWatermarks() {
  PropertiesService.getScriptProperties().deleteProperty('DELTA_WATERMARKS');
  return {};
}

/** What a run would cost right now, without fetching anything. */
function getDeltaStatus() {
  var d = detectChanges();
  return {
    changed: d.changed,
    unchanged: d.unchanged,
    probeCalls: d.calls,
    watermarks: _watermarks_(),
    note: 'banktransactions has no last_modified_time and is always pulled in full'
  };
}
