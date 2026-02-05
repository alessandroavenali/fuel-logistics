import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5174';
const API = process.env.PLAYWRIGHT_API_BASE || `${BASE.replace(/\/$/, '')}/api`;

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  expect(res.ok).toBeTruthy();
  return res.json() as Promise<T>;
}

async function apiPost<T>(path: string, body: any): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(res.ok).toBeTruthy();
  return res.json() as Promise<T>;
}

test('MAX job shows progress and completes', async ({ page }) => {
  const drivers = await apiGet<any[]>('/drivers?isActive=true');
  const byName = Object.fromEntries(drivers.map(d => [d.name, d.id]));

  const payload = {
    startDate: '2026-02-04T00:00:00.000Z',
    endDate: '2026-02-06T23:59:59.999Z',
    includeWeekend: false,
    driverAvailability: [
      { driverId: byName['Marco Bianchi'], availableDates: ['2026-02-04', '2026-02-05', '2026-02-06'] },
      { driverId: byName['Luca Rossi'], availableDates: ['2026-02-04', '2026-02-05', '2026-02-06'] },
      { driverId: byName['Paolo Verdi'], availableDates: ['2026-02-04', '2026-02-05', '2026-02-06'] },
    ],
    timeLimitSeconds: 60,
  };

  await page.goto(`${BASE}/schedules`);

  const job = await apiPost<{ jobId: string }>('/schedules/calculate-max/jobs', payload);
  let status: any = null;
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(1000);
    status = await apiGet<any>(`/schedules/calculate-max/jobs/${job.jobId}`);
    if (status.progress) break;
  }
  expect(status?.progress?.objective_liters).toBeGreaterThan(0);

  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(1000);
    status = await apiGet<any>(`/schedules/calculate-max/jobs/${job.jobId}`);
    if (status.status === 'COMPLETED') break;
  }
  expect(status?.result?.maxLiters).toBeGreaterThan(0);
});
