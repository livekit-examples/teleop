import { expect, test } from '@playwright/test';

test.skip(
  process.env.TELEOP_RACING_E2E !== '1',
  'Requires local LiveKit and the managed simulation service.',
);

test('community car launches, streams onboard video, drives and brakes through the workspace', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto('/try');
    const card = page.locator('[data-simulation-id="f1tenth"]');
    await expect(card).toBeEnabled();
    await card.getByRole('button', { name: /Watch/ }).click();
    await expect(page).toHaveURL(/\/workspace\?session=[a-f0-9]{32}/, { timeout: 60_000 });
    await expect(page.locator('.connection-badge')).toContainText('ready', { timeout: 15_000 });
    await expect
      .poll(() =>
        page
          .locator('video')
          .evaluateAll((videos) => videos.some((v) => (v as HTMLVideoElement).videoWidth > 0)),
      )
      .toBe(true);
    await page.getByRole('button', { name: 'Add visualization', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox', { name: 'Visualization', exact: true }).selectOption('raw');
    await dialog
      .getByRole('combobox', { name: 'Topic', exact: true })
      .selectOption('/steering_angle_deg');
    await dialog.getByLabel('Panel title').fill('Measured steering');
    await dialog.getByLabel('Literal field path').fill('[]');
    await dialog.getByRole('button', { name: 'Add panel', exact: true }).click();
    const steering = async () =>
      JSON.parse(await page.locator('.raw-message').innerText()).data as number;
    await page.getByRole('tab', { name: 'Controls', exact: true }).click();
    await page.getByRole('button', { name: 'Join control queue', exact: true }).click();
    await expect(page.getByText('Your turn', { exact: false })).toBeVisible();
    await page
      .getByRole('combobox', { name: 'Race car presentation', exact: true })
      .selectOption('keyboard');
    await page.getByRole('button', { name: 'Acquire control', exact: true }).first().click();
    const arm = page.getByRole('button', { name: 'Arm', exact: true });
    await expect(arm).toBeEnabled();
    await arm.click();
    await expect(page.getByRole('button', { name: 'Disarm', exact: true })).toBeVisible();
    const telemetry = page.getByRole('status', { name: 'Race car telemetry' });
    const speed = async () => parseFloat(await telemetry.locator('strong').innerText());
    await expect.poll(speed).toBe(0);
    await expect(
      page.getByText('Return inputs to neutral before motion.', { exact: true }),
    ).toHaveCount(0);
    // Move focus away from selects/buttons; the keyboard controller ignores editable targets.
    await page.locator('.camera-main').click();
    await page.keyboard.down('ArrowUp');
    await expect.poll(speed).toBeGreaterThan(6.5);
    await expect.poll(steering).toBe(0);
    await page.keyboard.down('ArrowLeft');
    // This wait is the duration of the steering stimulus, not a readiness delay.
    await page.waitForTimeout(300);
    const turningAngle = await steering();
    expect(turningAngle).toBeGreaterThan(0.05);
    expect(turningAngle).toBeLessThan(3);
    await page.keyboard.up('ArrowLeft');
    await expect.poll(steering).toBeLessThan(0.1);
    expect(await speed()).toBeGreaterThan(5);
    await page.keyboard.up('ArrowUp');
    await expect.poll(speed).toBeLessThan(0.15);
    await page.getByRole('button', { name: 'Disarm', exact: true }).click();
    await expect(arm).toBeVisible();
    await page.screenshot({ path: '/private/tmp/f1tenth-workspace.png', fullPage: true });
    await page.reload();
    await expect(page.locator('.connection-badge')).toContainText('ready', { timeout: 15_000 });
    await page.getByRole('tab', { name: 'Controls', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Acquire control', exact: true }).first(),
    ).toBeVisible();
    await expect(page.locator('.control-channel')).toContainText('Disarmed');
    expect(errors).toEqual([]);
  } catch (error) {
    console.log(
      await page
        .locator('.control-panel')
        .innerText()
        .catch(() => 'Control panel unavailable'),
    );
    await page.screenshot({ path: '/private/tmp/f1tenth-browser-failure.png', fullPage: true });
    throw error;
  } finally {
    await page.keyboard.up('ArrowUp');
    await page.keyboard.up('ArrowLeft');
    const release = page.getByRole('button', { name: 'Release control', exact: true });
    if (await release.isVisible()) await release.click();
  }
});
