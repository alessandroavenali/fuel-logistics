import { chromium } from 'playwright';

const URL = 'https://fuel.flipr.cloud/schedules';

async function testCalculateMax() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log('Navigating to', URL);
  await page.goto(URL);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Click "Nuova Pianificazione" button
  console.log('\n=== Opening create schedule dialog ===');
  await page.click('button:has-text("Nuova Pianificazione")');
  await page.waitForTimeout(1000);

  // Fill name
  await page.fill('input[name="name"]', 'Test Cache Bug');

  // Click first "Tutti" to select all drivers for first day
  console.log('Selecting all drivers (clicking Tutti buttons)...');
  const tuttiButtons = page.locator('button:has-text("Tutti")');
  const count = await tuttiButtons.count();
  console.log(`Found ${count} "Tutti" buttons`);
  // Click first Tutti button to select all drivers
  await tuttiButtons.first().click();
  await page.waitForTimeout(500);

  // Function to run calculate max and get result
  async function calculateAndGetResult(startDate, endDate, testName) {
    console.log(`\n=== ${testName} ===`);

    // Set dates
    await page.fill('input[name="startDate"]', startDate);
    await page.waitForTimeout(200);
    await page.fill('input[name="endDate"]', endDate);
    await page.waitForTimeout(500);

    // Click MAX button
    await page.click('button:has-text("MAX")');
    await page.waitForTimeout(5000);

    // Look for result in any visible text containing L
    let result = 'Not found';
    try {
      // Look for the max liters result - usually large number with L
      const resultText = await page.locator('text=/\\d{3},?\\d{3}.*L/').first().textContent({ timeout: 3000 });
      result = resultText;
    } catch (e) {
      // Try to find any prominent number
      try {
        const dialog = page.locator('[role="dialog"], .modal, [data-state="open"]').first();
        const text = await dialog.textContent();
        const match = text.match(/(\d{3}[,.]?\d{3})\s*L/);
        if (match) {
          result = match[0];
        }
      } catch (e2) {
        console.log('Could not find result');
      }
    }
    console.log(`Result: ${result}`);

    // Close dialog by pressing Escape or clicking Annulla
    try {
      await page.click('button:has-text("Annulla")', { timeout: 2000 });
    } catch (e) {
      await page.keyboard.press('Escape');
    }
    await page.waitForTimeout(500);

    return result;
  }

  // Run tests
  const r1 = await calculateAndGetResult('2026-02-04', '2026-02-07', 'TEST 1: Feb 4-7 (4 days)');
  const r2 = await calculateAndGetResult('2026-02-04', '2026-02-11', 'TEST 2: Feb 4-11 (6 days)');
  const r3 = await calculateAndGetResult('2026-02-04', '2026-02-13', 'TEST 3: Feb 4-13 (8 days)');
  const r4 = await calculateAndGetResult('2026-02-04', '2026-02-07', 'TEST 4: Feb 4-7 again');

  console.log('\n========== SUMMARY ==========');
  console.log('Test 1 (4 days):', r1);
  console.log('Test 2 (6 days):', r2);
  console.log('Test 3 (8 days):', r3);
  console.log('Test 4 (4 days again):', r4);
  console.log('\nExpected: ~367kL, ~560kL, ~735kL, ~367kL');

  if (r1 !== r4) {
    console.log('\n*** CACHING BUG CONFIRMED! Test 1 != Test 4 ***');
  } else {
    console.log('\nNo caching bug detected (Test 1 == Test 4)');
  }

  await browser.close();
}

testCalculateMax().catch(console.error);
