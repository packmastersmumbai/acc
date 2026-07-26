const { test, expect } = require('@playwright/test');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

// Load Delta.js with stubbed GAS globals so the change-detection logic can be
// exercised without a deploy.
function load(opts) {
  opts = opts || {};
  const store = Object.assign({}, opts.props);
  const calls = [];
  const ctx = {
    module: { exports: {} },
    zohoGet(pathName, params) {
      calls.push({ path: pathName, params: params });
      const fn = opts.zohoGet;
      if (!fn) throw new Error('no zohoGet stub');
      return fn(pathName, params);
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in store ? store[k] : null),
        setProperty: (k, v) => { store[k] = v; },
        deleteProperty: (k) => { delete store[k]; },
      }),
    },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/Delta.js'), 'utf8'), ctx);
  ctx.__calls = calls;
  ctx.__store = store;
  return ctx;
}

const NEWEST = {
  invoices: '2026-07-25T13:34:12+0530',
  bills: '2026-07-25T09:38:13+0530',
  contacts: '2026-07-23T08:47:40+0530',
  customerpayments: '2026-07-23T23:20:56+0530',
  vendorpayments: null,
  creditnotes: '2026-07-23T08:46:58+0530',
  items: '2026-01-01T10:00:00+0530',
  purchaseorders: '2026-02-01T10:00:00+0530',
};

function probeStub(pathName) {
  const t = NEWEST[pathName];
  return { [pathName]: t ? [{ last_modified_time: t }] : [] };
}

test('probe costs exactly one call per module', () => {
  const ctx = load({ zohoGet: probeStub });
  const d = ctx.detectChanges();
  expect(d.calls).toBe(8);
  expect(ctx.__calls.every((c) => c.params.per_page === 1)).toBe(true);
  // newest-first, so the single row IS the newest
  expect(ctx.__calls.every((c) => c.params.sort_order === 'D')).toBe(true);
});

test('with no watermark every module counts as changed (first run)', () => {
  const ctx = load({ zohoGet: probeStub });
  const d = ctx.detectChanges();
  expect(d.unchanged).toEqual([]);
  expect(d.changed).toContain('invoices');
});

test('a module whose newest timestamp has not moved is skipped', () => {
  const ctx = load({
    zohoGet: probeStub,
    props: { DELTA_WATERMARKS: JSON.stringify(NEWEST) },
  });
  const d = ctx.detectChanges();
  // vendorpayments has no timestamp at all -> cannot be reasoned about
  expect(d.unchanged).toContain('invoices');
  expect(d.unchanged).toContain('contacts');
  expect(d.changed).toEqual(['vendorpayments']);
});

test('one newer record flips only that module to changed', () => {
  const marks = Object.assign({}, NEWEST, { invoices: '2026-07-20T00:00:00+0530' });
  const ctx = load({ zohoGet: probeStub, props: { DELTA_WATERMARKS: JSON.stringify(marks) } });
  const d = ctx.detectChanges();
  expect(d.changed).toContain('invoices');
  expect(d.unchanged).toContain('bills');
});

test('a module with no timestamp is treated as changed, never as up to date', () => {
  // Safer to re-read than to silently skip data we cannot reason about.
  const ctx = load({
    zohoGet: () => ({ invoices: [] }),
    props: { DELTA_WATERMARKS: JSON.stringify(NEWEST) },
  });
  expect(ctx.detectChanges().changed.length).toBe(8);
});

test('a probe that throws is treated as changed, not as unchanged', () => {
  const ctx = load({
    zohoGet: () => { throw new Error('sort_column unsupported'); },
    props: { DELTA_WATERMARKS: JSON.stringify(NEWEST) },
  });
  expect(ctx.detectChanges().unchanged).toEqual([]);
});

test('banktransactions is never offered for delta fetch', () => {
  const ctx = load({ zohoGet: probeStub });
  const names = ctx.DELTA_MODULES.map((m) => m[0]);
  expect(names).not.toContain('banktransactions');
  expect(ctx.FULL_ONLY_MODULES.map((m) => m[0])).toContain('banktransactions');
});

test('fetchDelta passes the watermark and pages until exhausted', () => {
  let page = 0;
  const ctx = load({
    zohoGet: (p, params) => {
      page++;
      return {
        invoices: [{ invoice_id: 'i' + page }],
        page_context: { has_more_page: page < 3 },
      };
    },
  });
  const r = ctx.fetchDelta('invoices', 'invoices', '2026-07-01T00:00:00+0530');
  expect(r.rows.length).toBe(3);
  expect(r.calls).toBe(3);
  expect(r.full).toBe(false);
  expect(ctx.__calls[0].params.last_modified_time).toBe('2026-07-01T00:00:00+0530');
});

test('fetchDelta with no watermark is a full pull and says so', () => {
  const ctx = load({
    zohoGet: () => ({ invoices: [{ invoice_id: 'a' }], page_context: { has_more_page: false } }),
  });
  const r = ctx.fetchDelta('invoices', 'invoices', null);
  expect(r.full).toBe(true);
  expect(ctx.__calls[0].params.last_modified_time).toBeUndefined();
});

test('watermarks only advance for modules that reported a timestamp', () => {
  const ctx = load({ zohoGet: probeStub });
  ctx.saveWatermarks({ invoices: '2026-07-25T13:34:12+0530', vendorpayments: null });
  const saved = JSON.parse(ctx.__store.DELTA_WATERMARKS);
  expect(saved.invoices).toBe('2026-07-25T13:34:12+0530');
  expect('vendorpayments' in saved).toBe(false);
});

test('reset forces the next run to pull everything', () => {
  const ctx = load({ zohoGet: probeStub, props: { DELTA_WATERMARKS: JSON.stringify(NEWEST) } });
  ctx.resetWatermarks();
  expect(ctx.detectChanges().unchanged).toEqual([]);
});
