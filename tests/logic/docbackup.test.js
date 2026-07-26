const { test, expect } = require('@playwright/test');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

// DocumentBackup.js holds pure naming helpers that decide what a saved
// attachment is called. Load them without GAS.
const ctx = { module: { exports: {} } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/DocumentBackup.js'), 'utf8'), ctx);

test('the extension follows the served content type, not an assumption', () => {
  // A live run found an Excel file among five invoice attachments; defaulting
  // to .pdf saved the right bytes under a lying name.
  expect(ctx._docExtension_('application/pdf')).toBe('.pdf');
  expect(ctx._docExtension_('application/vnd.ms-excel')).toBe('.xls');
  expect(ctx._docExtension_('image/png')).toBe('.png');
  expect(ctx._docExtension_('image/jpeg')).toBe('.jpg');
  expect(ctx._docExtension_(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('.xlsx');
});

test('a content type with charset or casing still resolves', () => {
  expect(ctx._docExtension_('application/pdf; charset=binary')).toBe('.pdf');
  expect(ctx._docExtension_('IMAGE/PNG')).toBe('.png');
});

test('an unknown type keeps the bytes but claims no format', () => {
  expect(ctx._docExtension_('application/x-weird')).toBe('.bin');
  expect(ctx._docExtension_('')).toBe('.bin');
  expect(ctx._docExtension_(null)).toBe('.bin');
});

test('the base name is filesystem-safe', () => {
  // Zoho document numbers can carry slashes: RBQ/2026-27/142
  expect(ctx._docBaseName_('RBQ/2026-27/142')).toBe('RBQ-2026-27-142');
  expect(ctx._docBaseName_('INV:24181*?')).toBe('INV-24181--');
  expect(ctx._docBaseName_(null)).toBe('unknown');
});

test('the base name is stable, so re-runs recognise saved files', () => {
  // Idempotency depends on this: the existence check runs BEFORE download,
  // when the extension is not yet known.
  expect(ctx._docBaseName_('INV24181')).toBe(ctx._docBaseName_('INV24181'));
});

test('only modules that can carry attachments are scanned', () => {
  const mods = ctx.DOC_BACKUP_MODULES.map((m) => m[0]);
  expect(mods).toContain('invoices');
  expect(mods).toContain('bills');
  expect(mods).toContain('expenses');
  // banktransactions have no attachments — scanning them would be wasted calls
  expect(mods).not.toContain('banktransactions');
});
