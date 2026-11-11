import { expect, test } from '@playwright/test';

const id = 'a'.repeat(32);
const simulations = ['trossen-wxai', 'vacuum', 'unsupported'].map((id) => ({
  id,
  available: true,
  summary: 'Shared ' + id,
  icon: 'robot',
  turn_seconds: 60,
  idle_seconds: 120,
}));

test('the catalog does not start workers and retries Watch safely', async ({ page }) => {
  let starts = 0;
  await page.route('**/api/demo/simulations', (route) =>
    route.fulfill({ json: { enabled: true, simulations } }),
  );
  await page.route('**/api/demo/simulations/trossen-wxai/watch', (route) => {
    starts++;
    return route.fulfill({ status: 503, json: { error: 'Service unavailable. Retry Watch.' } });
  });
  await page.goto('/try');
  await expect(page.locator('.demo-sim-card')).toHaveCount(2);
  await expect(page.getByText('Turns last 60 seconds.', { exact: false })).toBeVisible();
  expect(starts).toBe(0);
  await page.getByRole('button', { name: 'Watch wxai', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Retry Watch' })).toBeVisible();
  await page.getByRole('button', { name: 'Watch wxai', exact: true }).click();
  await expect.poll(() => starts).toBe(2);
  await expect(page.getByRole('button', { name: /Stop simulation/ })).toHaveCount(0);
});

test('Watch opens the shared instance and stopped worlds require deliberate continuation', async ({
  page,
}) => {
  await page.route('**/api/demo/simulations', (route) =>
    route.fulfill({ json: { enabled: true, simulations } }),
  );
  let starts = 0;
  const replacement = 'b'.repeat(32);
  await page.route('**/api/demo/simulations/trossen-wxai/watch', (route) => {
    starts++;
    return route.fulfill({
      json: {
        id: starts === 1 ? id : replacement,
        simulation_id: 'trossen-wxai',
        state: 'starting',
      },
    });
  });
  await page.route('**/api/demo/instances/' + replacement, (route) =>
    route.fulfill({ json: { id: replacement, simulation_id: 'trossen-wxai', state: 'starting' } }),
  );
  await page.route('**/api/demo/instances/' + id, (route) =>
    route.fulfill({
      json: {
        id,
        simulation_id: 'trossen-wxai',
        state: 'expired',
        reason: 'Simulation paused due to inactivity.',
      },
    }),
  );
  await page.goto('/try');
  await page.getByRole('button', { name: 'Watch wxai', exact: true }).click();
  await expect(page).toHaveURL('/workspace?session=' + id);
  await expect(page.getByRole('heading', { name: 'Viewing ended' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('inactivity');
  await expect(page.getByRole('button', { name: 'Continue watching' })).toBeVisible();
  expect(starts).toBe(1);
  await page.getByRole('button', { name: 'Continue watching' }).click();
  await expect(page).toHaveURL('/workspace?session=' + replacement);
  expect(starts).toBe(2);
});

test('startup errors remain visible without creating another instance', async ({ page }) => {
  await page.route('**/api/demo/instances/' + id, (route) =>
    route.fulfill({ json: { id, state: 'failed', reason: 'Simulation execution failed.' } }),
  );
  await page.goto('/workspace?session=' + id);
  await expect(page.getByRole('status')).toContainText('Simulation execution failed.');
  await expect(page.getByRole('link', { name: 'Return to simulations' })).toHaveAttribute(
    'href',
    '/try',
  );
});

test('direct discovery never requests the simulation service', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/demo/')) requests.push(request.url());
  });
  await page.goto('/?fixture=1');
  await expect(page.locator('.connection-badge')).toContainText('ready');
  expect(requests).toEqual([]);
});
