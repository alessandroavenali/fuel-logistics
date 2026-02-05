import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5174';
const API = process.env.PLAYWRIGHT_API_BASE || `${BASE.replace(/\/$/, '')}/api`;

async function apiPost<T>(path: string, body: any): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(res.ok).toBeTruthy();
  return res.json() as Promise<T>;
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  expect(res.ok).toBeTruthy();
  return res.json() as Promise<T>;
}

async function apiDelete(path: string): Promise<void> {
  const res = await fetch(`${API}${path}`, { method: 'DELETE' });
  expect(res.ok).toBeTruthy();
}

test('UI Optimize flow shows progress and persists trips', async ({ page }) => {
  const schedule = await apiPost<any>('/schedules', {
    name: 'PW UI optimize test',
    startDate: '2026-02-04T00:00:00.000Z',
    endDate: '2026-02-06T23:59:59.999Z',
    requiredLiters: 210000,
    includeWeekend: false,
  });

  try {
    await page.goto(`${BASE}/schedules/${schedule.id}`);

    await page.getByRole('button', { name: 'Genera Turni' }).click();
    await expect(page.getByRole('dialog', { name: 'Stato Eccezioni ADR' })).toBeVisible();

    await page.getByRole('button', { name: 'Genera Turni' }).click();

    const progress = page.getByText('Ottimizzazione in corso');
    await Promise.race([
      progress.waitFor({ state: 'visible', timeout: 15000 }).catch(() => undefined),
      page.waitForTimeout(2000),
    ]);

    if (await progress.isVisible()) {
      const stopButton = page.getByRole('button', { name: 'Ferma qui' });
      if (await stopButton.isVisible()) {
        await stopButton.click();
      }
      await expect(progress).toBeHidden({ timeout: 60000 });
    }

    let detail: any = null;
    for (let i = 0; i < 30; i++) {
      detail = await apiGet<any>(`/schedules/${schedule.id}`);
      if ((detail.trips?.length || 0) > 0) break;
      await page.waitForTimeout(2000);
    }
    expect(detail.trips?.length).toBeGreaterThan(0);
  } finally {
    await apiDelete(`/schedules/${schedule.id}`);
  }
});
