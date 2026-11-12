import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fixtureConfig, FixtureTransport } from '../src/lib/teleop/fixture-transport';
import { WorkspaceRuntime } from '../src/lib/teleop/runtime';
import { parseDiscovery } from '../src/lib/teleop/validation';

const view = (eye: 'left' | 'right') => ({
  frame_id: `front_${eye}_optical`,
  image_region: { x: eye === 'left' ? 0 : 640, y: 0, width: 640, height: 480 },
  intrinsics: {
    fx: 500,
    fy: 500,
    cx: 320,
    cy: 240,
    distortion_model: 'none',
    distortion_coefficients: [] as number[],
  },
  extrinsics: {
    parent_frame_id: 'front_mount',
    translation: [eye === 'left' ? 0 : 0.06, 0, 0],
    rotation_xyzw: [0, 0, 0, 1],
  },
});
const camera = () => ({
  track_name: 'front-stereo',
  width: 1280,
  height: 480,
  views: { left: view('left'), right: view('right') },
});
const parse = (camera_info: unknown) =>
  parseDiscovery(JSON.stringify({ ...fixtureConfig, camera_info }));

describe('fixed camera metadata', () => {
  it('keeps camera_info optional and accepts an empty map', () => {
    expect(parseDiscovery(JSON.stringify(fixtureConfig)).camera_info).toBeUndefined();
    expect(parse({}).camera_info).toEqual({});
  });
  it('preserves stereo eye calibration from the example document', () => {
    const raw = JSON.parse(
      readFileSync(
        new URL('../../generalization/examples/14-stereo-camera.json', import.meta.url),
        'utf8',
      ),
    );
    expect(parseDiscovery(JSON.stringify(raw)).camera_info).toEqual(raw.camera_info);
  });
  it('accepts a mono view and calibration for a cropped image', () => {
    const mono = view('left');
    mono.image_region = { x: 10, y: 20, width: 640, height: 480 };
    const info = { track_name: 'mono', width: 800, height: 600, views: { mono } };
    expect(parse({ front: info }).camera_info?.front).toEqual(info);
  });
  it.each([
    ['plumb_bob', 5],
    ['rational_polynomial', 8],
    ['equidistant', 4],
  ] as const)('accepts the %s distortion model', (model, count) => {
    const info = camera();
    info.views.left.intrinsics.distortion_model = model;
    info.views.left.intrinsics.distortion_coefficients = Array(count).fill(0);
    expect(parse({ front: info }).camera_info).toBeDefined();
  });
  const invalid: [string, (info: ReturnType<typeof camera>) => void][] = [
    [
      'zero image width',
      (c) => {
        c.width = 0;
      },
    ],
    [
      'fractional image height',
      (c) => {
        c.height = 480.5;
      },
    ],
    [
      'missing right eye',
      (c) => {
        Reflect.deleteProperty(c.views, 'right');
      },
    ],
    [
      'unknown view',
      (c) => {
        Object.assign(c.views, { other: view('left') });
      },
    ],
    [
      'repeated frame ID',
      (c) => {
        c.views.right.frame_id = c.views.left.frame_id;
      },
    ],
    [
      'region outside video',
      (c) => {
        c.views.right.image_region.x = 1000;
      },
    ],
    [
      'negative region origin',
      (c) => {
        c.views.left.image_region.y = -1;
      },
    ],
    [
      'overlapping eyes',
      (c) => {
        c.views.right.image_region.x = 0;
      },
    ],
    [
      'nonpositive focal length',
      (c) => {
        c.views.left.intrinsics.fx = 0;
      },
    ],
    [
      'invalid principal point',
      (c) => {
        c.views.left.intrinsics.cx = NaN;
      },
    ],
    [
      'unknown distortion',
      (c) => {
        c.views.left.intrinsics.distortion_model = 'unknown';
      },
    ],
    [
      'wrong distortion coefficients',
      (c) => {
        c.views.left.intrinsics.distortion_coefficients = [1];
      },
    ],
    [
      'self parent',
      (c) => {
        c.views.left.extrinsics.parent_frame_id = c.views.left.frame_id;
      },
    ],
    [
      'short translation',
      (c) => {
        c.views.left.extrinsics.translation = [0, 0];
      },
    ],
    [
      'nonfinite translation',
      (c) => {
        c.views.left.extrinsics.translation = [Infinity, 0, 0];
      },
    ],
    [
      'nonunit quaternion',
      (c) => {
        c.views.left.extrinsics.rotation_xyzw = [0, 0, 0, 0];
      },
    ],
  ];
  it.each(invalid)('rejects %s', (_name, mutate) => {
    const info = camera();
    mutate(info);
    expect(() => parse({ front: info })).toThrow();
  });
  it('rejects duplicate track declarations', () => {
    expect(() => parse({ front: camera(), duplicate: camera() })).toThrow('Repeated camera track');
  });
  it('allows the same physical camera frames on different video tracks', () => {
    const second = { ...camera(), track_name: 'another-resolution' };
    expect(parse({ front: camera(), resized: second }).camera_info?.resized).toEqual(second);
  });
  it('rejects a malformed map instead of ignoring camera metadata', () => {
    expect(() => parse(null)).toThrow('camera_info');
    expect(() => parse([])).toThrow('camera_info');
    expect(() => parse({ 'bad-id': camera() })).toThrow('local ID');
  });
  it('keeps publication discovery independent of camera declarations', async () => {
    const transport = new FixtureTransport();
    transport.config = { ...fixtureConfig, camera_info: { absent_camera: camera() } };
    const runtime = new WorkspaceRuntime(transport);
    transport.emit('connected');
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(runtime.discovery).toBe('ready');
    expect(runtime.config?.camera_info?.absent_camera.track_name).toBe('front-stereo');
    expect(runtime.catalog().some((p) => p.name === 'front-stereo')).toBe(false);
    expect([...transport.mediaDemand]).toEqual(['Front camera', 'Wrist camera']);
    await runtime.dispose();
  });
});
