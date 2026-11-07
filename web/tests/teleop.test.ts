import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { CameraDeck } from '../src/lib/teleop/cameras';
import { ControlManager, fixtureAdapters } from '../src/lib/teleop/controls';
import { FixtureTransport, fixtureConfig } from '../src/lib/teleop/fixture-transport';
import { emptyLayout, LayoutStore, parseLayout, validatePanel } from '../src/lib/teleop/layout';
import { prunePlacement, readPlacement, writePlacement } from '../src/lib/teleop/placement';
import { WorkspaceRuntime } from '../src/lib/teleop/runtime';
import { panelSelector, selectJoints, selectPath } from '../src/lib/teleop/selectors';
import { monitoringPolicy, StreamHub } from '../src/lib/teleop/streams';
import { isExcluded, parseDiscovery, parseJson } from '../src/lib/teleop/validation';
import type { Clock, Layout, Panel, Publication, Source } from '../src/lib/teleop/types';

const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
const source = (name = '/imu'): Source => ({ kind: 'data', track_name: name, field_path: [] });
const panel: Panel = {
  label: 'Yaw',
  visualization: 'plot',
  visible: true,
  source: { ...source(), field_path: ['angular_velocity', 'z'] },
  settings: { expected_rate_hz: 10 },
};
class FakeClock implements Clock {
  time = 0;
  delays: number[] = [];
  now() {
    return this.time;
  }
  async delay(ms: number) {
    this.delays.push(ms);
    this.time += ms;
  }
}
const storage = () => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
};
function hubSetup() {
  const clock = new FakeClock();
  const transport = new FixtureTransport();
  const hub = new StreamHub(transport, clock);
  hub.configure(
    transport.publications(),
    true,
    1,
    (s) => isExcluded(fixtureConfig, s.kind, s.track_name),
    'fixture-rover',
  );
  return { clock, transport, hub };
}
function controlsSetup() {
  const setup = hubSetup();
  const manager = new ControlManager(setup.transport, setup.hub, fixtureAdapters(), setup.clock);
  manager.configure(fixtureConfig, 'fixture-rover', true, 1);
  return { ...setup, manager };
}

describe('discovery and exact identities', () => {
  const directory = new URL('../../generalization/examples/', import.meta.url);
  for (const file of readdirSync(directory).filter((f) => f.endsWith('.json')))
    it(`accepts ${file}`, () =>
      expect(parseDiscovery(readFileSync(new URL(file, directory), 'utf8')).schema_version).toBe(
        1,
      ));
  it('does not use fixture known profiles as a runtime allowlist', () => {
    const config = structuredClone(fixtureConfig);
    config.control_interfaces.base.operations.drive.profile = 'new.profile.v8';
    expect(
      parseDiscovery(JSON.stringify(config)).control_interfaces.base.operations.drive.profile,
    ).toBe('new.profile.v8');
  });
  it.each([0, -1, true, null, '30'])('rejects invalid video rate %s', (rate) =>
    expect(() =>
      parseDiscovery(JSON.stringify({ ...fixtureConfig, default_video_rate_hz: rate })),
    ).toThrow('positive finite'),
  );
  it.each(['topics', 'videos', 'components', 'attachments', 'services', 'rpcs'])(
    'rejects legacy %s',
    (key) =>
      expect(() => parseDiscovery(JSON.stringify({ ...fixtureConfig, [key]: {} }))).toThrow(
        'Legacy',
      ),
  );
  it('rejects invalid patterns without unrestricted fallback', () =>
    expect(() =>
      parseDiscovery(JSON.stringify({ ...fixtureConfig, exclude_data_tracks: ['['] })),
    ).toThrow('pattern'));
  it('uses whole-name case-sensitive exclusion matches including alternation and newlines', () => {
    const c = { ...fixtureConfig, exclude_data_tracks: ['foo|bar'] };
    expect(isExcluded(c, 'data', 'foo')).toBe(true);
    expect(isExcluded(c, 'data', 'foobar')).toBe(false);
    expect(isExcluded(c, 'data', 'Foo')).toBe(false);
    expect(isExcluded(c, 'data', 'foo\n')).toBe(false);
  });
  it('rejects duplicate and escaped duplicate keys', () => {
    expect(() => parseJson('{"operations":{"drive":1,"drive":2}}')).toThrow('Duplicate');
    expect(() => parseJson('{"x":1,"\\u0078":2}')).toThrow('Duplicate');
  });
  it('permits unknown inert optional fields', () =>
    expect(
      parseDiscovery(JSON.stringify({ ...fixtureConfig, future: { option: true } })).label,
    ).toBe(fixtureConfig.label));
  it('does not change the base contract when arms are added', () => {
    const a = parseDiscovery(
      readFileSync(new URL('01-rover-differential.json', directory), 'utf8'),
    );
    const b = parseDiscovery(readFileSync(new URL('04-rover-arm.json', directory), 'utf8'));
    expect(a.control_interfaces.base).toEqual(b.control_interfaces.base);
  });
});

describe('literal fields and named joints', () => {
  it('reads literal dots/slashes without evaluating expressions', () =>
    expect(selectPath({ 'a.b': [{ '/x': 3 }] }, ['a.b', 0, '/x'])).toBe(3));
  it('never traverses inherited properties', () =>
    expect(() => selectPath({}, ['constructor', 'prototype'])).toThrow('absent'));
  it('matches joints after reorder, and never substitutes offsets', () => {
    expect(selectJoints({ name: ['right', 'left'], position: [9, 2] }, ['left'])[0].position).toBe(
      2,
    );
    expect(() => selectJoints({ name: ['right'], position: [9] }, ['left'])).toThrow('left');
  });
  it('rejects wrong scalar types without coercion', () => {
    expect(() => panelSelector(panel)({ angular_velocity: { z: '3' } })).toThrow('finite');
    expect(() =>
      panelSelector({ ...panel, visualization: 'boolean' })({ angular_velocity: { z: 1 } }),
    ).toThrow('Boolean');
  });
});

describe('shared streams, status and receive-time deadlines', () => {
  it('uses one reader/decode across consumers and removes only their own demand', async () => {
    const { hub, transport } = hubSetup();
    const a = hub.acquire('a', { source: source(), select: (v) => v });
    const b = hub.acquire('b', { source: source(), select: panelSelector(panel) });
    await flush();
    expect(transport.reads.get('/imu')).toBe(1);
    transport.push('/imu', { angular_velocity: { z: 5 } });
    await flush();
    expect(hub.view('a').decoded).toBe(1);
    expect(hub.view('b').value).toBe(5);
    a();
    transport.push('/imu', { angular_velocity: { z: 6 } });
    await flush();
    expect(hub.view('b').value).toBe(6);
    b();
    expect(hub.view('b').status).toBe('not_requested');
  });
  it('starts monitoring even if an expected publication is absent', () => {
    const { hub, clock } = hubSetup();
    hub.acquire('a', { source: source('/missing'), rate: 10, select: (v) => v });
    expect(hub.view('a').status).toBe('starting');
    clock.time = 2999;
    expect(hub.view('a').status).toBe('starting');
    clock.time = 3000;
    hub.tick();
    expect(hub.view('a').status).toBe('stale');
    expect(hub.incidents).toHaveLength(1);
    hub.tick();
    expect(hub.incidents).toHaveLength(1);
  });
  it('absent no-rate inputs are unavailable and produce no outage incident', () => {
    const { hub, clock } = hubSetup();
    hub.acquire('a', { source: source('/missing'), select: (v) => v });
    clock.time = 60_000;
    hub.tick();
    expect(hub.view('a').status).toBe('unavailable');
    expect(hub.incidents).toEqual([]);
  });
  it('does not make excluded saved inputs subscribe or monitor', () => {
    const { hub, transport, clock } = hubSetup();
    hub.acquire('a', { source: source('/debug/cpu'), rate: 10, select: (v) => v });
    clock.time = 90_000;
    hub.tick();
    expect(hub.view('a').status).toBe('excluded');
    expect(transport.reads.has('/debug/cpu')).toBe(false);
    expect(hub.incidents).toEqual([]);
  });
  it.each([undefined, 'cdr', 'protobuf'])('does not guess a decoder for %s', (encoding) => {
    const { hub, transport } = hubSetup();
    transport.tracks = transport.tracks.map((p) => (p.name === '/imu' ? { ...p, encoding } : p));
    hub.configure(transport.publications(), true, 1, () => false);
    hub.acquire('a', { source: source(), rate: 10, select: (v) => v });
    expect(hub.view('a').status).toBe('unsupported');
    expect(transport.reads.has('/imu')).toBe(false);
  });
  it('invalid arrivals do not refresh usable freshness or erase the last value', async () => {
    const { hub, transport, clock } = hubSetup();
    hub.acquire('a', { source: source(), select: panelSelector(panel), rate: 10 });
    transport.push('/imu', { angular_velocity: { z: 2 } });
    await flush();
    clock.time = 5000;
    transport.pushBytes('/imu', new TextEncoder().encode('bad'));
    await flush();
    expect(hub.view('a')).toMatchObject({
      value: 2,
      at: 0,
      status: 'invalid',
      arrivals: 2,
      decoded: 1,
    });
    transport.push('/imu', { wrong: 1 });
    await flush();
    expect(hub.view('a').status).toBe('invalid');
    expect(hub.view('a').at).toBe(0);
  });
  it('independently checks the required joints of consumers sharing one stream', async () => {
    const { hub, transport } = hubSetup();
    for (const name of ['left', 'right'])
      hub.acquire(name, {
        source: source('/joint_states'),
        select: (v) => selectJoints(v, [name]),
        rate: 10,
      });
    transport.push('/joint_states', { name: ['left'], position: [1] });
    await flush();
    expect(hub.view('left').status).toBe('healthy');
    expect(hub.view('right').status).toBe('invalid');
    expect(transport.reads.get('/joint_states')).toBe(1);
  });
  it('resets grace on fresh demand and retains only the last display value', async () => {
    const { hub, transport, clock } = hubSetup();
    const release = hub.acquire('a', { source: source(), select: (v) => v, rate: 10 });
    transport.push('/imu', 42);
    await flush();
    release();
    clock.time = 9000;
    hub.tick();
    expect(hub.incidents).toEqual([]);
    hub.acquire('a', { source: source(), select: (v) => v, rate: 10 });
    expect(hub.view('a')).toMatchObject({ value: 42, status: 'starting', at: undefined });
  });
  it('expires one consumer while a different rate remains healthy and recovers once', async () => {
    const { hub, transport, clock } = hubSetup();
    hub.acquire('fast', { source: source(), select: (v) => v, rate: 10 });
    hub.acquire('slow', { source: source(), select: (v) => v, rate: 0.5 });
    transport.push('/imu', 1);
    await flush();
    clock.time = 4000;
    hub.tick();
    expect(hub.view('fast').status).toBe('stale');
    expect(hub.view('slow').status).toBe('healthy');
    transport.push('/imu', 2);
    await flush();
    hub.tick();
    expect(hub.incidents.map((i) => i.transition)).toEqual(['stale', 'recovered']);
  });
  it('suppresses stream incidents on disconnect and ignores late old frames', async () => {
    const { hub, transport, clock } = hubSetup();
    hub.acquire('a', { source: source(), select: (v) => v, rate: 10 });
    hub.configure([], false, 2, () => false);
    transport.push('/imu', 99);
    clock.time = 8000;
    await flush();
    hub.tick();
    expect(hub.view('a').value).toBeUndefined();
    expect(hub.incidents).toEqual([]);
  });
  it('rebinds a new SID without marking the old sample current', async () => {
    const { hub, transport } = hubSetup();
    hub.acquire('a', { source: source(), select: (v) => v });
    transport.push('/imu', 1);
    await flush();
    const next = transport
      .publications()
      .map((p) => (p.name === '/imu' ? { ...p, id: 'new-sid' } : p));
    transport.tracks = next;
    hub.configure(next, true, 1, () => false);
    expect(hub.view('a').at).toBeUndefined();
    transport.push('new-sid', 2);
    await flush();
    expect(hub.view('a').value).toBe(2);
  });
  it('uses the specified centralized timing policy', () =>
    expect([
      monitoringPolicy.grace(30),
      monitoringPolicy.stale(30),
      monitoringPolicy.window(30),
    ]).toEqual([3000, 1000, 5000]));
});

describe('automatic camera policy', () => {
  it('chooses first usable frame instead of publication order and keeps loading tiles', () => {
    const d = new CameraDeck();
    d.add('a', 'A', 0);
    d.add('b', 'B', 0);
    d.frame('b', 200);
    expect(d.main).toBe('b');
    expect(d.pending()).toEqual(['a']);
    d.frame('a', 300);
    expect(d.tiles).toEqual(['a']);
  });
  it('swaps only the chosen slot and new arrivals never replace a selection', () => {
    const d = new CameraDeck();
    for (const id of ['a', 'b', 'c']) {
      d.add(id, id, 0);
      d.frame(id, 1);
    }
    d.select('c');
    expect(d.main).toBe('c');
    expect(d.tiles).toEqual(['b', 'a']);
    d.add('d', 'd', 0);
    d.frame('d', 2);
    expect(d.main).toBe('c');
    expect(d.tiles).toEqual(['b', 'a', 'd']);
  });
  it('falls back only on removal; stalls retain selection and reset clears choices', () => {
    const d = new CameraDeck();
    for (const id of ['a', 'b']) {
      d.add(id, id, 0);
      d.frame(id, 0);
    }
    expect(d.status('a', 4000, 30)).toBe('stale');
    expect(d.main).toBe('a');
    d.remove('a');
    expect(d.main).toBe('b');
    expect(d.notice).toContain('unavailable');
    d.remove('b');
    expect(d.main).toBeUndefined();
    d.reset();
    d.add('b', 'b', 0);
    d.add('a', 'a', 0);
    d.frame('a', 1);
    expect(d.main).toBe('a');
  });
});

describe('client-owned layout persistence', () => {
  const layout = (): Layout => ({
    ...emptyLayout('fixture-rover'),
    panels: { yaw: panel },
    panel_order: ['yaw'],
  });
  it('reads the original minimal dynamic-topic layout', () =>
    expect(
      parseLayout(
        readFileSync(
          new URL('../../generalization/layout-examples/dynamic-topics.json', import.meta.url),
          'utf8',
        ),
      ).panels.aux_gyro.source.track_name,
    ).toBe('/aux/imu'));
  it('autosaves, restores, exports the same configuration and resets only its own identity', () => {
    const memory = storage();
    const a = new LayoutStore('fixture-rover', memory);
    a.update(layout());
    const restored = new LayoutStore('fixture-rover', memory);
    expect(restored.layout).toEqual(a.layout);
    expect(parseLayout(restored.export())).toEqual(a.layout);
    const b = new LayoutStore('other-robot', memory);
    b.save();
    a.reset();
    expect(a.layout.panel_order).toEqual([]);
    expect(new LayoutStore('other-robot', memory).layout.robot_identity).toBe('other-robot');
  });
  it.each([
    { panel_order: ['yaw', 'yaw'] },
    { panel_order: ['missing'] },
    { layout_schema_version: 2 },
    { label: '' },
  ])('rejects a malformed layout without replacing a working copy', (change) => {
    const store = new LayoutStore('fixture-rover', storage());
    store.update(layout());
    expect(() => store.import(JSON.stringify({ ...layout(), ...change }))).toThrow();
    expect(store.layout).toEqual(layout());
  });
  it('rejects foreign identity and credentials/executable settings', () => {
    expect(() => parseLayout(JSON.stringify(layout()), 'different')).toThrow('belongs');
    expect(() => parseLayout(JSON.stringify({ ...layout(), token: 'secret' }))).toThrow(
      'Unsupported',
    );
    expect(() => validatePanel({ ...panel, settings: { script: 'alert(1)' } })).toThrow(
      'Unsupported',
    );
  });
  it('keeps in-memory changes and JSON export on storage failure', () => {
    const store = new LayoutStore('fixture-rover', {
      getItem: () => null,
      setItem: () => {
        throw new Error('Quota exceeded');
      },
      removeItem: () => {},
    });
    store.update(layout());
    expect(store.saveStatus).toContain('Not saved');
    expect(parseLayout(store.export()).panels.yaw).toEqual(panel);
  });
  it('round-trips split/tab/floating placement without library components in the saved format', () => {
    const l = layout();
    l.workspace = {
      version: 1,
      orientation: 'HORIZONTAL',
      root: {
        type: 'split',
        weight: 1,
        children: [
          { type: 'group', id: 'main', weight: 700, panels: ['@cameras'], active: '@cameras' },
        ],
      },
      floating: [
        {
          node: { type: 'group', id: 'telemetry', weight: 1, panels: ['yaw'], active: 'yaw' },
          x: 10,
          y: 30,
          width: 300,
          height: 200,
        },
      ],
    };
    const next = readPlacement(writePlacement(l.workspace, l));
    expect(next.floating[0].node).toMatchObject({ panels: ['yaw'] });
    expect(JSON.stringify(next)).not.toContain('contentComponent');
    expect(parseLayout(JSON.stringify({ ...l, workspace: next })).workspace).toEqual(next);
  });
  it('prunes hidden/deleted panel placement and rejects duplicate tree references', () => {
    const l = layout();
    const group = { type: 'group' as const, id: 'g', weight: 1, panels: ['yaw'], active: 'yaw' };
    const placement = {
      version: 1 as const,
      orientation: 'HORIZONTAL' as const,
      root: group,
      floating: [],
    };
    expect(prunePlacement(placement, [])?.root.type).toBe('split');
    expect(() =>
      parseLayout(
        JSON.stringify({
          ...l,
          workspace: {
            ...placement,
            floating: [{ node: { ...group, id: 'g2' }, x: 0, y: 0, width: 200, height: 200 }],
          },
        }),
      ),
    ).toThrow('duplicate');
  });
});

describe('control ownership and command sessions', () => {
  it('requires an explicit Portal request in this connection, even with a matching owner', async () => {
    const { manager, transport } = controlsSetup();
    await manager.select('base', 'drive', 'joystick');
    manager.observeOwner(transport.identity);
    expect(manager.ownsControl).toBe(false);
    await manager.arm('base');
    expect(manager.session('base')?.armed).toBe(false);
    await manager.request();
    await manager.arm('base');
    expect(manager.session('base')?.armed).toBe(true);
    expect(transport.calls[0]).toMatchObject({
      method: 'portal.set_active_operator',
      payload: transport.identity,
    });
    expect(transport.restrictedTo).toBe('fixture-rover');
  });
  it('ends the old writer before rebinding and rejects old activation callbacks', async () => {
    const { manager, transport } = controlsSetup();
    await manager.select('base', 'drive', 'joystick');
    manager.observeOwner(transport.identity);
    await manager.request();
    await manager.arm('base');
    const activation = manager.session('base')!.activation;
    manager.send('base', { axes: [1, 0] }, activation);
    await manager.select('base', 'drive', 'keyboard');
    expect(manager.session('base')?.armed).toBe(false);
    expect(transport.commands.at(-1)?.value).toMatchObject({ linear: { x: 0 } });
    await manager.arm('base');
    expect(manager.send('base', { axes: [1, 0] }, activation)).toBe(false);
  });
  it('keeps a new mode disarmed when release flushing fails', async () => {
    const { manager, transport } = controlsSetup();
    const publish = transport.publish.bind(transport);
    transport.publish = async (op) => ({
      ...(await publish(op)),
      flush: async () => {
        throw new Error('flush failed');
      },
    });
    await manager.select('base', 'drive', 'joystick');
    manager.observeOwner(transport.identity);
    await manager.request();
    await manager.arm('base');
    await manager.select('base', 'drive', 'keyboard');
    expect(manager.session('base')).toMatchObject({ armed: false, presentation: 'joystick' });
    expect(manager.reason('base')).toContain('Release failed');
  });
  it('blocks competing writers while a stop flush is still in flight', async () => {
    const { manager, transport } = controlsSetup();
    let resolveFlush!: () => void;
    const publish = transport.publish.bind(transport);
    transport.publish = async (op) => ({
      ...(await publish(op)),
      flush: () =>
        new Promise<void>((resolve) => {
          resolveFlush = resolve;
        }),
    });
    await manager.select('base', 'drive', 'joystick');
    manager.observeOwner(transport.identity);
    await manager.request();
    await manager.arm('base');
    const stop = manager.stop('base');
    expect(manager.stop('base')).toBe(stop);
    await manager.arm('base');
    expect(manager.session('base')?.armed).toBe(false);
    resolveFlush();
    await stop;
  });
  it('disarms immediately on ownership loss and does not release a different owner', async () => {
    const { manager, transport } = controlsSetup();
    await manager.select('base', 'drive', 'joystick');
    manager.observeOwner(transport.identity);
    await manager.request();
    await manager.arm('base');
    manager.observeOwner('someone-else');
    expect(manager.session('base')?.armed).toBe(false);
    expect(manager.send('base', { axes: [1, 0] })).toBe(false);
    const count = transport.calls.length;
    await manager.release();
    expect(transport.calls).toHaveLength(count);
  });
  it('does not require optional odometry, but gates current required named-joint feedback independently of monitoring', async () => {
    const { manager, transport, clock } = controlsSetup();
    await manager.select('base', 'drive', 'joystick');
    expect(manager.reason('base', false)).toBeUndefined();
    await manager.select('left_arm', 'position', 'joint_sliders');
    expect(manager.reason('left_arm', false)).toContain('Required feedback');
    transport.push('/joint_states', { name: ['left_2', 'left_1'], position: [0.2, 0.1] });
    await flush();
    expect(manager.reason('left_arm', false)).toBeUndefined();
    clock.time = 1001;
    expect(manager.reason('left_arm', false)).toContain('too old');
  });
  it('supports two independent interface selectors on one shared joint stream', async () => {
    const { manager, transport } = controlsSetup();
    await manager.select('left_arm', 'position', 'joint_sliders');
    await manager.select('right_arm', 'position', 'joint_sliders');
    transport.push('/joint_states', { name: ['left_1', 'left_2'], position: [0.1, 0.2] });
    await flush();
    expect(manager.reason('left_arm', false)).toBeUndefined();
    expect(manager.reason('right_arm', false)).toContain('right_1');
    expect(transport.reads.get('/joint_states')).toBe(1);
  });
  it('preserves unknown and unverified profile reasons without protocol fallback', async () => {
    const { manager, hub, transport } = controlsSetup();
    await manager.select('left_arm', 'future', 'vr');
    expect(manager.reason('left_arm')).toContain('Unsupported profile');
    const live = new ControlManager(transport, hub, new Map());
    live.configure(fixtureConfig, 'fixture-rover', true, 1);
    await live.select('base', 'drive', 'joystick');
    expect(live.reason('base')).toContain('Live adapter disabled');
  });
});

describe('runtime reconnect, discovery and demand isolation', () => {
  it('loads explicit simulator policy on manual discovery and clears it on disconnect', async () => {
    const transport = new FixtureTransport();
    Object.defineProperty(transport, 'fixture', { value: false });
    const config = structuredClone(fixtureConfig);
    const policy = {
      profile: 'joints.trajectory.v1', max_feedback_age_ms: 1000,
      interfaces: { left_arm: {
        left_1: { min: -1, max: 1, max_velocity: 0.5 },
        left_2: { min: -2, max: 2, max_velocity: 0.5 },
      } },
    };
    vi.spyOn(transport, 'rpc').mockResolvedValue(JSON.stringify({ ...config,
      simulation_control: { implementation: 'mujoco.joint_trajectory.v1', policy },
    }));
    const runtime = new WorkspaceRuntime(transport, storage());
    transport.emit('connected');
    await flush();
    expect(runtime.discovery).toBe('ready');
    expect(runtime.controls.adapter('left_arm')?.units).toContain('simulation');
    expect(runtime.controls.adapter('base')).toBeUndefined();
    transport.emit('disconnected');
    expect(runtime.controls.adapters.size).toBe(0);
    await runtime.dispose();
  });

  it('subscribes all eligible initial/new videos, no audio, and no excluded video', async () => {
    const transport = new FixtureTransport();
    const runtime = new WorkspaceRuntime(transport, storage());
    transport.emit('connected');
    await flush();
    expect(runtime.discovery).toBe('ready');
    expect([...transport.mediaDemand]).toEqual(['Front camera', 'Wrist camera']);
    const pub: Publication = {
      id: 'new-video',
      robot: 'fixture-rover',
      name: 'New camera',
      kind: 'video',
    };
    transport.add(pub);
    expect(transport.mediaDemand.has('new-video')).toBe(true);
    expect(transport.mediaDemand.has('microphone')).toBe(false);
    await runtime.dispose();
  });
  it('reference-counts audio listening and exclusion wins over an expectation', async () => {
    const transport = new FixtureTransport();
    const runtime = new WorkspaceRuntime(transport, storage());
    transport.emit('connected');
    await flush();
    const a = runtime.listen('microphone');
    const b = runtime.listen('microphone');
    expect(transport.mediaDemand.has('microphone')).toBe(true);
    a();
    expect(transport.mediaDemand.has('microphone')).toBe(true);
    b();
    expect(transport.mediaDemand.has('microphone')).toBe(false);
    await runtime.dispose();
  });
  it('discovers a new data topic without a robot-side declaration or background reader', async () => {
    const transport = new FixtureTransport();
    const runtime = new WorkspaceRuntime(transport, storage());
    transport.emit('connected');
    await flush();
    transport.add({
      id: 'extra',
      robot: 'fixture-rover',
      name: '/extra',
      kind: 'data',
      encoding: 'json',
    });
    expect(runtime.catalog().some((p) => p.name === '/extra')).toBe(true);
    expect(transport.reads.has('extra')).toBe(false);
    await runtime.dispose();
  });
  it('retries failed discovery exactly three times with the contract timeout and delay', async () => {
    const transport = new FixtureTransport();
    const clock = new FakeClock();
    transport.rpc = vi.fn(async () => {
      throw new Error('not started');
    });
    const runtime = new WorkspaceRuntime(transport, storage(), clock);
    transport.emit('connected');
    await flush();
    expect(transport.rpc).toHaveBeenCalledTimes(3);
    expect(transport.rpc).toHaveBeenLastCalledWith('fixture-rover', 'get_robot_config', '', 3000);
    expect(clock.delays).toEqual([500, 500]);
    expect(runtime.discovery).toBe('failed');
    expect(transport.mediaDemand.size).toBe(0);
    await runtime.dispose();
  });
  it('ignores an old discovery result after a robot selection changes', async () => {
    const transport = new FixtureTransport();
    let resolveOld!: (payload: string) => void;
    transport.rpc = () =>
      new Promise<string>((resolve) => {
        resolveOld = resolve;
      });
    const runtime = new WorkspaceRuntime(transport, storage());
    transport.emit('connected');
    await flush();
    await runtime.select('incompatible-station');
    resolveOld(JSON.stringify(fixtureConfig));
    await flush();
    expect(runtime.selected).toBe('incompatible-station');
    expect(runtime.config).toBeUndefined();
    expect(transport.mediaDemand.size).toBe(0);
    await runtime.dispose();
  });
  it('revalidates on reconnect, clears freshness and never restores armed control', async () => {
    const transport = new FixtureTransport();
    const runtime = new WorkspaceRuntime(transport, storage());
    transport.emit('connected');
    await flush();
    await runtime.controls.request();
    await runtime.controls.arm('base');
    expect(runtime.controls.session('base')?.armed).toBe(true);
    const release = runtime.streams.acquire('plot', {
      source: source(),
      rate: 10,
      select: (v) => v,
    });
    transport.push('/imu', 4);
    await flush();
    runtime.cameras.frame('Front camera', 1);
    transport.emit('interrupted');
    expect(runtime.controls.ownsControl).toBe(false);
    expect(transport.mediaDemand.size).toBe(0);
    transport.emit('connected');
    await flush();
    expect(runtime.discovery).toBe('ready');
    expect(runtime.controls.session('base')?.armed).toBe(false);
    expect(runtime.cameras.main).toBeUndefined();
    expect(runtime.streams.view('plot').at).toBeUndefined();
    expect(transport.calls.filter((c) => c.method === 'get_robot_config')).toHaveLength(2);
    release();
    await runtime.dispose();
  });
  it('invalid discovery preserves publication metadata but starts no consumers', async () => {
    const transport = new FixtureTransport();
    transport.config = { schema_version: 1, videos: [] };
    const runtime = new WorkspaceRuntime(transport, storage());
    transport.emit('connected');
    await flush();
    expect(runtime.discovery).toBe('failed');
    expect(runtime.catalog().length).toBeGreaterThan(0);
    expect(transport.mediaDemand.size).toBe(0);
    expect(transport.reads.size).toBe(0);
    await runtime.dispose();
  });
  it('valid import restores preferences without acquiring or publishing commands; invalid import preserves layout', async () => {
    const transport = new FixtureTransport();
    const runtime = new WorkspaceRuntime(transport, storage());
    transport.emit('connected');
    await flush();
    const l = {
      ...emptyLayout('fixture-rover'),
      control_preferences: { base: { operation: 'drive', presentation: 'keyboard' } },
    };
    await runtime.importLayout(JSON.stringify(l));
    expect(runtime.controls.session('base')?.presentation).toBe('keyboard');
    expect(transport.commands).toEqual([]);
    expect(transport.calls.every((call) => call.method === 'get_robot_config')).toBe(true);
    await expect(runtime.importLayout('{"bad":true}')).rejects.toThrow();
    expect(runtime.layout).toEqual(l);
    await runtime.dispose();
  });
});
