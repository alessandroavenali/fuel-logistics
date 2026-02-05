import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5174';

test('UI MAX flow shows progress and result', async ({ page }) => {
  await page.goto(`${BASE}/schedules`);

  await page.getByRole('button', { name: 'Nuova Pianificazione' }).click();

  await page.getByLabel('Data Inizio').fill('2026-02-04');
  await page.getByLabel('Data Fine').fill('2026-02-06');

  // Select all days for the first three drivers (if present)
  const tuttiButtons = page.getByRole('button', { name: 'Tutti' });
  const count = await tuttiButtons.count();
  for (let i = 0; i < Math.min(3, count); i++) {
    await tuttiButtons.nth(i).click();
  }

  await page.getByRole('button', { name: 'MAX' }).click();

  const progress = page.getByText('Calcolo MAX in corso');
  const resultTitle = page.getByText('Capacità Massima Calcolata');

  await Promise.race([
    progress.waitFor({ state: 'visible', timeout: 15000 }),
    resultTitle.waitFor({ state: 'visible', timeout: 15000 }),
  ]);

  if (await progress.isVisible()) {
    const stopButton = page.getByRole('button', { name: 'Ferma qui' });
    if (await stopButton.isVisible()) {
      await stopButton.click();
    }
  }

  await expect(resultTitle).toBeVisible({ timeout: 60000 });

  // Close preview dialog
  await page.getByRole('button', { name: 'Annulla' }).click();
});
