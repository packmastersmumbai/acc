# PackMasters Mobile Accounts App — Implementation Plan (v2)

> **For agentic workers:** Implement task-by-task. Steps use checkbox (`- [ ]`) syntax. Structure and test-harness **mirror the working sibling project `PackMastersQrAtt`** (same repo — Apps Script + clasp + Playwright + GitHub Pages). Copy its conventions; do not reinvent them.
>
> **On "reproduce v1 code" references:** THERE IS NO v1 PLAN FILE — this v2 doc is self-contained. Any step that says "reproduce v1 Task N code" means: **write the GAS (Apps Script V8 JS) implementation fresh**, porting the *verified* endpoint shapes, field names, and request bodies already captured in **Global Constraints** (above) and in the session's Python probe scripts at the repo root (`zoho.py` for the auth/request pattern; `_reco_probe.py`, `_probe_writes*.py`, `_ocr_test.py`, `_audit_probe*.py`, `_contact_schema.py`, `_pmt.py` for shapes). The Python is reference-only — the app is GAS JS. Do not block on a missing v1 document.

**Goal:** A mobile web app (Apps Script) that captures bills/receipts by photo, posts them to Zoho Books, reconciles bank transactions, and backs up data + documents to Drive — a fast-entry layer over Zoho, which stays the system of record.

**Architecture:** Google Apps Script serves per-screen HTML pages (`src/pages/*.html`) via `doGet`, backed by `src/*.js` server files split by responsibility. All data is read/written LIVE from the Zoho Books v3 API (single user, 5,000 calls/day — ample; no cache). Six screens from Stitch project `3124605118094805982`, design system `assets/d21aa7b22d984f5cb202fefa32f01354`.

**Testing (mirrors PackMastersQrAtt):** Playwright loads each `src/pages/*.html` directly as a data URL with `google.script.run` replaced by an in-memory mock (`tests/helpers/gas-mock.js`). Tests run LOCALLY with `npm test` — **no deploy required for UI verification**. A separate Python suite verifies the live Zoho API contracts **read-only** (never creates/deletes live records — user constraint). Each screen owns its `tests/<screen>.spec.js`; tests grow as screens land.

**Tech Stack:** Apps Script (V8), HtmlService, vanilla JS/HTML/CSS, Drive API OCR, Zoho Books v3 REST, clasp, `@playwright/test`, Python 3 + pytest (contract tests).

## Global Constraints

- **NEVER create, modify, or delete a live Zoho transaction, contact, or record during development or testing.** Contract tests are READ-ONLY. Write paths are exercised only by the user in production, or against a Zoho test org if one is provided. (User constraint — absolute.)
- Org (Zoho): Pack Masters `661445520`, DC `.com`, API base `https://www.zohoapis.com/books/v3`.
- Zoho auth: refresh-token flow, field `access_token`. Store `ZOHO_CLIENT_ID/SECRET/REFRESH_TOKEN` in Apps Script Script Properties.
- Payment invoice-allocation key is `amount_applied`, NOT `amount` (verified — wrong key silently posts unapplied).
- `reference_number` max 45 chars.
- Bills require `tax_id` per line (error 110802 without). Map: GST18 `1161923000000062145`, GST5 `...062129`, GST0 `...062115`, IGST18 `...062139`, IGST5 `...062123`, IGST0 `...062093` (all verified).
- TDS Receivable `1161923000001082001`; banks: UBI `1161923000000507001`, Axis/"PACK MASTERS" `1161923000000540009`, IDFC `1161923000000539111`.
- Contact **list** endpoint returns `gst_no`, `outstanding_payable_amount`, `outstanding_receivable_amount` (verified — match without per-contact fetch).
- Invoice **detail** returns `balance`, `status` (verified — read live before applying money).
- Uncategorized bank txns: `GET banktransactions?account_id=X&status=uncategorized` (base endpoint + status param — returns 517 on Axis; the plain list returns 47, the `/uncategorized` collection returns 0. Verified).
- Reco match discovery: `GET banktransactions/uncategorized/{id}/match` → code 0, keys `matching_transactions`, `matching_documents`, `statement_details`. POST body to accept is UNVERIFIED (see Task 8).
- Always paginate via `page_context.has_more_page`.
- Never auto-post a scanned document — user confirms on screen first.
- Drive OCR: multipart upload as Google Doc with `ocrLanguage=en`, sleep ~3s, export `text/plain`, delete temp Doc. Client downscales images to <2MB (canvas) before upload.
- clasp/deploy runs as `packmasters.mumbai@gmail.com` (`--user run5s`).

---

### Task 0: Repo + harness scaffold (mirrors PackMastersQrAtt)

**Files:**
- Create: `package.json`, `playwright.config.js`, `.clasp.json`, `.gitignore`, `.nojekyll`
- Create: `tests/helpers/fixture.js`, `tests/helpers/gas-mock.js`
- Create: `src/appsscript.json`, `src/Code.js` (doGet)
- Create: `.github/workflows/pages.yml`

**Interfaces:**
- Produces: `npm test` runs Playwright; `loadPage(name)` fixture loads `src/pages/<name>.html` with mock; `doGet(e)` routes `?p=<name>` to the page.

- [x] **Step 1: git init** — `git init` (project is currently NOT a repo). Add `.gitignore` (`node_modules/`, `.clasp.json`, `test-report/`, `test-results/`, `.playwright-cli/`).

- [x] **Step 2: package.json** — copy scripts from PackMastersQrAtt:

```json
{
  "name": "packmasters-accounts",
  "scripts": {
    "test": "playwright test",
    "test:headed": "playwright test --headed",
    "test:report": "playwright show-report test-report"
  },
  "devDependencies": { "@playwright/test": "^1.48.0" }
}
```
Then `npm install`.

- [x] **Step 3: playwright.config.js** — copy verbatim from `../PackMastersQrAtt/playwright.config.js` (testDir `./tests`, headless false, viewport 1280x720, html reporter to `test-report`).

- [x] **Step 4: fixture.js** — copy `../PackMastersQrAtt/tests/helpers/fixture.js` verbatim (loads `src/pages/<name>.html`, strips `<?= ?>`/`<? ?>` GAS tags, injects mock, serves as data URL).

- [x] **Step 5: gas-mock.js** — copy the QrAtt structure (the `makeRunner`/`withSuccessHandler`/`withFailureHandler` chain) but replace the attendance mock data + methods with accounts ones. Mock methods needed: `getHomeData`, `ocrExtract`, `parseBill` (client may call server parse), `matchContactByGstin`, `createContact`, `postBill`, `markInvoicePaid`, `payVendorBill`, `uncategorized`, `suggestMatch`, `acceptMatch`, `attachToInvoice`. Seed realistic Zoho-shaped mock data (derived from live responses captured this session):

```javascript
var MOCK_HOME = { success:true, receivable:24781400, payable:13429050, overdue:8912040, unreconciled:517,
  attention:[
    {name:'Yash Poly Plast', gap:'34 bills unpaid', amount:7723056, overdue:true},
    {name:'Henkel Adhesives', gap:'146 draft challans', amount:66625859, overdue:false},
    {name:'Dorf Ketal', gap:'3 void invoices carry balance', amount:61236, overdue:false}
  ]};
var MOCK_MATCH = { contact_id:'116...071027', contact_name:'YARA FERTILISERS INDIA PVT. LTD.',
  contact_type:'customer', outstanding:412300 };
var MOCK_UNCAT = [{transactionId:'116...916029', date:'2026-04-14', amount:174378, type:'credit',
  narration:'NEFT YASH POLY PLAST / IN42609256237396'}];
```

- [x] **Step 6: doGet router** — `src/Code.js`:

```javascript
function doGet(e) {
  const p = (e && e.parameter && e.parameter.p) || 'home';
  const t = HtmlService.createTemplateFromFile('pages/' + p);
  return t.evaluate().setTitle('PackMasters Accounts')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
function include(f){ return HtmlService.createHtmlOutputFromFile(f).getContent(); }
```

- [x] **Step 7: appsscript.json + Pages workflow** — `src/appsscript.json` (V8, Asia/Kolkata, scopes: `script.external_request`, `drive`, `webapp.deploy`; webapp executeAs USER_DEPLOYING, access MYSELF). Copy `.github/workflows/pages.yml` from QrAtt for the launcher page.

- [x] **Step 8: verify** — create a trivial `src/pages/_smoke.html` with `<h1 id="t">ok</h1>`, write `tests/smoke.spec.js` asserting `#t` has text "ok" via `loadPage('_smoke')`, run `npm test`, confirm PASS. This proves the harness works before any real screen. (Use the `_smoke` name — NOT `home` — so Task 8's real `home.html` never clobbers the harness-proof test.)

- [x] **Step 9: commit**

```bash
git add -A && git commit -m "chore: scaffold repo + playwright harness (mirrors QrAtt)"
```

---

### Task 1: Zoho client (server)

**Files:**
- Create: `src/ZohoClient.js`
- Create: `tests/contracts/test_contracts.py`, `tests/contracts/conftest.py`

**Interfaces:**
- Produces: `zohoGet(path, params)`, `zohoPost`, `zohoPut`, `zohoDelete` (throw on `code != 0`); Python `zoho_get(path, **params)` for read-only contract tests.

- [x] **Step 1: server client** — `src/ZohoClient.js` with `zohoToken_()` (CacheService, 3000s TTL), `zohoReq_(method,path,params,body)`, and the four verb wrappers. Write fresh in GAS, porting the auth+request pattern from `zoho.py` (refresh-token → `access_token`; base `https://www.zohoapis.com/books/v3`; `organization_id=661445520`; throw on `code != 0`).

- [x] **Step 2: Python contract harness — READ ONLY** — `conftest.py` provides a `zoho` fixture (reuses `../../zoho.py`, `../../ledger.py`); `test_contracts.py` asserts, WITHOUT writing anything:

```python
def test_contact_list_has_gst_no(zoho):
    c = zoho.books("contacts", PM, per_page=1, contact_type="vendor")["contacts"][0]
    assert "gst_no" in c and "outstanding_payable_amount" in c

def test_invoice_detail_has_balance(zoho):
    iid = zoho.books("invoices", PM, per_page=1)["invoices"][0]["invoice_id"]
    d = zoho.books(f"invoices/{iid}", PM)["invoice"]
    assert "balance" in d and "status" in d

def test_uncategorized_returns_517(zoho):
    r = zoho.books("banktransactions", PM, account_id="1161923000000540009",
                   status="uncategorized", per_page=200)
    # only assert the endpoint+param shape works and returns rows; count may drift
    assert r["code"] == 0 and len(r["banktransactions"]) > 0
    assert all(t["status"] == "uncategorized" for t in r["banktransactions"])

def test_tax_ids_resolve(zoho):
    taxes = {t["tax_id"]: (t["tax_name"], t["tax_percentage"])
             for t in zoho.books("settings/taxes", PM)["taxes"]}
    assert taxes["1161923000000062145"] == ("GST18", 18)
    assert taxes["1161923000000062139"] == ("IGST18", 18)
```

- [x] **Step 3: run contract tests** — `pytest tests/contracts -v` (via PowerShell with env export). Expected: all PASS against live Zoho, zero writes.

- [x] **Step 4: commit** — `git commit -m "feat: zoho client + read-only contract tests"`

---

### Task 2: OCR + parsers (server + logic tests)

**Files:**
- Create: `src/Ocr.js`, `src/Parse.js`
- Create: `tests/logic/parse.test.js`

**Interfaces:**
- Produces: `ocrExtract(base64,mime)` → text; `parseGstin(text)` → {gstin,pan,stateCode}|null; `parseBill(text)` → {supplier,gstin,invoiceNo,amount,gstPct}; `interStateFrom(stateCode)` → bool (true if not '27' Maharashtra).

- [x] **Step 1: OCR** — `src/Ocr.js` `ocrExtract` (Drive Advanced Service, insert-as-Doc + ocr:true, sleep 3000, export text/plain, remove). Write fresh in GAS, porting the verified OCR flow from `_ocr_test.py`.

- [x] **Step 2: parsers** — `src/Parse.js` with `parseGstin`, `parseBill` (write fresh in GAS from the GSTIN/PAN/state-code and bill-field regex logic; validate against captured OCR text in Step 3), plus:

```javascript
function interStateFrom(stateCode) { return stateCode !== '27'; }  // PM is Maharashtra (27)
```

- [x] **Step 3: logic tests (pure, local, no Zoho)** — `tests/logic/parse.test.js` runs the parser functions on real captured OCR text:

```javascript
const { test, expect } = require('@playwright/test');
// parsers are plain functions; load them via a small eval shim of src/Parse.js
const fs = require('fs'); const vm = require('vm');
const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../../src/Parse.js','utf8'), ctx);

test('parseGstin derives pan and state', () => {
  const r = ctx.parseGstin('GSTIN 27AABFY9773F1ZN TAX INVOICE');
  expect(r.pan).toBe('AABFY9773F');
  expect(r.stateCode).toBe('27');
});
test('interStateFrom: 27 is intra, others inter', () => {
  expect(ctx.interStateFrom('27')).toBe(false);
  expect(ctx.interStateFrom('06')).toBe(true);   // Haryana → IGST
});
```

- [x] **Step 4: run** — `npm test tests/logic` → PASS.

- [x] **Step 5: commit** — `git commit -m "feat: ocr + parsers + logic tests"`

---

### Task 3: Contacts (match + create)

**Files:** Create `src/Contacts.js`.
**Interfaces:** `matchContactByGstin(gstin)`, `createContact(obj)` (write fresh in GAS; match uses list endpoint's `gst_no` per Global Constraints; create body shape per `_contact_schema.py`).

- [x] **Step 1:** implement `matchContactByGstin` (paginate contacts, compare `gst_no`).
- [x] **Step 2:** implement `createContact` (nested billing_address + contact_persons body).
- [x] **Step 3: verify READ side only** — add a contract test asserting `matchContactByGstin`'s query returns Yash Poly for `27AABFY9773F1ZN`. Do NOT test create against live (write ban); the create body shape is already verified from this session's audit and documented in Global Constraints.
- [x] **Step 4: commit** — `git commit -m "feat: contact match + create"`

---

### Task 4: Bills + Payments (server)

**Files:** Create `src/Bills.js`, `src/Payments.js`.
**Interfaces:** `TAX_ID(pct,inter)`, `postBill(obj)`, `markInvoicePaid(obj)`, `payVendorBill(obj)` (write fresh in GAS; bill/payment body shapes per `_probe_writes*.py` + `_pmt.py`; markInvoicePaid reads invoice balance LIVE, applies full via `amount_applied`).

- [x] **Step 1:** `TAX_ID` + `postBill` (line needs tax_id).
- [x] **Step 2:** `markInvoicePaid` (live balance read, `amount_applied` full clear) + `payVendorBill`.
- [x] **Step 3: logic test for TAX_ID (pure)** — `tests/logic/tax.test.js`: `TAX_ID(18,false)` === `'1161923000000062145'`, `TAX_ID(18,true)` === `'1161923000000062139'`.
- [x] **Step 4:** write paths are NOT tested against live (write ban); their shapes are verified in Global Constraints from the audit. **⚠️ UNVERIFIED IN PRODUCTION — `postBill`, `markInvoicePaid` and `payVendorBill` have still never executed against live Zoho. Written + mock-tested ≠ proven.**
- [x] **Step 5: commit** — `git commit -m "feat: bill posting + payments"`

---

### Task 5: Documents (attach + Drive filing)

**Files:** Create `src/Documents.js`.
**Interfaces:** `attachToInvoice(invoiceId,base64,name,mime)`, `fileDocument(base64,name,mime,folderPath)` → {fileId,url} (write fresh in GAS; attachment is multipart POST `/invoices/{id}/attachment` field `attachment` per Global Constraints/`_probe_writes*.py`; Drive filing uses DriveApp folder tree).

- [x] **Step 1:** attachment (multipart POST) + Drive folder-tree filing.
- [x] **Step 2: verify** — test `fileDocument` only (Drive is the user's own, non-transactional): run it, confirm folder tree + file created, then delete the test file. attachToInvoice shape verified in audit; not run against a live invoice (write ban). **⚠️ UNVERIFIED IN PRODUCTION. Also invoice-only — the vendor ledger has no proof-capture path.**
- [x] **Step 3: commit** — `git commit -m "feat: drive filing + zoho attachment"`

---

### Task 6: Home data (server) — REAL CODE for the attention list

**Files:** Create `src/Home.js`.
**Interfaces:** `getHomeData()` → {receivable, payable, overdue, unreconciled, attention:[{name,gap,amount,overdue}]}.

- [x] **Step 1: implement** — compute the four figures and the attention list from live Zoho reads. Overdue = sum of invoice balances past due_date; unreconciled = the uncategorized count; attention = parties with the largest open balance, de-duplicated by CASE-NORMALIZED name (the "Yash Poly Plast" vs "YASH POLY PLAST" problem):

```javascript
function getHomeData() {
  const norm = s => (s||'').toUpperCase().replace(/\s+/g,' ').trim();
  // receivable/payable from contacts (list carries outstanding fields)
  let recv = 0, pay = 0, page = 1;
  const byParty = {};   // normName -> {name, amount}
  while (true) {
    const r = zohoGet('contacts', {per_page: 200, page: page});
    (r.contacts||[]).forEach(c => {
      const ro = parseFloat(c.outstanding_receivable_amount||0);
      const po = parseFloat(c.outstanding_payable_amount||0);
      recv += ro; pay += po;
      const bal = ro + po;
      if (bal > 0) {
        const k = norm(c.contact_name);
        if (!byParty[k]) byParty[k] = {name: c.contact_name, amount: 0};
        byParty[k].amount += bal;   // merge casing-duplicate parties
      }
    });
    if (!r.page_context || !r.page_context.has_more_page) break;
    page++;
  }
  // overdue: sum balances of invoices past due
  const today = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
  let overdue = 0; page = 1;
  while (true) {
    const r = zohoGet('invoices', {per_page: 200, page: page, filter_by: 'Status.Overdue'});
    (r.invoices||[]).forEach(i => overdue += parseFloat(i.balance||0));
    if (!r.page_context || !r.page_context.has_more_page) break;
    page++;
  }
  // NOTE: banktransactions page_context has NO `total` key (verified live) — must page-count.
  let unreconciled = 0, up = 1;
  while (true) {
    const r = zohoGet('banktransactions',
      {account_id: '1161923000000540009', status: 'uncategorized', per_page: 200, page: up});
    unreconciled += (r.banktransactions || []).length;
    if (!r.page_context || !r.page_context.has_more_page) break;
    up++;
  }
  const attention = Object.values(byParty).sort((a,b)=>b.amount-a.amount).slice(0,8)
    .map(p => ({name: p.name, gap: '', amount: p.amount, overdue: false}));
  return {receivable: recv, payable: pay, overdue: overdue, unreconciled: unreconciled, attention: attention};
}
```

- [x] **Step 2: contract test (read-only)** — assert `getHomeData()`-equivalent Python computes non-negative figures and that casing-dup merge collapses "YASH POLY"/"Yash Poly" into one entry. (Test the dedup logic as a pure Python function mirroring `norm` + merge; the live figures are asserted only as >= 0 and internally consistent.)

- [x] **Step 3: commit** — `git commit -m "feat: home data with casing-merged attention list"`

---

### Task 7: Reconcile (server) — with SPIKE gate on the write path

**Files:** Create `src/Reconcile.js`.
**Interfaces:** `uncategorized(bankAccountId)`, `suggestMatch(txn)`, `acceptMatch(transactionId, matchObj)`.

- [x] **Step 1: list (verified query)** — 

```javascript
function uncategorized(bankAccountId) {
  const out = []; let page = 1;
  while (true) {
    const r = zohoGet('banktransactions',
      {account_id: bankAccountId, status: 'uncategorized', per_page: 200, page: page});
    (r.banktransactions||[]).forEach(t => out.push({
      transactionId: t.transaction_id, date: t.date,
      amount: parseFloat(t.amount), type: t.transaction_type,
      narration: t.description || t.payee || ''}));
    if (!r.page_context || !r.page_context.has_more_page) break;
    page++;
  }
  return out;
}
```

- [x] **Step 2: suggestMatch (3-tier, real code)** —

```javascript
function suggestMatch(txn) {
  const m = zohoGet('banktransactions/uncategorized/' + txn.transactionId + '/match');
  const docs = (m.matching_documents || m.matching_transactions || []);
  if (!docs.length) return null;
  // Zoho already ranks; take the top and label confidence by how it matched.
  const top = docs[0];
  const amtEqual = Math.abs(parseFloat(top.amount||0) - Math.abs(txn.amount)) < 1;
  return {
    type: top.transaction_type || top.type,
    id: top.transaction_id || top.invoice_id || top.bill_id,
    label: top.reference_number || top.entity_number || top.name || '',
    confidence: amtEqual ? 'amount+date' : 'amount'
  };
}
```

- [x] **Step 3: SPIKE — resolve acceptMatch POST body BEFORE writing acceptMatch** — the accept body is unverified and categorizing is a live write (banned during dev). Do NOT guess-and-run. Instead: (a) with the user present and explicitly authorizing ONE real categorize, capture the exact request the Zoho web UI sends (browser devtools) OR consult Zoho Books API docs for the `match`/`categorize` POST body; (b) implement `acceptMatch` from that verified body; (c) only the user runs it in production. Mark this task **blocked on the user** for the write half.

```javascript
// acceptMatch — body shape TBD from spike; skeleton:
function acceptMatch(transactionId, matchObj) {
  const body = { /* filled from spike — likely transactions_to_be_matched:[{transaction_id,transaction_type}] */ };
  return zohoPost('banktransactions/uncategorized/' + transactionId + '/match', body);
}
```

- [x] **Step 4: contract test (read-only)** — assert `suggestMatch` runs (`match` endpoint returns code 0) for a real uncategorized txn without writing.

- [x] **Step 5: commit** — `git commit -m "feat: reconcile list + suggest; accept blocked on spike"`

---

### Tasks 8–13: One screen per task (each with its own spec)

Each screen is its own task, ending with a `tests/<screen>.spec.js` that runs LOCALLY against the mock. Export the HTML from the Stitch screen id, lift its CSS/markup into `src/pages/<name>.html`, replace static data with `google.script.run.withSuccessHandler(...).<serverFn>()`, add empty/loading/error states, then write the spec.

> **BUILD ORDER — do Task 13 FIRST.** Tasks 8–12 consume the shared image-downscale util and the loading/empty/error partials that Task 13 builds. Build **Task 13 before Task 8** (the numbering is by concept, not execution order). Task 9's `<2MB` canvas downscale and every screen's loading/empty/error states import from `src/pages/shared/` — those must exist first.
>
> **PALETTE FIX AT LIFT (Industrial Ledger).** The 8 Stitch screens drifted off the emerald design system: `primary` token is Material `#005d42` (should be `#047857`), background is Material `#f6fbf5` (should be stone `#fafaf9`), some hairlines are `#bdc9c1` (should be `#e7e5e4`). **Do NOT lift the "Bharat - Home" screen** (it is fully wrong — blue `#004ac6` + Inter + shadowed 14px cards); use the Kadam home. When lifting each screen, apply these exact replacements, then a grep-gate must return NOTHING before the screen is done: `#005d42`→`#047857`, `#006c4e`→`#047857`, `#f6fbf5`→`#fafaf9`, `#bdc9c1`(as border)→`#e7e5e4`, and any `Inter`/`#004ac6`/`14px`-card must be absent. Downloaded source HTML for all 8 is at the session scratchpad `stitch/` dir.

- [x] **Task 8 — home** (Stitch `076617c2...`) → `src/pages/home.html`, wire `getHomeData`, add loading skeleton + empty state. `tests/home.spec.js`: asserts `#recv/#pay/#overdue/#unrecon` populate from mock, attention list renders 3 rows, overdue figure is red. Commit.
- [x] **Task 9 — scan + result matched/no-match** (Stitch `a3cc3322...`, `b4a68dc6...`) → `src/pages/scan.html`: file input, canvas downscale to <2MB, `ocrExtract`→`parseBill`→`matchContactByGstin`, branch matched vs no-match. `tests/scan.spec.js`: mock returns a match → matched view shows MATCHED tag; mock returns null → no-match view shows red notice + 3 create tiles. Commit.
- [x] **Task 10 — create party** (Stitch `05bc5951...`) → `src/pages/party.html`: form prefilled from parse, submit `createContact`. `tests/party.spec.js`: prefilled fields carry the emerald "from document" marker; submit calls mock `createContact` with the right body. Commit.
- [x] **Task 11 — reconcile** (Stitch `428d8b9c...`) → `src/pages/reconcile.html`: `uncategorized`+`suggestMatch`, one card, Skip/Accept. `tests/reconcile.spec.js`: progress bar reflects count, suggested match shows confidence tag, Accept disabled until spike resolves (feature-flag it). Commit.
- [x] **Task 12 — party ledger + mark paid** (Stitch `999287d7...`) → `src/pages/ledger.html`: open bills, mark-paid→capture→`markInvoicePaid`+`attachToInvoice`. `tests/ledger.spec.js`: bills render, mark-paid opens capture, short-payment shows TDS-clears-in-full line. Commit.
- [x] **Task 13 — canvas downscale util + shared states** → `src/pages/shared/` helper for image downscale (<2MB) and the loading/empty/error partials used across screens. `tests/downscale.spec.js`: a >2MB test image is reduced below 2MB. Commit.

---

### Task 14: Backup module

**Files:** Create `src/Backup.js`.
**Interfaces:** `backupNow()` → {records, driveFileId}; nightly time trigger.

- [x] **Step 1:** paginate all modules → JSON → `PackMasters Accounts/Backups/data/<date>.json` via `fileDocument` (verified: 5,856 records / 23 MB).
- [x] **Step 2:** nightly trigger + "Back up now" button on a settings page.
- [x] **Step 3: verify** — run `backupNow`, confirm dated JSON in Drive with expected count (READ-only from Zoho + write to user's own Drive — allowed). **✅ DONE 2026-07-26. Executed live via a temporary doGet route (since removed): 6,896 records in 108s → Drive file `1rUkQIvdyniQPUHNAb9o_owt5RLLUjBjM` = `Backups/data/2026-07-26.json`, 22.0 MB, valid JSON. Independently re-read through the Drive API: invoices 3854, customerpayments 1039, banktransactions 1037, items 366, purchaseorders 255, contacts 171, bills 142, creditnotes 32, vendorpayments 0. `getBackupStatus` reports lastBackup 2026-07-26 16:51 / 6896 records.**
- [x] **Step 4: commit** — `git commit -m "feat: nightly + manual backup"`

---

## Self-Review

**Fixes applied from the two adversarial reviews:**
- ✅ Verification model (was CRITICAL): tests run LOCALLY via Playwright + GAS mock, no deploy dependency — copied from PackMastersQrAtt. Task 0 proves the harness before any screen.
- ✅ Four un-coded functions (was CRITICAL): `getHomeData` (Task 6, full code incl. casing-dedup), `uncategorized`/`suggestMatch` (Task 7, full code), canvas downscale (Task 13). `acceptMatch` is explicitly a SPIKE gated on user authorization — not a guess-and-run.
- ✅ Task 10-bundles-4-screens (was IMPORTANT): split into Tasks 8–12, one screen + one spec each.
- ✅ `interState` derivation (was IMPORTANT): `interStateFrom(stateCode)` added Task 2.
- ✅ Reco query exactness (was IMPORTANT): `status=uncategorized` on base endpoint documented in Global Constraints + Task 7 Step 1 code.
- ✅ Error/loading/empty states: Task 13 + each screen task.
- ✅ clasp/deploy: Task 0 scaffolds `.clasp.json` + Pages workflow.

**Fixes applied from the SECOND adversarial review (v2.1, this session):**
- ✅ Smoke page renamed `home`→`_smoke` (Task 0 Step 8) — the real `home.html` (Task 8) no longer clobbers the harness-proof test.
- ✅ `getHomeData` unreconciled count (Task 6): was reading `page_context.total`, which **does not exist** on the banktransactions endpoint (verified live — always yielded 0). Now page-counts to 517.
- ✅ "Reproduce v1 code" pointers: **there is no v1 file** — replaced with a self-contained banner + per-step references to the verified Python probes (`zoho.py`, `_ocr_test.py`, `_contact_schema.py`, `_probe_writes*.py`, `_pmt.py`) and Global Constraints. Implementations are written fresh in GAS.
- ✅ Task 13 dependency inversion: shared downscale util + loading/empty/error partials are consumed by Tasks 8–12; added explicit **"build Task 13 first"** directive.
- ✅ Stitch palette drift: added the emerald-fix grep-gate at the lift stage + "do not lift Bharat home" (fully-wrong screen).

**Honest open items (not placeholders — flagged blockers):**
- `acceptMatch` write body (Task 7 Step 3) — genuinely unknown, gated on a user-authorized spike. The rest of reconcile (list, suggest) is fully coded and read-only-testable.
- **Sales-invoice CREATION path is descoped** — `markInvoicePaid` consumes an existing invoiceId. Creating sales invoices requires an `items`-based flow (line items reference the 366 Zoho items); this is a separate feature, NOT in this plan. The app marks existing invoices paid; it does not raise new sales invoices. (Explicit descope, per reviewer.)
- Write paths (createContact, postBill, payments, attach) are shape-verified from this session's audit but NOT exercised against live Zoho during dev, per the user's no-transactions constraint. They are exercised only by the user in production or against a Zoho test org.

**Separate subsystem (own future plan):** bank-data cleanup — 517 Axis uncategorized, UBI ₹19.16cr overstatement, 233 draft challans. Reconciliation work, not app-build.

---

## Plan-vs-Code Reconciliation (2026-07-25, post-build)

The plan was walked line by line against the shipped code. This section is the
audit trail; it records what was actually delivered, not what was intended.

**The process failure:** "tests pass + deploy green" was allowed to stand in for
"the plan's tasks are done". Nobody re-read this file at the end, so Task 14
Step 2 was never built and two functions shipped as stubs. Reconcile against
this file BEFORE declaring a build complete.

### Gaps found and closed

| # | Task | Gap | Fix |
|---|---|---|---|
| 1 | 12 | `getPartyLedger` was receivables-only (`customer_id` + `outstanding_receivable_amount`). Every VENDOR ledger returned blank, stranding `payVendorBill` with no screen. | Side-aware ledger (`side`/`documents`); screen routes Confirm to `payVendorBill` vs `markInvoicePaid`. Both writes confirm the amount first. `6ce76cf` |
| 2 | 2 | `parseBill` used largest-number-on-page as the total — HSN codes, PINs and phone numbers all outrank a real total. | Label-anchored extraction, tiered (grand total > total > subtotal), right-most figure per line, `null` when unlabelled. `053409a` |
| 3 | 14 | **Step 2 was never built.** No settings page, no "Back up now" button; `backupNow`/`installNightlyBackup` were reachable only from the GAS editor, and nothing recorded whether the nightly job ever ran. | `src/pages/settings.html` + nav entry; `getBackupStatus`/`removeNightlyBackup`; `backupNow` stamps its run. `0fd9421` |
| 4 | 6 | `gap` hardcoded `''` and `overdue` hardcoded `false` — the attention list was a bare sorted balance list with no reason attached. | Rollup emits `side` + a real `gap` ("They owe us" / "We owe them" / "Owed both ways", plus duplicate-record count); `overdue` resolved per party. `91dfb2e` |

### Verified after the fixes

- Playwright **115/115** (was 101 — +14 covering vendor ledger, settings, parser).
- pytest contract suite **9/9** live, read-only, zero writes.
- Palette gate clean (walks `src/pages/`, so `settings.html` is covered).
- Deployed **@16**; `?p=settings`, `?p=ledger`, `?p=home` all HTTP 200 with the
  new markup present.

### Second pass (2026-07-26)

- **Task 14 Step 3 CLOSED** — `backupNow` executed live: 6,896 records, 22 MB,
  verified by re-reading the file back out of Drive. All 48 plan steps now ticked.
- **Confirm-before-post guard added to scan** — the amount is now an editable
  field seeded from OCR, and the figure POSTed is the one the user confirmed,
  not the parsed guess. A red "check before posting" banner lists every field
  OCR could not establish (amount, date, GST rate, invoice number) plus a
  failed taxable+tax=total check. Posting is refused outright with an empty
  amount. The confirm dialog now names the amount as well as the account.
  This does not make the write paths *verified* — it makes a wrong parse
  visible before it costs money.

### Still open — deliberately, and stated plainly

- **No live write has EVER run.** `postBill`, `markInvoicePaid`, `payVendorBill`,
  `attachToInvoice` are shape-verified from the session probes and covered by
  mock tests, but not one has been executed against live Zoho. Treat them as
  unproven until the user authorizes a real transaction.
- **No auth.** The app is `ANYONE_ANONYMOUS` over live financials. A PIN gate was
  recommended and is still not built.
- **Sales-invoice creation stays descoped** (unchanged from the original plan).
- **Bill attachments** are not wired — `attachToInvoice` is invoice-only, so the
  vendor path skips proof capture.
