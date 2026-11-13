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

test('thumbnail images load before the simulation catalog responds', async ({ page }) => {
  let releaseCatalog!: () => void;
  const pending = new Promise<void>((resolve) => {
    releaseCatalog = resolve;
  });
  await page.route('**/api/demo/simulations', async (route) => {
    await pending;
    await route.fulfill({ json: { enabled: true, simulations } });
  });
  try {
    const response = await page.goto('/try');
    expect(await response!.text()).toMatch(/<img[^>]*alt="Formula RC"/);
    await expect(page.locator('.demo-sim-photo img')).toHaveCount(7);
    await expect
      .poll(() =>
        page
          .getByRole('img', { name: 'Formula RC', exact: true })
          .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
      )
      .toBe(true);
    await expect(page.getByRole('button', { name: 'Watch wxai', exact: true })).toBeDisabled();
    releaseCatalog();
    await expect(page.getByRole('button', { name: 'Watch wxai', exact: true })).toBeEnabled();
    await expect(page.locator('.demo-sim-card')).toHaveCount(2);
  } finally {
    releaseCatalog();
  }
});

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

test('Watch waits for the simulation and opens the teleop page for its robot', async ({
  page,
}) => {
  await page.route('**/api/demo/simulations', (route) =>
    route.fulfill({ json: { enabled: true, simulations } }),
  );
  await page.route('**/api/credentials', (route) => route.abort());
  let starts = 0;
  let polls = 0;
  await page.route('**/api/demo/simulations/trossen-wxai/watch', (route) => {
    starts++;
    return route.fulfill({
      json: { id, simulation_id: 'trossen-wxai', state: 'starting' },
    });
  });
  await page.route('**/api/demo/instances/' + id, (route) =>
    route.fulfill({
      json: {
        id,
        simulation_id: 'trossen-wxai',
        state: ++polls < 2 ? 'starting' : 'ready',
        robot_identity: 'sim-wxai',
      },
    }),
  );
  await page.goto('/try');
  await page.getByRole('button', { name: 'Watch wxai', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Starting…' })).toBeVisible();
  await expect(page).toHaveURL('/?robot=sim-wxai');
  expect(starts).toBe(1);
});

test('Watch skips the start request when the simulation is already ready', async ({ page }) => {
  let starts = 0;
  await page.route('**/api/demo/simulations', (route) =>
    route.fulfill({
      json: {
        enabled: true,
        simulations: simulations.map((item) =>
          item.id === 'vacuum'
            ? {
                ...item,
                instance: {
                  id,
                  simulation_id: 'vacuum',
                  state: 'ready',
                  robot_identity: 'sim-vacuum',
                },
              }
            : item,
        ),
      },
    }),
  );
  await page.route('**/api/credentials', (route) => route.abort());
  await page.route('**/api/demo/simulations/vacuum/watch', (route) => {
    starts++;
    return route.abort();
  });
  await page.goto('/try');
  await page.getByRole('button', { name: 'Watch Vacuum robot', exact: true }).click();
  await expect(page).toHaveURL('/?robot=sim-vacuum');
  expect(starts).toBe(0);
});

test('catalog shows startup failure reason instead of a silent stop', async ({ page }) => {
  await page.route('**/api/demo/simulations', (route) =>
    route.fulfill({
      json: {
        enabled: true,
        simulations: simulations.map((item) =>
          item.id === 'trossen-wxai'
            ? {
                ...item,
                instance: {
                  id,
                  simulation_id: 'trossen-wxai',
                  state: 'stopping',
                  reason: 'Simulation startup timed out.',
                },
              }
            : item,
        ),
      },
    }),
  );
  await page.goto('/try');
  await expect(
    page.locator('[data-simulation-id="trossen-wxai"] [role="status"]'),
  ).toContainText('Simulation startup timed out.');
});

test('startup errors remain visible without creating another instance', async ({ page }) => {
  let watches = 0;
  await page.route('**/api/demo/instances/' + id, (route) =>
    route.fulfill({
      json: { id, state: 'failed', reason: 'Simulation startup timed out.' },
    }),
  );
  await page.route('**/api/demo/simulations/**/watch', (route) => {
    watches++;
    return route.fulfill({ status: 503, json: { error: 'should not restart' } });
  });
  await page.goto('/workspace?session=' + id);
  await expect(page.getByRole('heading', { name: 'Viewing ended' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Simulation startup timed out.');
  await expect(page.getByRole('link', { name: 'Return to simulations' })).toHaveAttribute(
    'href',
    '/try',
  );
  await expect(page.getByRole('button', { name: 'Continue watching' })).toHaveCount(0);
  expect(watches).toBe(0);
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
