import { test, expect } from '@playwright/test';

test.skip(
  process.env.TELEOP_DEMO_E2E !== '1',
  'Requires scripts/demo-local.py and native simulation assets.',
);

for (const simulation of [
  'trossen-wxai',
  'trossen-wxai-whack',
  'trossen-workbench',
  'trossen-workbench-whack',
]) {
  test(`${simulation}: automatic workspace, video, control, ownership and fixed expiry`, async ({
    page,
    browser,
  }) => {
    test.setTimeout(110_000);
    page.setDefaultTimeout(10000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/try');
    await expect(page.getByRole('heading', { name: 'Try a simulation' })).toBeVisible();
    const first = page.locator(`[data-simulation-id="${simulation}"]`);
    await expect(first).toBeEnabled();
    await first.click();
    await expect(page).toHaveURL(/\/workspace\?session=[a-f0-9]{32}/, { timeout: 60_000 });
    const id = new URL(page.url()).searchParams.get('session')!;
    const run = await (await page.request.get(`/api/demo/sessions/${id}`)).json();
    await expect
      .poll(
        () =>
          page
            .locator('video')
            .evaluateAll((videos) =>
              videos.some((video) => (video as HTMLVideoElement).videoWidth > 0),
            ),
        { timeout: 15_000 },
      )
      .toBe(true);
    const stranger = await browser.newContext();
    try {
      const denied = await stranger.request.get(
        new URL(`/api/demo/sessions/${id}`, page.url()).href,
      );
      expect(denied.status()).toBe(404);
    } finally {
      await stranger.close();
    }
    await expect(page.locator('.connection-badge')).toContainText('ready', { timeout: 15_000 });
    await page.getByRole('button', { name: /Add visualization/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox', { name: 'Visualization', exact: true }).selectOption('raw');
    const topics = await dialog
      .getByRole('combobox', { name: 'Topic', exact: true })
      .locator('option')
      .evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value));
    const feedback = (topics.find((topic) => topic.endsWith('/left_arm/joint_states')) ??
      topics.find((topic) => topic.endsWith('/joint_states')))!;
    expect(feedback).toBeTruthy();
    await dialog.getByRole('combobox', { name: 'Topic', exact: true }).selectOption(feedback);
    await dialog.getByLabel('Panel title').fill('Measured simulation joints');
    await dialog.getByRole('button', { name: 'Add panel', exact: true }).click();
    const raw = page.locator('.raw-message');
    await expect(raw).toContainText('position');
    await page.getByRole('tab', { name: 'Controls', exact: true }).click();
    await page.getByRole('button', { name: 'Request control', exact: true }).click();
    const arm = page.getByRole('button', { name: 'Arm input', exact: true }).first();
    await expect(arm).toBeEnabled();
    await arm.click();
    const slider = page.locator('.joint-controls input[type="range"]').first();
    await expect(slider).toBeEnabled();
    const name = (await slider.getAttribute('aria-label'))!.replace(/ position$/, '');
    const position = async () => {
      const state = JSON.parse(await raw.innerText());
      const index = state.name.indexOf(name);
      expect(index).toBeGreaterThanOrEqual(0);
      return state.position[index] as number;
    };
    const initial = await position();
    await slider.fill(String(initial + 0.2));
    await expect.poll(position, { timeout: 8000 }).toBeGreaterThan(initial + 0.04);
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
}

test('second registry entry starts independently and can stop from the landing page', async ({
  page,
}) => {
  test.setTimeout(65_000);
  await page.goto('/try');
  await expect(page.locator('[data-simulation-id="trossen-workbench"]')).toBeEnabled();
  await page.evaluate(async () => {
    const response = await fetch('/api/demo/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ simulation_id: 'trossen-workbench', request_id: crypto.randomUUID() }),
    });
    if (!response.ok) throw new Error(await response.text());
  });
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
  await card.getByRole('button', { name: 'Stop workbench', exact: true }).click();
  await expect(card.getByRole('status')).toContainText('stopped', { timeout: 12_000 });
});

test('real queue advances between independent browsers after an early stop', async ({
  page,
  browser,
}) => {
  test.skip(process.env.TELEOP_QUEUE_E2E !== '1', 'requires SIM_SESSION_CAPACITY=1');
  test.setTimeout(90_000);
  const context = await browser.newContext();
  const waiting = await context.newPage();
  try {
    await page.goto('/try');
    await page.locator('[data-simulation-id="trossen-wxai"]').click();
    await expect(page).toHaveURL(/\/workspace\?session=/, { timeout: 50000 });
    const first = new URL(page.url()).searchParams.get('session')!;
    await waiting.goto('/try');
    await waiting.locator('[data-simulation-id="trossen-workbench"]').click();
    await expect(waiting.locator('.demo-run [role=status]')).toContainText('Queued · position 1', {
      timeout: 10000,
    });
    await expect(waiting.locator('.demo-queue-estimate')).toContainText('Estimated wait');
    const second = (await waiting.locator('.demo-run').getAttribute('data-run-id'))!;
    expect(second).not.toBe(first);
    await waiting.reload();
    await expect(waiting.locator('.demo-run [role=status]')).toContainText('position 1');
    await page.getByRole('button', { name: 'Stop simulation', exact: true }).click();
    await expect(waiting).toHaveURL(`/workspace?session=${second}`, { timeout: 50000 });
    await expect(waiting.locator('.connection-badge')).toContainText('ready', { timeout: 15000 });
    await waiting.getByRole('button', { name: 'Stop simulation', exact: true }).click();
    await expect(waiting).toHaveURL('/try');
    await expect
      .poll(
        async () =>
          (await (await waiting.request.get(`/api/demo/sessions/${second}`)).json()).state,
        { timeout: 15000 },
      )
      .toBe('stopped');
  } finally {
    await context.close();
  }
});
