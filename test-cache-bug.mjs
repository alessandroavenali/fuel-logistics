import { chromium } from 'playwright';

const URL = 'https://fuel.flipr.cloud/schedules';

async function testCalculateMax() {
  const browser = await chromium.launch({ headless: false }); // Show browser for debugging
  const page = await browser.newPage();

  console.log('Navigating to', URL);
  await page.goto(URL);
  await page.waitForTimeout(3000);

  // Click "Nuova Pianificazione" button
  console.log('\n=== Opening create schedule dialog ===');
  await page.click('button:has-text("Nuova Pianificazione")');
  await page.waitForTimeout(1000);

  // Fill name
  await page.fill('input[name="name"]', 'Test Cache Bug');

  // Set initial dates to ensure driver grid is visible
  await page.fill('input[name="startDate"]', '2026-02-04');
  await page.fill('input[name="endDate"]', '2026-02-13');
  await page.waitForTimeout(1000);

  // Select ALL drivers for ALL days by clicking every "Tutti" button
  console.log('Selecting all drivers for all days...');
  const tuttiButtons = page.locator('button:has-text("Tutti")');
  const count = await tuttiButtons.count();
  console.log(`Found ${count} "Tutti" buttons - clicking all of them`);
  for (let i = 0; i < count; i++) {
    try {
      await tuttiButtons.nth(i).click({ timeout: 1000 });
      await page.waitForTimeout(100);
    } catch (e) {
      // Skip if not clickable
    }
  }
  await page.waitForTimeout(500);

  async function calculateAndGetResult(endDate, testName) {
    console.log(`\n=== ${testName} ===`);

    // Only change end date (start date stays 2026-02-04)
    await page.fill('input[name="endDate"]', endDate);
    await page.waitForTimeout(500);

    // Click MAX button
    await page.click('button:has-text("MAX")');
    await page.waitForTimeout(6000);

    // Take screenshot
    await page.screenshot({ path: `/tmp/test-${testName}.png` });

    // Get result from the MAX dialog
    let result = 'Not found';
    try {
      // Look for the dialog and get its content
      const dialogs = page.locator('[role="dialog"]');
      const dialogCount = await dialogs.count();
      console.log(`Found ${dialogCount} dialogs`);

      // Get the last dialog (should be the MAX preview)
      if (dialogCount > 0) {
        const lastDialog = dialogs.last();
        const text = await lastDialog.textContent({ timeout: 2000 });

        // Look for pattern like "735.000L" or "735,000L"
        const match = text.match(/(\d{3}[.,]\d{3})\s*L/);
        if (match) {
          result = match[1].replace(',', '.') + 'L';
        }
      }
    } catch (e) {
      console.log('Error getting result:', e.message);
    }

    console.log(`Result: ${result}`);

    // Close the MAX dialog by clicking its Annulla button
    try {
      // The MAX dialog should be the last one, click its Annulla
      const maxDialogAnnulla = page.locator('[role="dialog"]').last().locator('button:has-text("Annulla")');
      await maxDialogAnnulla.click({ timeout: 2000 });
    } catch (e) {
      // Try Escape
      await page.keyboard.press('Escape');
    }
    await page.waitForTimeout(500);

    return result;
  }

  // Run tests - only changing end date
  const r1 = await calculateAndGetResult('2026-02-07', 'TEST1-4days');
  const r2 = await calculateAndGetResult('2026-02-11', 'TEST2-6days');
  const r3 = await calculateAndGetResult('2026-02-13', 'TEST3-8days');
  const r4 = await calculateAndGetResult('2026-02-07', 'TEST4-4days-again');

  console.log('\n========================================');
  console.log('RESULTS:');
  console.log('  Test 1 (4 days):', r1);
  console.log('  Test 2 (6 days):', r2);
  console.log('  Test 3 (8 days):', r3);
  console.log('  Test 4 (4 days):', r4);
  console.log('\nEXPECTED:');
  console.log('  4 days: ~367.500L');
  console.log('  6 days: ~560.000L');
  console.log('  8 days: ~735.000L');
  console.log('========================================');

  const allDifferent = r1 !== r2 && r2 !== r3;
  const r1EqualsR4 = r1 === r4;

  if (allDifferent && r1EqualsR4) {
    console.log('\n✅ TEST PASSED - No caching bug!');
  } else if (!allDifferent) {
    console.log('\n❌ CACHING BUG - Same result for different dates!');
  } else if (!r1EqualsR4) {
    console.log('\n⚠️ INCONSISTENT - Same dates gave different results!');
  }

  await page.waitForTimeout(2000);
  await browser.close();
}

testCalculateMax().catch(console.error);
