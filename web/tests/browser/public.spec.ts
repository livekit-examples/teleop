import { expect, test } from '@playwright/test';

test.skip(
  process.env.TELEOP_PUBLIC_E2E !== '1',
  'Requires TELEOP_PUBLIC_DEPLOYMENT=1 on the website.',
);

test('public entry points show the simulation catalog without direct robot credentials', async ({
  page,
}) => {
  const credentials: string[] = [];
  const starts: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/credentials')) credentials.push(request.url());
    if (request.url().endsWith('/watch')) starts.push(request.url());
  });
  await page.route('**/api/demo/simulations', (route) =>
    route.fulfill({ json: { enabled: true, simulations: [] } }),
  );
  for (const entry of ['/', '/workspace']) {
    await page.goto(entry);
    await expect(page).toHaveURL('/try');
    await expect(page.getByRole('heading', { name: 'Try a simulation' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open direct robot workspace' })).toHaveCount(0);
  }
  expect(credentials).toEqual([]);
  expect(starts).toEqual([]);
});

test('public simulation workspace links remain available', async ({ page }) => {
  const id = 'a'.repeat(32);
  await page.route('**/api/demo/instances/' + id, (route) =>
    route.fulfill({
      json: {
        id,
        simulation_id: 'vacuum',
        state: 'expired',
        reason: 'Simulation paused due to inactivity.',
      },
    }),
  );
  await page.goto('/workspace?session=' + id);
  await expect(page).toHaveURL('/workspace?session=' + id);
  await expect(page.getByRole('heading', { name: 'Viewing ended' })).toBeVisible();
});
