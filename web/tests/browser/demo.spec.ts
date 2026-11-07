import { test, expect } from '@playwright/test';

test.skip(
  process.env.TELEOP_DEMO_E2E !== '1',
  'Requires scripts/demo-local.py and native simulation assets.',
);

test('landing launch, video preview, discovered control, owner isolation and fixed expiry', async ({
  page,
  browser,
}) => {
  test.setTimeout(110_000);
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Try a simulation' })).toBeVisible();
  const first = page.locator('.demo-sim-card').filter({ hasText: 'trossen-wxai' });
  await expect(first).toBeEnabled();
  await first.click();
  const card = page.locator('.demo-run').first();
  await expect(card.getByRole('link', { name: 'Open control' })).toBeVisible({ timeout: 50_000 });
  const id = await card.getAttribute('data-run-id');
  const run = await (await page.request.get(`/api/demo/sessions/${id}`)).json();
  await card.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect
    .poll(
      async () =>
        page
          .locator('.demo-preview video')
          .evaluateAll((videos) =>
            videos.some((video) => (video as HTMLVideoElement).videoWidth > 0),
          ),
      { timeout: 15_000 },
    )
    .toBe(true);
  await expect(page.getByRole('button', { name: 'Request control', exact: true })).toHaveCount(0);
  const stranger = await browser.newContext();
  try {
    const denied = await stranger.request.get(new URL(`/api/demo/sessions/${id}`, page.url()).href);
    expect(denied.status()).toBe(404);
  } finally {
    await stranger.close();
  }
  await card.getByRole('link', { name: 'Open control' }).click();
  await expect(page.locator('.connection-badge')).toContainText('ready', { timeout: 15_000 });
  await page.getByRole('button', { name: /Add visualization/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Visualization', exact: true }).selectOption('raw');
  const topics = await dialog
    .getByRole('combobox', { name: 'Topic', exact: true })
    .locator('option')
    .evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value));
  const feedback = topics.find((topic) => topic.endsWith('/joint_states'))!;
  expect(feedback).toBeTruthy();
  await dialog.getByRole('combobox', { name: 'Topic', exact: true }).selectOption(feedback);
  await dialog.getByLabel('Panel title').fill('Measured simulation joints');
  await dialog.getByRole('button', { name: 'Add panel', exact: true }).click();
  const raw = page.locator('.raw-message');
  await expect(raw).toContainText('position');
  const initial = JSON.parse(await raw.innerText()).position[0] as number;
  await page.getByRole('tab', { name: 'Controls', exact: true }).click();
  await page.getByRole('button', { name: 'Request control', exact: true }).click();
  const arm = page.getByRole('button', { name: 'Arm input', exact: true }).first();
  await expect(arm).toBeEnabled();
  await arm.click();
  const slider = page.locator('.joint-controls input[type="range"]').first();
  await expect(slider).toBeEnabled();
  await slider.fill(String(initial + 0.2));
  await expect
    .poll(async () => JSON.parse(await raw.innerText()).position[0] as number, { timeout: 8000 })
    .toBeGreaterThan(initial + 0.04);
  await page.reload();
  await expect(page.locator('.connection-badge')).toContainText('ready', { timeout: 12_000 });
  expect((await (await page.request.get(`/api/demo/sessions/${id}`)).json()).expires_at).toBe(
    run.expires_at,
  );
  await expect(page.locator('.control-card').first()).toContainText('Disarmed');
  await expect(page.getByRole('heading', { name: 'Session ended', exact: true })).toBeVisible({
    timeout: 65_000,
  });
  await expect
    .poll(async () => (await (await page.request.get(`/api/demo/sessions/${id}`)).json()).state, {
      timeout: 12_000,
    })
    .toBe('expired');
  expect(errors).toEqual([]);
});

test('second registry entry starts independently and can stop from the landing page', async ({
  page,
}) => {
  test.setTimeout(65_000);
  await page.goto('/');
  await page.locator('.demo-sim-card').filter({ hasText: 'trossen-workbench' }).click();
  const card = page.locator('.demo-run').first();
  await expect(card.getByRole('link', { name: 'Open control' })).toBeVisible({ timeout: 50_000 });
  await card.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect
    .poll(
      async () =>
        page
          .locator('.demo-preview video')
          .evaluateAll((videos) =>
            videos.some((video) => (video as HTMLVideoElement).videoWidth > 0),
          ),
      { timeout: 12_000 },
    )
    .toBe(true);
  await card.getByRole('button', { name: 'Stop trossen-workbench' }).click();
  await expect(card.getByRole('status')).toContainText('stopped', { timeout: 12_000 });
});
