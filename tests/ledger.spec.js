const { test } = require('./helpers/fixture');
const { expect } = require('@playwright/test');

// Task 12 — party ledger + mark paid. MOCK_LEDGER: YARA, outstanding 412300,
// 2 open invoices (INV-002841 overdue, INV-002902 sent).

test('renders party header, outstanding, and open invoices', async ({ page, loadPage }) => {
  await loadPage('ledger', { query: 'id=116000000071027' });
  await expect(page.locator('#partyName')).toHaveText('YARA FERTILISERS INDIA PVT. LTD.');
  await expect(page.locator('#outstanding')).toHaveText('₹4,12,300');
  const rows = page.locator('#invoiceHost > div');
  await expect(rows).toHaveCount(2);
  await expect(page.locator('#invoiceHost')).toContainText('INV-002841');
  // overdue invoice carries the red pill
  await expect(page.locator('#invoiceHost .pill-overdue')).toHaveText('overdue');
});

test('Mark paid opens the capture sheet with invoice + amount', async ({ page, loadPage }) => {
  await loadPage('ledger', { query: 'id=116000000071027' });
  await page.locator('.markBtn').first().click();
  await expect(page.locator('#sheet')).toHaveClass(/open/);
  await expect(page.locator('#sheetInv')).toHaveText('INV-002841');
  await expect(page.locator('#sheetAmt')).toHaveText('₹1,95,511');
});

test('Confirm paid calls markInvoicePaid with the invoice id and closes', async ({ page, loadPage }) => {
  await loadPage('ledger', { query: 'id=116000000071027' });
  await page.evaluate(() => {
    window.__paidWith = null;
    window.__gasOverride('markInvoicePaid', (obj) => { window.__paidWith = obj; return { success: true, payment_id: 'P1', applied: 195511 }; });
  });

  await page.locator('.markBtn').first().click();
  page.once('dialog', (d) => d.accept());
  await page.locator('#confirmBtn').click();

  await expect(page.locator('#sheet')).not.toHaveClass(/open/);
  const paid = await page.evaluate(() => window.__paidWith);
  expect(paid.invoiceId).toBe('116000000618057');
});

test('cancelling the confirm writes nothing to Zoho', async ({ page, loadPage }) => {
  await loadPage('ledger', { query: 'id=116000000071027' });
  await page.evaluate(() => {
    window.__paidWith = null;
    window.__gasOverride('markInvoicePaid', (obj) => { window.__paidWith = obj; return { success: true }; });
  });

  await page.locator('.markBtn').first().click();
  page.once('dialog', (d) => d.dismiss());
  await page.locator('#confirmBtn').click();

  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__paidWith)).toBe(null);
});

// The Ledger nav tab carries no ?id=. It used to fall back to a hardcoded
// contact id that does not exist in this org, so the tab 404'd every time.
test('Ledger tab with no id shows a party picker, not a dead fetch', async ({ page, loadPage }) => {
  await loadPage('ledger');
  await page.evaluate(() => {
    window.__ledgerFetched = false;
    window.__gasOverride('getPartyLedger', () => { window.__ledgerFetched = true; return {}; });
  });

  await expect(page.locator('#openHeading')).toHaveText('Choose a party');
  await expect(page.locator('#invoiceHost')).toContainText('Yash Poly Plast');
  await expect(page.locator('#invoiceHost')).toContainText('We owe them');
  await expect(page.locator('#invoiceHost')).toContainText('They owe us');

  // and it must NOT have tried to fetch a ledger for a made-up id
  expect(await page.evaluate(() => window.__ledgerFetched)).toBe(false);
});

test('picker rows carry the real contact id as the ledger link', async ({ page, loadPage }) => {
  await loadPage('ledger');
  const row = page.locator('#invoiceHost [data-go="ledger"]').first();
  await expect(row).toHaveAttribute('data-go-params', /116000000618777/);
});

// A vendor's ledger was blank before: the server read only the invoice side, so
// payVendorBill had no screen at all.
test('vendor ledger lists open BILLS and pays via payVendorBill', async ({ page, loadPage }) => {
  await loadPage('ledger', { query: 'id=116000000618777' });

  await expect(page.locator('#partyName')).toHaveText('Yash Poly Plast');
  await expect(page.locator('#openHeading')).toHaveText('Open bills');
  await expect(page.locator('#invoiceHost')).toContainText('YPP/24-25/1182');
  await expect(page.locator('.markBtn').first()).toHaveText('Pay');

  await page.evaluate(() => {
    window.__paidWith = null;
    window.__gasOverride('payVendorBill', (obj) => { window.__paidWith = obj; return { success: true, payment_id: 'VP1' }; });
  });

  await page.locator('.markBtn').first().click();
  page.once('dialog', (d) => d.accept());
  await page.locator('#confirmBtn').click();

  await expect(page.locator('#sheet')).not.toHaveClass(/open/);
  const paid = await page.evaluate(() => window.__paidWith);
  expect(paid.billId).toBe('116000000700111');
  expect(paid.vendorId).toBe('116000000618777');
  expect(paid.amount).toBe(174378);
});

test('vendor ledger never calls markInvoicePaid', async ({ page, loadPage }) => {
  await loadPage('ledger', { query: 'id=116000000618777' });
  await page.evaluate(() => {
    window.__wrongCall = false;
    window.__gasOverride('markInvoicePaid', () => { window.__wrongCall = true; return { success: true }; });
  });

  await page.locator('.markBtn').first().click();
  page.once('dialog', (d) => d.accept());
  await page.locator('#confirmBtn').click();

  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__wrongCall)).toBe(false);
});

// Plan Task 12: "short-payment shows TDS-clears-in-full line".
test('entering TDS spells out the split before anything is posted', async ({ page, loadPage }) => {
  await loadPage('ledger', { query: 'id=116000000071027' });
  await page.locator('.markBtn').first().click();          // INV-002841, 195511

  await expect(page.locator('#tdsNote')).toBeHidden();
  await page.locator('#tdsInput').fill('2000');

  await expect(page.locator('#tdsNote')).toBeVisible();
  await expect(page.locator('#tdsNote')).toContainText('₹1,93,511');   // cash in
  await expect(page.locator('#tdsNote')).toContainText('clears in full');
  await expect(page.locator('#tdsNote')).toContainText('TDS Receivable');
});

test('the TDS figure reaches markInvoicePaid', async ({ page, loadPage }) => {
  await loadPage('ledger', { query: 'id=116000000071027' });
  await page.evaluate(() => {
    window.__paidWith = null;
    window.__gasOverride('markInvoicePaid', (obj) => { window.__paidWith = obj; return { success: true }; });
  });

  await page.locator('.markBtn').first().click();
  await page.locator('#tdsInput').fill('2000');
  page.once('dialog', (d) => d.accept());
  await page.locator('#confirmBtn').click();

  const paid = await page.evaluate(() => window.__paidWith);
  expect(paid.tdsAmount).toBe(2000);
});

test('TDS at or above the invoice is refused by the screen too', async ({ page, loadPage }) => {
  await loadPage('ledger', { query: 'id=116000000071027' });
  await page.locator('.markBtn').first().click();
  await page.locator('#tdsInput').fill('999999');          // exceeds 195511
  await expect(page.locator('#tdsNote')).toBeHidden();
});

test('a vendor bill offers no TDS box', async ({ page, loadPage }) => {
  // TDS deduction is a customer-side concept in this flow.
  await loadPage('ledger', { query: 'id=116000000618777' });
  await page.locator('.markBtn').first().click();
  await expect(page.locator('#tdsRow')).toBeHidden();
});

test('short-payment note: overdue invoice shows the red overdue pill (TDS/partial context)', async ({ page, loadPage }) => {
  await loadPage('ledger', { query: 'id=116000000071027' });
  await expect(page.locator('#invoiceHost')).toContainText('overdue');
  await expect(page.locator('#invoiceHost')).toContainText('sent');
});
