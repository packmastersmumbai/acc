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

test('settings is reachable from the shared bottom nav', async ({ page, loadPage }) => {
  await loadPage('home');
  await expect(page.locator('#pm-nav [data-go="settings"]')).toBeVisible();
});
