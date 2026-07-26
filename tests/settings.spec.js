const { test } = require('./helpers/fixture');
const { expect } = require('@playwright/test');

// Task 14 Step 2 — "Back up now" button + nightly trigger control. The backup
// module existed but had no screen, so it could only be run from the GAS editor.

test('shows backup status: never run, nightly off', async ({ page, loadPage }) => {
  await loadPage('settings');
  await expect(page.locator('#nightlyPill')).toHaveText('Off');
  await expect(page.locator('#lastBackup')).toHaveText('Never run');
  await expect(page.locator('#nightlyBtn')).toHaveText('Turn on');
});

test('the backup cadence shown comes from the server, not the markup', async ({ page, loadPage }) => {
  // Default for this org is every 3 days — ~11 bills/month does not justify
  // a nightly 22MB snapshot.
  await loadPage('settings');
  await expect(page.locator('#backupCadence')).toHaveText('Every 3 days at 02:00 IST → Drive');
});

test('a daily interval reads as "Every day", not "Every 1 days"', async ({ page, loadPage }) => {
  await loadPage('settings', {
    overrides: {
      getBackupStatus: 'function(){ return { nightly:true, everyDays:1, lastBackup:null, lastRecords:null }; }'
    }
  });
  await expect(page.locator('#backupCadence')).toHaveText('Every day at 02:00 IST → Drive');
});

// The JSON backup NAMES attachments but does not contain them. Reporting the
// files separately stops "backed up" being read as covering documents.
test('document backup state is reported separately from the data backup', async ({ page, loadPage }) => {
  await loadPage('settings');
  await expect(page.locator('#lastDocBackup')).toHaveText('Documents: not yet copied');
});

test('after a document run it reports how many attachments are held', async ({ page, loadPage }) => {
  await loadPage('settings', {
    overrides: {
      getBackupStatus: 'function(){ return { nightly:true, everyDays:3, lastBackup:"2026-07-26 02:00", lastRecords:6896, documents:{ lastBackup:"2026-07-26 02:04", saved:2, total:5 } }; }'
    }
  });
  await expect(page.locator('#lastDocBackup')).toContainText('5 attachments');
  await expect(page.locator('#lastDocBackup')).toContainText('2 new last run');
});

test('one attachment reads as singular', async ({ page, loadPage }) => {
  await loadPage('settings', {
    overrides: {
      getBackupStatus: 'function(){ return { nightly:false, everyDays:3, lastBackup:null, lastRecords:null, documents:{ lastBackup:"2026-07-26 02:04", saved:1, total:1 } }; }'
    }
  });
  await expect(page.locator('#lastDocBackup')).toContainText('1 attachment in Drive');
});

test('reports a previous backup with its record count', async ({ page, loadPage }) => {
  await loadPage('settings', {
    overrides: {
      getBackupStatus: 'function(){ return { nightly: true, lastBackup: "2026-07-24 02:00", lastRecords: 5856 }; }'
    }
  });
  await expect(page.locator('#nightlyPill')).toHaveText('On');
  await expect(page.locator('#lastBackup')).toContainText('2026-07-24 02:00');
  await expect(page.locator('#lastBackup')).toContainText('5856 records');
  await expect(page.locator('#nightlyBtn')).toHaveText('Turn off');
});

test('Back up now calls backupNow and reports the record count', async ({ page, loadPage }) => {
  await loadPage('settings');
  await page.evaluate(() => {
    window.__ranBackup = false;
    window.__gasOverride('backupNow', () => { window.__ranBackup = true; return { records: 5856, driveFileId: 'f1' }; });
  });

  await page.locator('#backupBtn').click();

  await expect(page.locator('#backupStatus')).toContainText('Backup complete');
  await expect(page.locator('#backupStatus')).toContainText('5856 records');
  expect(await page.evaluate(() => window.__ranBackup)).toBe(true);
});

test('a failed backup surfaces an error and re-enables the button', async ({ page, loadPage }) => {
  await loadPage('settings');
  await page.evaluate(() => {
    window.__gasOverride('backupNow', () => { throw new Error('Drive quota exceeded'); });
  });

  await page.locator('#backupBtn').click();

  await expect(page.locator('#backupStatus')).toContainText('Backup failed');
  await expect(page.locator('#backupBtn')).toBeEnabled();
});

test('Turn on installs the nightly trigger and flips the pill', async ({ page, loadPage }) => {
  await loadPage('settings');
  await page.evaluate(() => {
    window.__installed = false;
    window.__gasOverride('installNightlyBackup', () => {
      window.__installed = true;
      return { nightly: true, lastBackup: null, lastRecords: null };
    });
  });

  await page.locator('#nightlyBtn').click();

  await expect(page.locator('#nightlyPill')).toHaveText('On');
  await expect(page.locator('#nightlyBtn')).toHaveText('Turn off');
  expect(await page.evaluate(() => window.__installed)).toBe(true);
});

test('Turn off removes the nightly trigger', async ({ page, loadPage }) => {
  await loadPage('settings', {
    overrides: {
      getBackupStatus: 'function(){ return { nightly: true, lastBackup: null, lastRecords: null }; }'
    }
  });
  await page.evaluate(() => {
    window.__removed = false;
    window.__gasOverride('removeNightlyBackup', () => {
      window.__removed = true;
      return { nightly: false, lastBackup: null, lastRecords: null };
    });
  });

  await expect(page.locator('#nightlyBtn')).toHaveText('Turn off');
  await page.locator('#nightlyBtn').click();

  await expect(page.locator('#nightlyPill')).toHaveText('Off');
  expect(await page.evaluate(() => window.__removed)).toBe(true);
});

test('Clear cache calls cacheBustAll', async ({ page, loadPage }) => {
  await loadPage('settings');
  await page.evaluate(() => {
    window.__busted = false;
    window.__gasOverride('cacheBustAll', () => { window.__busted = true; return { success: true }; });
  });

  await page.locator('#cacheBtn').click();

  await expect(page.locator('#cacheStatus')).toContainText('Cache cleared');
  expect(await page.evaluate(() => window.__busted)).toBe(true);
});

// ── Google Sheet export. The 22MB backup JSON is the complete record; the
// sheet is flat summary tabs you can actually filter.

test('shows sheet export state: never run, schedule off', async ({ page, loadPage }) => {
  await loadPage('settings');
  await expect(page.locator('#sheetPill')).toHaveText('Off');
  await expect(page.locator('#lastExport')).toHaveText('Never run');
  await expect(page.locator('#sheetLink')).toBeHidden();
});

test('a previous export shows its row count and a link to the sheet', async ({ page, loadPage }) => {
  await loadPage('settings', {
    overrides: {
      getSheetStatus: 'function(){ return { sheetId:"s1", url:"https://docs.google.com/spreadsheets/d/s1/edit", scheduled:true, lastExport:"2026-07-26 03:00", lastRows:6896 }; }'
    }
  });
  await expect(page.locator('#sheetPill')).toHaveText('On');
  await expect(page.locator('#lastExport')).toContainText('6896 rows');
  await expect(page.locator('#sheetLink')).toBeVisible();
  await expect(page.locator('#sheetLink')).toHaveAttribute('href', /spreadsheets\/d\/s1/);
});

test('Export now calls exportToSheet and reports rows and tabs', async ({ page, loadPage }) => {
  await loadPage('settings');
  await page.evaluate(() => {
    window.__exported = false;
    window.__gasOverride('exportToSheet', () => {
      window.__exported = true;
      return { spreadsheetId: 's1', url: 'u', records: 6896,
               tabs: [{ name: 'Contacts', rows: 171 }, { name: 'Invoices', rows: 3854 }] };
    });
  });

  await page.locator('#exportBtn').click();

  await expect(page.locator('#sheetStatus')).toContainText('Sheet updated');
  await expect(page.locator('#sheetStatus')).toContainText('6896 rows');
  expect(await page.evaluate(() => window.__exported)).toBe(true);
});

test('a failed export surfaces an error and re-enables the button', async ({ page, loadPage }) => {
  await loadPage('settings');
  await page.evaluate(() => {
    window.__gasOverride('exportToSheet', () => { throw new Error('Sheets quota exceeded'); });
  });

  await page.locator('#exportBtn').click();

  await expect(page.locator('#sheetStatus')).toContainText('Export failed');
  await expect(page.locator('#exportBtn')).toBeEnabled();
});

test('Turn on arms the nightly sheet export', async ({ page, loadPage }) => {
  await loadPage('settings');
  await page.evaluate(() => {
    window.__armed = false;
    window.__gasOverride('installNightlySheetExport', () => {
      window.__armed = true;
      return { scheduled: true, url: null, lastExport: null, lastRows: null };
    });
  });

  await page.locator('#sheetSchedBtn').click();

  await expect(page.locator('#sheetPill')).toHaveText('On');
  expect(await page.evaluate(() => window.__armed)).toBe(true);
});

test('the two schedules are independent — backup and sheet', async ({ page, loadPage }) => {
  // Turning the sheet export on must not touch the backup trigger.
  await loadPage('settings');
  await page.evaluate(() => {
    window.__backupTouched = false;
    window.__gasOverride('installNightlyBackup', () => {
      window.__backupTouched = true;
      return { nightly: true, lastBackup: null, lastRecords: null };
    });
  });

  await page.locator('#sheetSchedBtn').click();
  await page.waitForTimeout(300);

  expect(await page.evaluate(() => window.__backupTouched)).toBe(false);
  await expect(page.locator('#nightlyPill')).toHaveText('Off');
});

test('settings is reachable from the shared bottom nav', async ({ page, loadPage }) => {
  await loadPage('home');
  await expect(page.locator('#pm-nav [data-go="settings"]')).toBeVisible();
});
