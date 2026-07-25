const { test, expect } = require('@playwright/test');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

// A read cache is only safe if writes invalidate it. These lock that contract:
// stale balances after a payment would be worse than a slow dashboard.
function ctxWith(files) {
  const store = {};
  const c = {
    module: { exports: {} },
    console: { error() {}, log() {} },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (k in store ? store[k] : null),
        put: (k, v) => { store[k] = v; },
        remove: (k) => { delete store[k]; },
        removeAll: (ks) => ks.forEach((k) => { delete store[k]; }),
      }),
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    __store: store,
  };
  vm.createContext(c);
  files.forEach((f) => vm.runInContext(
    fs.readFileSync(path.join(process.cwd(), 'src', f), 'utf8'), c));
  return c;
}

test('cachedRead calls the reader once, then serves from cache', () => {
  const c = ctxWith(['ZohoClient.js']);
  c.calls = 0;
  const read = () => vm.runInContext(
    'cachedRead("k", 300, function(){ calls++; return {v:1}; })', c);
  expect(read()).toEqual({ v: 1 });
  expect(read()).toEqual({ v: 1 });
  expect(c.calls).toBe(1);            // second call never hit Zoho
});

test('cacheBust forces the next read to go fresh', () => {
  const c = ctxWith(['ZohoClient.js']);
  c.calls = 0;
  const read = () => vm.runInContext(
    'cachedRead("k", 300, function(){ calls++; return {v:calls}; })', c);
  read();
  vm.runInContext('cacheBust("k")', c);
  expect(read()).toEqual({ v: 2 });
  expect(c.calls).toBe(2);
});

test('a write busts every cached read', () => {
  const c = ctxWith(['ZohoClient.js']);
  vm.runInContext('cachedRead("home_data",600,function(){return {a:1};})', c);
  vm.runInContext('cachedRead("uncategorized",300,function(){return {b:1};})', c);
  expect(Object.keys(c.__store).sort()).toEqual(['home_data', 'uncategorized']);

  vm.runInContext('cacheBustAll()', c);
  expect(Object.keys(c.__store)).toEqual([]);
});

test('acceptMatch busts the cache so the row cannot reappear', () => {
  const c = ctxWith(['ZohoClient.js', 'Reconcile.js']);
  c.zohoGet = () => ({ banktransaction: { status: 'uncategorized' } });
  c.zohoPost = () => ({ code: 0 });
  vm.runInContext('cachedRead("uncategorized",300,function(){return [1,2,3];})', c);
  vm.runInContext('acceptMatch("T1", {id:"INV9", type:"invoice"})', c);
  expect(c.__store.uncategorized).toBeUndefined();
});

test('a cache write too large to store still returns the fresh value', () => {
  const c = ctxWith(['ZohoClient.js']);
  // CacheService.put throws for oversized payloads; the read must not fail
  c.CacheService.getScriptCache = () => ({
    get: () => null,
    put: () => { throw new Error('exceeds maximum length'); },
    remove: () => {}, removeAll: () => {},
  });
  const out = vm.runInContext('cachedRead("big", 300, function(){ return {ok:true}; })', c);
  expect(out).toEqual({ ok: true });
});
