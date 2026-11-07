import { expect, test, type Page } from '@playwright/test';

async function fixture(page: Page) {
  await page.goto('/workspace?fixture=1');
  await expect(page.locator('.connection-badge')).toContainText('ready');
}
async function add(page: Page, title: string, type = 'raw', topic = '/imu', path = '[]') {
  await page.getByRole('button', { name: 'Add visualization' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Visualization', exact: true }).selectOption(type);
  await dialog.getByRole('combobox', { name: 'Topic', exact: true }).selectOption(topic);
  await dialog.getByLabel('Panel title').fill(title);
  if (type !== 'audio' && type !== 'video')
    await dialog.getByLabel('Literal field path').fill(path);
  await dialog.getByRole('button', { name: 'Add panel', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

test('automatic cameras render live, swap stably and fall back when main is removed', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await fixture(page);
  await expect(page.locator('.camera-main')).toHaveCount(1);
  await expect(page.locator('.camera-tile')).toHaveCount(1);
  const main = await page.locator('.camera-main .camera-caption>span:first-child').innerText();
  const tile = await page.locator('.camera-tile .camera-caption>span:first-child').innerText();
  await page.getByRole('button', { name: `Promote ${tile}` }).click();
  await expect(page.locator('.camera-main .camera-caption')).toContainText(tile);
  await expect(page.locator('.camera-tile .camera-caption')).toContainText(main);
  await expect(page.locator('.camera-main .status')).toContainText('healthy');
  await page.getByRole('button', { name: 'Remove main video' }).click();
  await expect(page.locator('.camera-main .camera-caption')).toContainText(main);
  await expect(page.locator('.camera-notice')).toContainText('unavailable');
  expect(errors).toEqual([]);
});

test('adds scalar/Boolean/raw views of undeclared JSON and previews fields temporarily', async ({
  page,
}) => {
  await fixture(page);
  await page.getByRole('button', { name: 'Add visualization' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Topic', exact: true }).selectOption('/imu');
  await dialog.getByRole('button', { name: 'Preview JSON to find fields' }).click();
  await expect(dialog.locator('.json-preview')).toContainText('angular_velocity');
  await dialog.getByLabel('Compatible field').selectOption('["angular_velocity","z"]');
  await dialog.getByLabel('Panel title').fill('Dynamic yaw');
  await dialog.getByRole('button', { name: 'Add panel', exact: true }).click();
  await expect(page.getByLabel('Dynamic yaw numeric plot')).toBeVisible();
  await add(page, 'Enabled', 'boolean', '/enabled', '["data"]');
  await expect(page.locator('.boolean-value')).toContainText(/TRUE|FALSE/);
  await page.getByRole('button', { name: 'Publish new topic' }).click();
  await add(page, 'New sensor', 'raw', '/new_sensor');
  await expect(page.locator('.raw-message')).toContainText('temperature');
});

test('shares a stream, hides one consumer and restores layout after reload', async ({ page }) => {
  await fixture(page);
  await add(page, 'Raw A');
  await add(page, 'Raw B');
  const panels = page.locator('.visualization-panel');
  await panels
    .filter({ has: page.getByRole('button', { name: 'Settings for Raw B', exact: true }) })
    .getByText('Stream details', { exact: true })
    .click();
  await expect(
    panels.filter({ has: page.getByRole('button', { name: 'Settings for Raw B', exact: true }) }),
  ).toContainText('2 consumers');
  await page.getByRole('button', { name: 'Hide Raw A', exact: true }).click();
  await expect(
    panels.filter({ has: page.getByRole('button', { name: 'Settings for Raw B', exact: true }) }),
  ).toContainText('1 consumers');
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('teleop.layout.v1:fixture-rover') ?? '{}').panel_order
            ?.length,
      ),
    )
    .toBe(2);
  await page.reload();
  await expect(page.locator('.connection-badge')).toContainText('ready');
  await expect(page.getByRole('button', { name: 'Settings for Raw B', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Settings for Raw A', exact: true }),
  ).not.toBeVisible();
  await expect(page.locator('.raw-message')).toContainText('angular_velocity');
});

test('moves/floats/resizes a panel and exports/imports the same remembered configuration', async ({
  page,
}) => {
  await fixture(page);
  await add(page, 'Portable raw');
  await page.getByLabel('Move Portable raw', { exact: true }).selectOption('float');
  const floating = page.getByRole('dialog', { name: 'Portable raw', exact: true });
  await expect(floating).toBeVisible();
  const bounds = (await floating.boundingBox())!;
  const handle = (await floating.locator('.dv-resize-handle-bottomright').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width + 70, bounds.y + bounds.height + 50, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => (await floating.boundingBox())?.width)
    .toBeGreaterThan(bounds.width);
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('teleop.layout.v1:fixture-rover') ?? '{}').workspace
            ?.floating?.length,
      ),
    )
    .toBe(1);
  const saved = await page.evaluate(() => localStorage.getItem('teleop.layout.v1:fixture-rover')!);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export layout' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.json$/);
  await page.getByRole('button', { name: 'Reset layout' }).click();
  await expect(page.getByRole('button', { name: 'Settings for Portable raw' })).not.toBeVisible();
  await page.getByLabel('Import layout JSON').setInputFiles({
    name: 'layout.json',
    mimeType: 'application/json',
    buffer: Buffer.from(saved),
  });
  await expect(page.getByRole('button', { name: 'Settings for Portable raw' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Portable raw', exact: true })).toBeVisible();
  await page.getByLabel('Import layout JSON').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"layout_schema_version":99}'),
  });
  await expect(page.locator('.workspace-alert')).toContainText('Unsupported layout');
  await expect(page.getByRole('button', { name: 'Settings for Portable raw' })).toBeVisible();
  await expect(page.locator('.fixture-toolbar')).toContainText('0 command frames');
});

test('control modes remain visible, switching stops old input and reconnect never rearms', async ({
  page,
}) => {
  await fixture(page);
  await page.getByRole('tab', { name: 'Controls', exact: true }).click();
  await page.getByRole('button', { name: 'Request control', exact: true }).click();
  const base = page.locator('#control-base');
  await expect(base.getByRole('button', { name: 'Arm input', exact: true })).toBeEnabled();
  await base.getByRole('button', { name: 'Arm input', exact: true }).click();
  await expect(base.getByRole('button', { name: 'Disarm', exact: true })).toBeVisible();
  await base.getByLabel('Rover base presentation').selectOption('keyboard');
  await expect(base.getByRole('button', { name: 'Arm input', exact: true })).toBeVisible();
  await page.locator('#control-left_arm').getByLabel('Left arm operation').selectOption('future');
  await expect(page.locator('#control-left_arm')).toContainText('Unsupported profile');
  await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await expect(page.locator('.connection-badge')).toContainText('ready');
  await expect(page.getByRole('button', { name: 'Request control', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Disarm', exact: true })).toHaveCount(0);
});

test('legacy routes and home remain reachable', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Open dynamic workspace' })).toBeVisible();
  for (const route of ['/robot', '/rover']) {
    const response = await page.request.get(route);
    expect(response.status()).toBe(200);
  }
});
