import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import type { Room } from 'livekit-client';

test.skip(process.env.TELEOP_DEMO_E2E !== '1', 'Requires the shared supervisor and real LiveKit.');
const video = async (page: Page) => {
  await expect
    .poll(
      () =>
        page
          .locator('video')
          .evaluateAll((videos) =>
            videos.some((video) => (video as HTMLVideoElement).videoWidth > 0),
          ),
      { timeout: 90000 },
    )
    .toBe(true);
};
const watch = async (page: Page, name: string) => {
  await page.goto('/try');
  await page.getByRole('button', { name: 'Watch ' + name, exact: true }).click();
  await expect(page).toHaveURL(/workspace\?session=[a-f0-9]{32}/);
  await video(page);
  return new URL(page.url()).searchParams.get('session')!;
};

test('shared room: separate queues, motion, forbidden targets, and independent idle cleanup', async ({
  page,
  browser,
}) => {
  test.setTimeout(300000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const id = await watch(page, 'wxai');
  const run = await (await page.request.get('/api/demo/instances/' + id)).json();
  const secondContext = await browser.newContext();
  try {
    const spectator = await secondContext.newPage();
    spectator.on('pageerror', (error) => errors.push(error.message));
    await spectator.goto('/workspace?session=' + id);
    await video(spectator);
    await expect(
      spectator.getByRole('button', { name: 'Join control queue', exact: true }),
    ).toBeVisible();

    // Read real joint feedback before the control turn starts.
    await page.getByRole('button', { name: 'Add visualization', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox', { name: 'Visualization', exact: true }).selectOption('raw');
    await dialog
      .getByRole('combobox', { name: 'Topic', exact: true })
      .selectOption('/arm/joint_states');
    await dialog.getByLabel('Panel title').fill('Measured joints');
    await dialog.getByRole('button', { name: 'Add panel', exact: true }).click();
    const raw = page.locator('.raw-message');
    await expect(raw).toContainText('position');
    const position = async () => {
      try {
        return JSON.parse(await raw.innerText()).position[0] as number;
      } catch {
        return NaN; // Rebinding a panel can briefly clear its latest sample.
      }
    };
    const before = await position();
    await page.getByRole('button', { name: 'Join control queue', exact: true }).click();
    await expect(page.locator('.demo-session-banner')).toContainText('Your turn');
    const turnSeconds = async () =>
      Number(
        (await page.locator('.demo-session-banner').innerText()).match(/Your turn · (\d+)s/)?.[1],
      );
    const firstSeconds = await turnSeconds();
    await expect.poll(turnSeconds).toBeLessThan(firstSeconds);
    await page.getByRole('tab', { name: 'Controls', exact: true }).click();
    await page.locator('.control-acquire').first().click();
    await expect(page.locator('.control-arm').first()).toBeEnabled();
    await page.locator('.control-arm').first().click();
    const slider = page.locator('.joint-controls input[type=range]').first();
    await expect(slider).toBeEnabled();
    await slider.fill(String(before + 0.15));
    await expect.poll(position, { timeout: 5000 }).toBeGreaterThan(before + 0.04);

    await spectator.getByRole('button', { name: 'Join control queue', exact: true }).click();
    await expect(spectator.locator('.demo-session-banner')).toContainText('Queue position 1');
    await page
      .locator('.demo-session-banner')
      .getByRole('button', { name: 'Release control', exact: true })
      .click();
    await expect(spectator.locator('.demo-session-banner')).toContainText('Your turn');
    await video(page); // Demotion leaves the same viewer connected.

    // A separate tab uses the actual browser SDK to attempt a forbidden robot claim.
    const attacker = await secondContext.newPage();
    await attacker.goto('/try');
    await attacker.addScriptTag({
      path: path.resolve('vendor/client-sdk-js/dist/livekit-client.umd.js'),
    });
    const other = await attacker.evaluate(async () => {
      const request = async (route: string, body: unknown, proof = '') => {
        const response = await fetch('/api/demo/' + route, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Sim-Proof': proof },
          body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error(await response.text());
        return response.json();
      };
      const run = await request('simulations/vacuum/watch', {});
      let current = run;
      while (current.state !== 'ready') {
        await new Promise((resolve) => setTimeout(resolve, 500));
        current = await (await fetch('/api/demo/instances/' + run.id)).json();
        if (!['starting', 'queued', 'ready'].includes(current.state))
          throw new Error('Vacuum failed to start');
      }
      const credential = await request('credentials', {});
      const target = window as unknown as {
        LivekitClient: { Room: new () => Room };
        attackRoom: Room;
      };
      const room = (target.attackRoom = new target.LivekitClient.Room());
      await room.connect(credential.server_url, credential.token, { autoSubscribe: false });
      const simulation = await request(
        'instances/' + run.id + '/credentials',
        { event_id: crypto.randomUUID() },
        credential.proof,
      );
      const queue = await request(
        'queue',
        { instance_id: run.id, action: 'join' },
        simulation.proof,
      );
      const keep = document.createElement('button');
      keep.textContent = 'Keep vacuum running';
      keep.onclick = () =>
        void request(
          'engagement',
          { instance_id: run.id, event_id: crypto.randomUUID() },
          simulation.proof,
        );
      document.body.append(keep);
      return {
        id: run.id,
        robot: current.robot_identity,
        room: credential.room_name,
        identity: credential.identity,
        controller: queue.controller,
      };
    });
    expect(other.controller.identity).toBe(other.identity);
    const rejected = await attacker.evaluate(async (robot) => {
      const target = window as unknown as { attackRoom: Room };
      try {
        await target.attackRoom.localParticipant.performRpc({
          destinationIdentity: robot,
          method: 'portal.set_active_operator',
          payload: target.attackRoom.localParticipant.identity,
          responseTimeout: 4000,
        });
        return false;
      } catch {
        return true;
      }
    }, run.robot_identity);
    expect(rejected).toBe(true);

    // Keep only vacuum active. Video and queue polling must not keep the arm alive.
    let stopped = false;
    const deadline = Date.now() + (run.idle_seconds + 15) * 1000;
    while (Date.now() < deadline) {
      await attacker.getByRole('button', { name: 'Keep vacuum running', exact: true }).click();
      const state = await (await page.request.get('/api/demo/instances/' + id)).json();
      if (['expired', 'stopped'].includes(state.state)) {
        stopped = true;
        break;
      }
      await page.waitForTimeout(3000);
    }
    expect(stopped).toBe(true);
    expect((await (await page.request.get('/api/demo/instances/' + other.id)).json()).state).toBe(
      'ready',
    );
    await page.getByRole('button', { name: 'Continue watching', exact: true }).click();
    await expect(page).not.toHaveURL('/workspace?session=' + id);
    await video(page);
    const replacement = new URL(page.url()).searchParams.get('session');
    expect(replacement).not.toBe(id);
    await page.screenshot({ path: test.info().outputPath('shared-restart.png') });
    expect(errors).toEqual([]);
  } finally {
    await secondContext.close();
  }
});
