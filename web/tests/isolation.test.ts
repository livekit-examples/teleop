import { expect, it } from 'vitest';
import { FixtureTransport, fixtureConfig } from '../src/lib/teleop/fixture-transport';
import { StreamHub } from '../src/lib/teleop/streams';
import { WorkspaceRuntime } from '../src/lib/teleop/runtime';
import { ControlManager, fixtureAdapters } from '../src/lib/teleop/controls';
import { CameraDeck } from '../src/lib/teleop/cameras';
import type { Source } from '../src/lib/teleop/types';

const flush = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};
const source: Source = { kind: 'data', track_name: '/imu', field_path: [] };
const spec = { source, robot: 'fixture-rover', cacheKey: 'raw', select: (value: unknown) => value };

it('old robot consumers never subscribe or display samples from a newly selected robot', async () => {
  const transport = new FixtureTransport();
  const hub = new StreamHub(transport);
  hub.configure(transport.tracks, true, 1, () => false, 'fixture-rover');
  const release = hub.acquire('same_panel_id', spec);
  transport.push('/imu', 4);
  await flush();
  const other = transport.tracks.map((p) => ({ ...p, robot: 'other', id: `other:${p.id}` }));
  transport.tracks = other;
  hub.configure(other, true, 2, () => false, 'other');
  transport.push('other:/imu', 99);
  await flush();
  expect(transport.reads.has('other:/imu')).toBe(false);
  expect(hub.view('same_panel_id').value).toBeUndefined();
  release();
  hub.acquire('same_panel_id', { ...spec, robot: 'other' });
  expect(hub.view('same_panel_id').value).toBeUndefined();
  transport.push('other:/imu', 99);
  await flush();
  expect(hub.view('same_panel_id').value).toBe(99);
  hub.dispose();
});

it('changing a panel field/renderer cannot reuse an incompatible cached value', async () => {
  const transport = new FixtureTransport();
  const hub = new StreamHub(transport);
  hub.configure(transport.tracks, true, 1, () => false, 'fixture-rover');
  const release = hub.acquire('a', spec);
  transport.push('/imu', { raw: 'old' });
  await flush();
  release();
  hub.acquire('a', { ...spec, cacheKey: 'joints' });
  expect(hub.view('a').value).toBeUndefined();
  hub.dispose();
});

it('permission and stream-reader failures are explicit rather than missing-data incidents', async () => {
  const transport = new FixtureTransport();
  transport.read = () => ({
    [Symbol.asyncIterator]: () => ({
      next: async () => {
        throw new Error('Permission denied by publisher');
      },
    }),
  });
  const hub = new StreamHub(transport);
  hub.configure(transport.tracks, true, 1, () => false, 'fixture-rover');
  hub.acquire('a', { ...spec, rate: 10 });
  await flush();
  expect(hub.view('a')).toMatchObject({
    status: 'invalid',
    reason: expect.stringContaining('Permission denied'),
  });
  expect(hub.incidents).toEqual([]);
  hub.dispose();
});

it('invalidates a pending discovery when the robot changes its Portal version', async () => {
  const transport = new FixtureTransport();
  let resolve!: (payload: string) => void;
  transport.rpc = () =>
    new Promise<string>((r) => {
      resolve = r;
    });
  const runtime = new WorkspaceRuntime(transport);
  transport.emit('connected');
  await flush();
  transport.robots[0].attributes['lk.portal.version'] = '2';
  transport.emit('changed');
  resolve(JSON.stringify(fixtureConfig));
  await flush();
  expect(runtime.config).toBeUndefined();
  expect(runtime.discovery).toBe('failed');
  expect(transport.mediaDemand.size).toBe(0);
  await runtime.dispose();
});

it('rediscovers a departing robot when that same identity returns', async () => {
  const transport = new FixtureTransport();
  const runtime = new WorkspaceRuntime(transport);
  transport.emit('connected');
  await flush();
  const robot = transport.robots[0];
  transport.robots = [];
  transport.emit('changed');
  expect(runtime.config).toBeUndefined();
  transport.robots = [robot];
  transport.emit('changed');
  await flush();
  expect(runtime.discovery).toBe('ready');
  expect(runtime.selected).toBe(robot.identity);
  await runtime.dispose();
});

it('saved unknown operation IDs including object property names stay unavailable', async () => {
  const transport = new FixtureTransport();
  const hub = new StreamHub(transport);
  const controls = new ControlManager(transport, hub, fixtureAdapters());
  controls.configure(fixtureConfig, 'fixture-rover', true, 1);
  await controls.select('base', 'constructor', 'keyboard');
  expect(controls.operation('base')).toBeUndefined();
  expect(controls.reason('base')).toContain('absent');
  await controls.select('constructor', 'drive', 'keyboard');
  expect(controls.operation('constructor')).toBeUndefined();
  expect(controls.reason('constructor')).toContain('absent');
  controls.dispose();
});

it('video monitoring records one stale/recovered transition and real display progress separately', () => {
  const deck = new CameraDeck();
  deck.add('a', 'Camera', 0);
  deck.frame('a', 0);
  deck.presented('a', 1);
  deck.tick(4000, 30);
  deck.tick(4100, 30);
  expect(deck.incidents).toHaveLength(1);
  deck.frame('a', 4200);
  deck.tick(4200, 30);
  expect(deck.incidents.map((event) => event.transition)).toEqual(['stale', 'recovered']);
  expect(deck.cameras.get('a')?.presentedAt).toBe(1);
});
