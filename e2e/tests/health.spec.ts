import { API_BASE_URL, expect, test } from '../fixtures';

test('the API /health really asks Postgres and Redis', async ({ request }) => {
  const response = await request.get(`${API_BASE_URL}/health`);
  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    status: string;
    service: string;
    checks: Array<{ name: string; status: string }>;
  };
  expect(body.service).toBe('api');
  expect(body.status).toBe('ok');
  expect(body.checks.map((check) => `${check.name}:${check.status}`).sort()).toEqual([
    'postgres:ok',
    'redis:ok',
  ]);
});

test('/status renders the API card with each check', async ({ page }) => {
  await page.goto('/status');
  await expect(page.getByText('All services operational')).toBeVisible();
  const api = page.getByRole('region', { name: 'api' });
  await expect(api.getByRole('rowheader', { name: 'postgres' })).toBeVisible();
  await expect(api.getByRole('rowheader', { name: 'redis' })).toBeVisible();
});
