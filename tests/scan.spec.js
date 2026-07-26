const { test } = require('./helpers/fixture');
const { expect } = require('@playwright/test');

// Task 9 — scan flow: capture → downscale → ocrExtract → parseBill →
// matchContactByGstin, branching matched vs no-match. Mock parseBill returns
// gstin 27AABFY9773F1ZN; matchContactByGstin returns MOCK_MATCH for that gstin,
// null otherwise.

// Drive the scan flow without a real camera/file: stub downscaleImage (its own
// downscale.spec.js already proves the <2MB reduction) so the test exercises the
// OCR → parse → match WIRING, which is what this screen is responsible for.
async function driveScan(page) {
  await page.evaluate(() => {
    window.downscaleImage = () => Promise.resolve({ base64: 'AAAA', mime: 'image/jpeg', bytes: 3 });
    window.__scanOnFile(new Blob(['x'], { type: 'image/jpeg' }));
  });
}

// PDFs skip the canvas downscaler entirely — fileToBase64 reads them as-is and
// hands ocrExtract an application/pdf mime, which Drive OCR accepts directly.
async function drivePdfScan(page, sizeBytes) {
  await page.evaluate((n) => {
    const file = new File([new Uint8Array(n)], 'bill.pdf', { type: 'application/pdf' });
    window.__scanOnFile(file);
  }, sizeBytes || 32);
}

test('matched branch: parsed fields shown + matched party rendered', async ({ page, loadPage }) => {
  await loadPage('scan');
  await driveScan(page);

  // parsed fields populate from mock parseBill
  await expect(page.locator('#readSection')).toBeVisible();
  await expect(page.locator('#rGstin')).toHaveText('27AABFY9773F1ZN');
  await expect(page.locator('#rInvoice')).toHaveText('YPP/24-25/1182');

  // matched party appears (MOCK_MATCH), no-match hidden
  await expect(page.locator('#matchedSection')).toBeVisible();
  await expect(page.locator('#mName')).toHaveText('YARA FERTILISERS INDIA PVT. LTD.');
  await expect(page.locator('#matchedSection .tag-matched')).toHaveText('Matched');
  await expect(page.locator('#noMatchSection')).toBeHidden();
  await expect(page.locator('#actionBar')).toBeVisible();
});

test('no-match branch: red notice + create-supplier tile', async ({ page, loadPage }) => {
  await loadPage('scan');

  // Override parseBill to yield a gstin the mock match won't recognise, so the
  // page's OWN flow (parseBill → matchContactByGstin → null) drives the no-match
  // render — not a hand-forced DOM change.
  await page.evaluate(() => {
    window.__gasOverride('parseBill', () =>
      ({ supplier: 'Unknown Co', gstin: '99ZZZZZ0000Z1Z9', invoiceNo: 'X1', amount: 100, gstPct: 18 }));
  });

  await driveScan(page);

  await expect(page.locator('#noMatchSection')).toBeVisible();
  await expect(page.locator('#noMatchSection')).toContainText('No matching party found');
  await expect(page.locator('#createVendorBtn')).toBeVisible();
  await expect(page.locator('#matchedSection')).toBeHidden();
});

test('pdf upload: sent to ocrExtract as application/pdf, not canvas-downscaled', async ({ page, loadPage }) => {
  await loadPage('scan');

  // Capture what actually reaches the server, and prove the image path is untouched.
  await page.evaluate(() => {
    window.__downscaleCalled = false;
    window.downscaleImage = () => { window.__downscaleCalled = true; return Promise.reject(new Error('not for pdf')); };
    window.__gasOverride('ocrExtract', (b64, mime) => {
      window.__ocrArgs = { b64: b64, mime: mime };
      return 'TAX INVOICE\nGSTIN 27AABFY9773F1ZN\nYash Poly Plast\nYPP/24-25/1182\nTotal 1,74,378';
    });
  });

  await drivePdfScan(page);

  await expect(page.locator('#readSection')).toBeVisible();
  const args = await page.evaluate(() => window.__ocrArgs);
  expect(args.mime).toBe('application/pdf');
  expect(args.b64.length).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__downscaleCalled)).toBe(false);

  // and the rest of the flow still runs off the OCR text
  await expect(page.locator('#rGstin')).toHaveText('27AABFY9773F1ZN');
  await expect(page.locator('#matchedSection')).toBeVisible();
});

test('pdf over 2MB: rejected with a size-specific message', async ({ page, loadPage }) => {
  await loadPage('scan');
  await drivePdfScan(page, 2 * 1024 * 1024 + 1024);

  await expect(page.locator('#statusHost')).toContainText('PDF is too large');
  await expect(page.locator('#readSection')).toBeHidden();
});

test('file input accepts pdf as well as images', async ({ page, loadPage }) => {
  await loadPage('scan');
  await expect(page.locator('#fileInput')).toHaveAttribute('accept', 'image/*,application/pdf');
  // camera must not be forced, or the picker hides Files/Drive on mobile
  await expect(page.locator('#fileInput')).not.toHaveAttribute('capture', /.*/);
});

test('scanned document is archived to Drive with supplier-stamped name', async ({ page, loadPage }) => {
  await loadPage('scan');
  await page.evaluate(() => {
    window.__gasOverride('archiveScan', (b64, mime, supplier) => {
      window.__archiveArgs = { b64: b64, mime: mime, supplier: supplier };
      return { fileId: 'x', url: 'https://drive.google.com/file/d/x/view' };
    });
  });

  await driveScan(page);

  await expect.poll(() => page.evaluate(() => window.__archiveArgs)).toBeTruthy();
  const args = await page.evaluate(() => window.__archiveArgs);
  expect(args.mime).toBe('image/jpeg');
  expect(args.supplier).toBe('Yash Poly Plast'); // from parseBill, so the file is findable
  expect(args.b64).toBe('AAAA');                 // the ORIGINAL bytes, not the OCR text
});

test('archive failure does not disturb a scan that already succeeded', async ({ page, loadPage }) => {
  await loadPage('scan');
  await page.evaluate(() => {
    window.__gasOverride('archiveScan', () => { throw new Error('drive down'); });
  });

  await driveScan(page);

  // parsed + matched results still stand; no error surfaced to the user
  await expect(page.locator('#readSection')).toBeVisible();
  await expect(page.locator('#matchedSection')).toBeVisible();
  await expect(page.locator('#statusHost')).not.toContainText('Could not');
});

test('archived document is shown as an openable Drive link', async ({ page, loadPage }) => {
  await loadPage('scan');
  await driveScan(page);

  const link = page.locator('#rDocLink');
  await expect(page.locator('#rDocRow')).toBeVisible();
  await expect(link).toHaveAttribute('href', 'https://drive.google.com/file/d/1ArCh1V3/view');
  // must open outside the GAS sandbox iframe, or Drive renders blank
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /noopener/);
});

test('no document row when archiving failed', async ({ page, loadPage }) => {
  await loadPage('scan');
  await page.evaluate(() => {
    window.__gasOverride('archiveScan', () => { throw new Error('drive down'); });
  });
  await driveScan(page);

  await expect(page.locator('#readSection')).toBeVisible();
  await expect(page.locator('#rDocRow')).toBeHidden();
});

test('expense account defaults to Cost of Goods Sold and is changeable', async ({ page, loadPage }) => {
  await loadPage('scan');
  await driveScan(page);

  // default first — 97.8% of this org's real bill lines hit COGS
  await expect(page.locator('#rAccount')).toHaveValue('1161923000000034003');
  await expect(page.locator('#rAccount option').first()).toHaveText('Cost of Goods Sold');
});

test('posting sends the chosen account and the archived scan url', async ({ page, loadPage }) => {
  await loadPage('scan');
  await page.evaluate(() => {
    window.__gasOverride('postBill', (obj) => { window.__billed = obj; return { success: true, bill_id: 'B1' }; });
  });
  await driveScan(page);
  await page.locator('#rAccount').selectOption('1161923000000000460'); // override the default

  page.once('dialog', (d) => d.accept());
  await page.locator('#postBtn').click();

  await expect.poll(() => page.evaluate(() => window.__billed)).toBeTruthy();
  const sent = await page.evaluate(() => window.__billed);
  expect(sent.expenseAccountId).toBe('1161923000000000460');
  expect(sent.vendorId).toBe('116000000071027'); // the GSTIN-matched supplier
  expect(sent.scanUrl).toBe('https://drive.google.com/file/d/1ArCh1V3/view');
  await expect(page.locator('#statusHost')).toContainText('Bill posted');
});

test('cancelling the confirm writes nothing to Zoho', async ({ page, loadPage }) => {
  await loadPage('scan');
  await page.evaluate(() => {
    window.__posted = false;
    window.__gasOverride('postBill', () => { window.__posted = true; return { success: true, bill_id: 'B1' }; });
  });
  await driveScan(page);

  page.once('dialog', (d) => d.dismiss());
  await page.locator('#postBtn').click();

  expect(await page.evaluate(() => window.__posted)).toBe(false);
});

// ── Confirm-before-post guard. OCR is best-effort; a wrong total posts real
// money, so the amount is editable and the USER's figure is what gets sent.

test('the amount is editable and the users figure is what posts', async ({ page, loadPage }) => {
  await loadPage('scan');
  await page.evaluate(() => {
    window.__gasOverride('postBill', (obj) => { window.__billed = obj; return { success: true, bill_id: 'B1' }; });
  });
  await driveScan(page);

  // OCR read 174378; the user corrects it against the paper bill
  await expect(page.locator('#rAmount')).toHaveValue('174378.00');
  await page.locator('#rAmount').fill('51212.00');

  page.once('dialog', (d) => d.accept());
  await page.locator('#postBtn').click();

  await expect.poll(() => page.evaluate(() => window.__billed)).toBeTruthy();
  expect(await page.evaluate(() => window.__billed.amount)).toBe(51212);
});

test('posting is refused when the amount box is empty', async ({ page, loadPage }) => {
  await loadPage('scan');
  await page.evaluate(() => {
    window.__posted = false;
    window.__gasOverride('postBill', () => { window.__posted = true; return { success: true }; });
  });
  await driveScan(page);

  await page.locator('#rAmount').fill('');
  await page.locator('#postBtn').click();

  await expect(page.locator('#statusHost')).toContainText('Enter the bill amount');
  expect(await page.evaluate(() => window.__posted)).toBe(false);
});

test('unreadable fields raise a check-before-posting warning', async ({ page, loadPage }) => {
  await loadPage('scan');
  await page.evaluate(() => {
    window.__gasOverride('parseBill', () =>
      ({ supplier: 'Yash Poly Plast', gstin: '27AABFY9773F1ZN', invoiceNo: null,
         amount: null, gstPct: null, date: null, checksOut: false }));
  });
  await driveScan(page);

  await expect(page.locator('#checkWarn')).toBeVisible();
  await expect(page.locator('#checkWarnText')).toContainText('amount could not be read');
  await expect(page.locator('#checkWarnText')).toContainText('does not equal the total');
  await expect(page.locator('#rAmount')).toHaveValue('');
});

test('a fully-read bill shows no warning', async ({ page, loadPage }) => {
  await loadPage('scan');
  await page.evaluate(() => {
    window.__gasOverride('parseBill', () =>
      ({ supplier: 'Yash Poly Plast', gstin: '27AABFY9773F1ZN', invoiceNo: 'YPP/1',
         amount: 1000, gstPct: 18, date: '2026-07-04', checksOut: true }));
  });
  await driveScan(page);

  await expect(page.locator('#checkWarn')).toBeHidden();
  await expect(page.locator('#rDate')).toHaveText('2026-07-04');
  await expect(page.locator('#rGst')).toHaveText('18%');
});

// ── Receipt mode. A BILL is owed to a vendor and settled later; a RECEIPT is
// money already spent. Posting a receipt as a bill would create a payable that
// is never paid, so they are separate Zoho records.

test('receipt mode records an expense, not a bill', async ({ page, loadPage }) => {
  await loadPage('scan');
  await page.evaluate(() => {
    window.__billed = null; window.__expensed = null;
    window.__gasOverride('postBill', (o) => { window.__billed = o; return { success: true, bill_id: 'B1' }; });
    window.__gasOverride('postExpense', (o) => { window.__expensed = o; return { success: true, expense_id: 'E1' }; });
  });
  await driveScan(page);

  await page.locator('#modeReceipt').click();
  page.once('dialog', (d) => d.accept());
  await page.locator('#postBtn').click();

  await expect.poll(() => page.evaluate(() => window.__expensed)).toBeTruthy();
  expect(await page.evaluate(() => window.__billed)).toBe(null);   // never a bill
  await expect(page.locator('#statusHost')).toContainText('Expense recorded');
});

test('a receipt carries its paid-through account', async ({ page, loadPage }) => {
  await loadPage('scan');
  await page.evaluate(() => {
    window.__gasOverride('postExpense', (o) => { window.__expensed = o; return { success: true, expense_id: 'E1' }; });
  });
  await driveScan(page);
  await page.locator('#modeReceipt').click();

  // Petty Cash is the default — the common receipt case
  await expect(page.locator('#rPaidThrough')).toHaveValue('1161923000000000361');
  await page.locator('#rPaidThrough').selectOption('1161923000000540009');

  page.once('dialog', (d) => d.accept());
  await page.locator('#postBtn').click();

  const sent = await page.evaluate(() => window.__expensed);
  expect(sent.paidThroughId).toBe('1161923000000540009');
  expect(sent.amount).toBe(174378);
});

test('paid-through is hidden for a bill and shown for a receipt', async ({ page, loadPage }) => {
  await loadPage('scan');
  await driveScan(page);
  await expect(page.locator('#paidThroughRow')).toBeHidden();
  await page.locator('#modeReceipt').click();
  await expect(page.locator('#paidThroughRow')).toBeVisible();
  await page.locator('#modeBill').click();
  await expect(page.locator('#paidThroughRow')).toBeHidden();
});

test('a receipt posts without a matched supplier', async ({ page, loadPage }) => {
  // The shop on a fuel or courier receipt is rarely a Zoho contact.
  await loadPage('scan');
  await page.evaluate(() => {
    window.__expensed = null;
    window.__gasOverride('matchContactByGstin', () => null);
    window.__gasOverride('postExpense', (o) => { window.__expensed = o; return { success: true, expense_id: 'E1' }; });
  });
  await driveScan(page);

  await page.locator('#modeReceipt').click();
  await expect(page.locator('#noMatchSection')).toBeHidden();   // not an error here

  page.once('dialog', (d) => d.accept());
  await page.locator('#postBtn').click();

  const sent = await page.evaluate(() => window.__expensed);
  expect(sent).toBeTruthy();
  expect(sent.vendorId).toBe(null);
});

test('a BILL still demands a matched supplier', async ({ page, loadPage }) => {
  await loadPage('scan');
  await page.evaluate(() => {
    window.__posted = false;
    window.__gasOverride('matchContactByGstin', () => null);
    window.__gasOverride('postBill', () => { window.__posted = true; return { success: true }; });
  });
  await driveScan(page);

  await page.locator('#postBtn').click();
  await expect(page.locator('#statusHost')).toContainText('Create or match a supplier');
  expect(await page.evaluate(() => window.__posted)).toBe(false);
});

test('posting is refused without a matched supplier', async ({ page, loadPage }) => {
  await loadPage('scan');
  await page.evaluate(() => {
    window.__posted = false;
    window.__gasOverride('postBill', () => { window.__posted = true; return { success: true }; });
    window.__gasOverride('parseBill', () =>
      ({ supplier: 'Unknown Co', gstin: '99ZZZZZ0000Z1Z9', invoiceNo: 'X1', amount: 100, gstPct: 18 }));
  });
  await driveScan(page);

  await page.locator('#postBtn').click();

  await expect(page.locator('#statusHost')).toContainText('supplier');
  expect(await page.evaluate(() => window.__posted)).toBe(false);
});
