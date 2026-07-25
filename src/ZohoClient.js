/**
 * Zoho Books v3 REST client (server-side, Apps Script V8).
 * Ported from the verified auth+request pattern in zoho.py.
 *
 * Credentials live in Script Properties: ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET,
 * ZOHO_REFRESH_TOKEN, and (optional) ZOHO_DC (default "com"), ZOHO_ORG_ID.
 *
 * All four verbs throw on transport error or a Zoho `code != 0` body, so callers
 * can assume success. GET/list callers paginate via page_context.has_more_page.
 */

var ZOHO_ORG_ID = '661445520'; // Pack Masters — overridable via Script Property.

function zohoProp_(key, dflt) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  return (v === null || v === undefined) ? dflt : v;
}

/**
 * Read-through cache for expensive Zoho reads (same helper DWM uses).
 * Zoho data is write-rare: an invoice, once raised, seldom changes. So cache
 * the reads and drop the key when THIS app writes — rather than re-paging
 * hundreds of records on every screen load.
 *
 * CacheService is script-wide, so one user's fetch warms it for everyone.
 */
function cachedRead(key, ttlSeconds, reader) {
  var cache = CacheService.getScriptCache();
  try {
    var hit = cache.get(key);
    if (hit) return JSON.parse(hit);
  } catch (e) { /* fall through and read fresh */ }
  var fresh = reader();
  // >100KB silently fails to store; the read still returns correctly.
  try { cache.put(key, JSON.stringify(fresh), ttlSeconds || 300); } catch (e) {}
  return fresh;
}

function cacheBust(key) {
  try { CacheService.getScriptCache().remove(key); } catch (e) {}
}

/** Every cache key this app writes; kept here so cacheBustAll stays truthful. */
var CACHE_KEYS = ['home_data', 'uncategorized'];

/** Drop every cached read — call after any write that moves balances. */
function cacheBustAll() {
  try { CacheService.getScriptCache().removeAll(CACHE_KEYS); } catch (e) {}
}

function zohoDc_() { return zohoProp_('ZOHO_DC', 'com'); }
function zohoApiBase_() { return 'https://www.zohoapis.' + zohoDc_() + '/books/v3'; }
function zohoOrgId_() { return zohoProp_('ZOHO_ORG_ID', ZOHO_ORG_ID); }

/** The org id, for the settings screen (client-callable; zohoOrgId_ is private). */
function getOrgId() { return zohoOrgId_(); }

/**
 * OAuth access token via refresh-token flow, cached in CacheService.
 * Zoho tokens live ~3600s; we cache 3000s and let Zoho mint a fresh one after.
 */
function zohoToken_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('ZOHO_ACCESS_TOKEN');
  if (cached) return cached;

  var authUrl = 'https://accounts.zoho.' + zohoDc_() + '/oauth/v2/token';
  var res = UrlFetchApp.fetch(authUrl, {
    method: 'post',
    muteHttpExceptions: true,
    payload: {
      grant_type: 'refresh_token',
      refresh_token: zohoProp_('ZOHO_REFRESH_TOKEN'),
      client_id: zohoProp_('ZOHO_CLIENT_ID'),
      client_secret: zohoProp_('ZOHO_CLIENT_SECRET')
    }
  });
  var body = JSON.parse(res.getContentText());
  if (!body.access_token) {
    throw new Error('Zoho auth failed: ' + res.getContentText());
  }
  cache.put('ZOHO_ACCESS_TOKEN', body.access_token, 3000);
  return body.access_token;
}

/**
 * Core request. method: 'get'|'post'|'put'|'delete'.
 * params → query string (organization_id auto-added). body → JSON payload.
 * Throws on non-2xx or Zoho code != 0.
 */
function zohoReq_(method, path, params, body) {
  var qs = { organization_id: zohoOrgId_() };
  if (params) for (var k in params) if (params[k] !== undefined && params[k] !== null) qs[k] = params[k];

  var pairs = [];
  for (var q in qs) pairs.push(encodeURIComponent(q) + '=' + encodeURIComponent(qs[q]));
  var url = zohoApiBase_() + '/' + path + '?' + pairs.join('&');

  var opts = {
    method: method,
    muteHttpExceptions: true,
    headers: { Authorization: 'Zoho-oauthtoken ' + zohoToken_() }
  };
  if (body !== undefined && body !== null) {
    opts.contentType = 'application/json';
    opts.payload = JSON.stringify(body);
  }

  var res = UrlFetchApp.fetch(url, opts);
  var code = res.getResponseCode();
  var text = res.getContentText();
  var json;
  try { json = JSON.parse(text); } catch (e) { json = null; }

  if (code < 200 || code >= 300) {
    throw new Error('Zoho ' + method.toUpperCase() + ' ' + path + ' HTTP ' + code + ': ' + text);
  }
  if (json && typeof json.code === 'number' && json.code !== 0) {
    throw new Error('Zoho ' + method.toUpperCase() + ' ' + path + ' code ' + json.code + ': ' + (json.message || text));
  }
  return json;
}

function zohoGet(path, params)    { return zohoReq_('get', path, params, null); }
function zohoPost(path, body, params) { return zohoReq_('post', path, params, body); }
function zohoPut(path, body, params)  { return zohoReq_('put', path, params, body); }
function zohoDelete(path, params) { return zohoReq_('delete', path, params, null); }
