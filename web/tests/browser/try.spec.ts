import { expect, test } from '@playwright/test';

const id = 'a'.repeat(32);
const supported = [
  'trossen-wxai',
  'trossen-wxai-whack',
  'trossen-workbench',
  'trossen-workbench-whack',
];
const simulations = [...supported, 'unsupported'].map((id) => ({
  id,
  available: true,
  summary: `Run ${id}`,
  icon: 'robot',
  duration_seconds: 7,
}));

test('try shows only supported scenes and a failed launch retry reuses its request ID', async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route('**/api/demo/simulations', (route) =>
    route.fulfill({ json: { enabled: true, simulations } }),
  );
  await page.route('**/api/demo/sessions', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: [] });
    requests.push(route.request().postDataJSON().request_id);
    return route.fulfill({ status: 503, json: { error: 'Service unavailable. Retry launch.' } });
  });
  await page.goto('/try');
  await expect(page.locator('.demo-sim-card')).toHaveCount(4);
  for (const [index, name] of ['wxai', 'wxai whack', 'workbench', 'workbench whack'].entries()) {
    const card = page.locator(`[data-simulation-id="${supported[index]}"]`);
    await expect(card.locator('strong')).toHaveText(name);
    await expect
      .poll(() => card.locator('img').evaluate((image) => (image as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
  }
  await expect(
    page.getByText('Each new session lasts 7 seconds from ready.', { exact: false }),
  ).toBeVisible();
  const card = page.locator('[data-simulation-id="trossen-wxai"]');
  await card.click();
  await expect(page.locator('.demo-error[role=alert]')).toContainText('Retry launch');
  await card.click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[0]).toBe(requests[1]);
  await page.getByRole('link', { name: 'Open direct robot workspace' }).click();
  await expect(page).toHaveURL(/\/workspace$/);
});

test('launch opens the managed workspace when ready and completed sessions offer another launch', async ({
  page,
}) => {
  let launched = false,
    ready = false;
  const run = () => ({
    id,
    simulation_id: supported[0],
    state: ready ? 'ready' : 'starting',
    created_at: Date.now(),
    expires_at: Date.now() + 7000,
  });
  await page.route('**/api/demo/simulations', (route) =>
    route.fulfill({ json: { enabled: true, simulations } }),
  );
  await page.route('**/api/demo/sessions', (route) => {
    if (route.request().method() === 'POST') {
      launched = true;
      setTimeout(() => {
        ready = true;
      }, 100);
      return route.fulfill({ json: run() });
    }
    return route.fulfill({ json: launched ? [run()] : [] });
  });
  await page.route(`**/api/demo/sessions/${id}`, (route) =>
    route.fulfill({ json: { ...run(), state: 'expired' } }),
  );
  await page.goto('/try');
  await page.locator('[data-simulation-id="trossen-wxai"]').click();
  await expect(page).toHaveURL(`/workspace?session=${id}`);
  await expect(page.getByRole('heading', { name: 'Session ended', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Return to simulations' })).toHaveAttribute(
    'href',
    '/try',
  );
});

test('direct discovery never requests the trial service', async ({ page }) => {
  const trialRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/demo/')) trialRequests.push(request.url());
  });
  await page.goto('/?fixture=1');
  await expect(page.locator('.connection-badge')).toContainText('ready');
  expect(trialRequests).toEqual([]);
  await expect(page.getByRole('link', { name: 'Try a simulation' })).toHaveAttribute(
    'href',
    '/try',
  );
});

test('managed startup failure is distinct from normal completion', async ({ page }) => {
  await page.route(`**/api/demo/sessions/${id}`, (route) =>
    route.fulfill({
      json: {
        id,
        simulation_id: supported[0],
        state: 'stopping',
        reason: 'Simulation execution failed.',
      },
    }),
  );
  await page.goto(`/workspace?session=${id}`);
  await expect(page.getByRole('heading', { name: 'Simulation failed', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Simulation execution failed.');
});

test('queued trial shows position and ETA, survives reload, and opens when admitted', async ({
  page,
}) => {
  let launches = 0;
  let state = 'queued';
  let position = 3;
  const messages: string[] = [];
  page.on('console', (message) => messages.push(message.text()));
  const run = () => ({
    id,
    simulation_id: supported[0],
    state,
    created_at: Date.now(),
    queue_position: state === 'queued' ? position : null,
    queue_length: 5,
    estimated_wait_seconds: position === 3 ? 90 : 10,
  });
  await page.route('**/api/demo/simulations', (route) =>
    route.fulfill({ json: { enabled: true, simulations } }),
  );
  await page.route('**/api/demo/sessions', (route) => {
    if (route.request().method() === 'POST') {
      launches += 1;
      return route.fulfill({ json: run(), status: 202 });
    }
    return route.fulfill({ json: launches ? [run()] : [] });
  });
  await page.route(`**/api/demo/sessions/${id}`, (route) =>
    route.fulfill({ json: { ...run(), state: 'expired' } }),
  );
  await page.goto('/try');
  await page.locator('[data-simulation-id="trossen-wxai"]').click();
  await expect(page.locator('.demo-run [role=status]')).toContainText('Queued · position 3 of 5');
  await expect(page.locator('.demo-queue-estimate')).toContainText('about 2 minutes');
  await page.reload();
  await expect(page.locator('.demo-run [role=status]')).toContainText('position 3');
  expect(launches).toBe(1);
  position = 1;
  await expect(page.locator('.demo-run [role=status]')).toContainText('position 1');
  await expect(page.locator('.demo-queue-estimate')).toContainText('about 10 seconds');
  expect(messages.some((message) => message.includes(`session=${id} queued position=1`))).toBe(
    true,
  );
  state = 'ready';
  await expect(page).toHaveURL(`/workspace?session=${id}`);
});

test('visitor can leave the queue without starting a simulation', async ({ page }) => {
  let state = 'queued',
    canceled = false;
  const run = () => ({
    id,
    state,
    simulation_id: supported[0],
    created_at: Date.now(),
    queue_position: 1,
    queue_length: 1,
    estimated_wait_seconds: 30,
  });
  await page.route('**/api/demo/simulations', (route) =>
    route.fulfill({ json: { enabled: true, simulations } }),
  );
  await page.route('**/api/demo/sessions', (route) => route.fulfill({ json: [run()] }));
  await page.route(`**/api/demo/sessions/${id}`, (route) => {
    expect(route.request().method()).toBe('DELETE');
    canceled = true;
    state = 'stopped';
    return route.fulfill({ json: run() });
  });
  await page.goto('/try');
  await page.getByRole('button', { name: 'Leave queue for wxai', exact: true }).click();
  await expect(page.locator('.demo-run [role=status]')).toContainText('stopped');
  expect(canceled).toBe(true);
  await expect(page).toHaveURL('/try');
});
