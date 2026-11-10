import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceRuntime } from '../src/lib/teleop/runtime';
import {
  HandTeleop,
  defaultHandSettings,
  type Sighting,
} from '../src/lib/teleop/hands/hand-teleop';
import {
  fromAxisAngle,
  norm,
  sub,
  toRotvec,
  turnBetween,
  type M3,
  type V3,
} from '../src/lib/teleop/hands/linalg';
import {
  ArmFollower,
  Clutch,
  HandSize,
  OneEuro,
  assignSides,
  curl,
  defaultMapping,
  gripFraction,
  handPose,
  palmPosition,
  palmRotation,
  type Hand,
} from '../src/lib/teleop/hands/math';

const FOCAL = 457;
const CENTRE: [number, number] = [320, 240];

/** A right hand, palm to the lens, fingers up (camera -y), about its palm's centre, in metres. */
function handWorld(curled = true, pinchM = 0.08): V3[] {
  const w: V3[] = Array.from({ length: 21 }, () => [0, 0, 0] as V3);
  w[0] = [0, 0.04, 0];
  for (const [base, x] of [
    [5, -0.025],
    [9, 0],
    [13, 0.02],
    [17, 0.038],
  ] as [number, number][]) {
    w[base] = [x, -0.05, 0];
    const straight = base === 5 || !curled;
    for (const k of [1, 2, 3])
      w[base + k] = straight ? [x, -0.05 - 0.03 * k, 0] : [x, -0.05 + 0.012 * k, -0.025];
  }
  for (const k of [1, 2, 3]) w[k] = [-0.03 - 0.01 * k, 0.03 - 0.02 * k, 0];
  w[4] = [w[8][0] - pinchM, w[8][1], w[8][2]];
  const palm = [0, 5, 9, 13, 17].map((i) => w[i]);
  const c: V3 = [
    palm.reduce((s, p) => s + p[0], 0) / 5,
    palm.reduce((s, p) => s + p[1], 0) / 5,
    palm.reduce((s, p) => s + p[2], 0) / 5,
  ];
  return w.map((p) => sub(p, c));
}
function project(world: V3[], at: V3, label: 'left' | 'right' = 'right'): Hand {
  const points = world.map((p) => [p[0] + at[0], p[1] + at[1], p[2] + at[2]] as V3);
  return {
    label,
    image: points.map((p) => [
      (p[0] / p[2]) * FOCAL + CENTRE[0],
      (p[1] / p[2]) * FOCAL + CENTRE[1],
    ]),
    world,
  };
}

describe('hand maths', () => {
  it('finds a palm at its true position from a pinhole projection', () => {
    const at: V3 = [0.05, -0.02, 0.5];
    const hand = project(handWorld(), at);
    const found = palmPosition(hand.image, hand.world, FOCAL, CENTRE)!;
    expect(norm(sub(found, at))).toBeLessThan(0.005);
  });

  it('reads curled fingers below 1 and straight ones above the open threshold', () => {
    expect(curl(handWorld(true)).every((c) => c < 1)).toBe(true);
    expect(curl(handWorld(false)).every((c) => c > 1.15)).toBe(true);
  });

  it('turns the palm axes with the hand', () => {
    const base = handWorld();
    const turn = fromAxisAngle([0, 0, 1], 0.5);
    const turned = base.map(
      (p) =>
        [
          turn[0] * p[0] + turn[1] * p[1] + turn[2] * p[2],
          turn[3] * p[0] + turn[4] * p[1] + turn[5] * p[2],
          turn[6] * p[0] + turn[7] * p[1] + turn[8] * p[2],
        ] as V3,
    );
    expect(turnBetween(palmRotation(base), palmRotation(turned))).toBeCloseTo(0.5, 2);
  });

  it('closes the clutch after three curled frames and opens it after two open ones', () => {
    const clutch = new Clutch();
    const curled: V3 = [0.5, 0.5, 0.5];
    const open: V3 = [1.8, 1.8, 1.8];
    expect([clutch.update(curled), clutch.update(curled), clutch.update(curled)]).toEqual([
      false,
      false,
      true,
    ]);
    expect([clutch.update(open), clutch.update(open)]).toEqual([true, false]);
    clutch.update(curled);
    clutch.update(curled);
    clutch.update(curled);
    expect(clutch.update(null)).toBe(false);
  });

  it('assigns hands by label, and by position when both carry one label', () => {
    const w = handWorld();
    const a = project(w, [-0.1, 0, 0.5], 'right');
    const b = project(w, [0.1, 0, 0.5], 'right');
    const sides = assignSides([b, a]);
    expect(sides.right).toBe(a);
    expect(sides.left).toBe(b);
    const swapped = assignSides([project(w, [0, 0, 0.5], 'left')], true);
    expect(swapped.right).toBeDefined();
  });

  it('keeps the median palm size', () => {
    const size = new HandSize(3);
    for (const s of [1, 1, 1])
      size.add(handWorld().map((p) => [p[0] * s, p[1] * s, p[2] * s] as V3));
    const first = size.value!;
    size.add(handWorld().map((p) => [p[0] * 5, p[1] * 5, p[2] * 5] as V3));
    expect(size.value).toBeCloseTo(first, 6);
  });

  it('maps the pinch to a gripper opening', () => {
    const m = defaultMapping();
    expect(gripFraction(m, 0.02)).toBe(0);
    expect(gripFraction(m, 0.2)).toBe(1);
    expect(gripFraction(m, 0.06)).toBeCloseTo(0.5);
  });

  it('smooths a still input and follows a moving one', () => {
    const f = new OneEuro(1, 4);
    f.call([0], 0);
    expect(f.call([1], 0.033)[0]).toBeLessThan(1);
  });
});

describe('ArmFollower', () => {
  const pose = (at: number, position: V3, rotation: M3 = fromAxisAngle([0, 0, 1], 0)) => ({
    at,
    position,
    rotation,
    pinch: 0.09,
    curl: [0.5, 0.5, 0.5] as V3,
  });
  const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const start = { position: [0.3, 0, 0.2] as V3, rotation: identity };
  const settle = (f: ArmFollower, from: number, to: number, z = 0.5) => {
    let t = from;
    while (t < to) {
      t += 1 / 30;
      f.observe(pose(t, [0, 0, z]));
      f.goal(1 / 30);
    }
    return t;
  };

  it('holds still for a still hand', () => {
    const f = new ArmFollower(defaultMapping({ frame: 'base' }));
    let t = 0;
    for (let i = 0; i < 20; i++) f.observe(pose((t += 1 / 30), [0, 0, 0.5]));
    f.engage(start, 1);
    t = settle(f, t, t + 1);
    expect(norm(f.moved())).toBeLessThan(1e-6);
  });

  it('moves the target by the hand motion since the grip, never to where the hand is', () => {
    const f = new ArmFollower(defaultMapping({ frame: 'base', fine_scale: 1 }));
    let t = 0;
    for (let i = 0; i < 20; i++) f.observe(pose((t += 1 / 30), [0.2, 0.1, 0.5]));
    f.engage(start, 1);
    // The hand goes 5 cm toward the lens: base +x is forward.
    for (let i = 1; i <= 60; i++) {
      t += 1 / 30;
      f.observe(pose(t, [0.2, 0.1, 0.5 - (0.05 * i) / 60]));
      f.goal(1 / 30);
    }
    for (let i = 0; i < 90; i++) {
      t += 1 / 30;
      f.observe(pose(t, [0.2, 0.1, 0.45]));
      f.goal(1 / 30);
    }
    const moved = f.moved();
    expect(moved[0]).toBeGreaterThan(0.02);
    expect(moved[0]).toBeLessThan(0.06);
    expect(Math.abs(moved[1])).toBeLessThan(0.005);
  });

  it('ignores a turn smaller than the deadband and follows a larger one', () => {
    const f = new ArmFollower(defaultMapping({ frame: 'base' }));
    let t = 0;
    for (let i = 0; i < 20; i++) f.observe(pose((t += 1 / 30), [0, 0, 0.5]));
    f.engage(start, 1);
    const turnBy = (deg: number) => {
      const r = fromAxisAngle([0, 0, 1], (deg * Math.PI) / 180);
      for (let i = 0; i < 120; i++) {
        t += 1 / 30;
        f.observe(pose(t, [0, 0, 0.5], r));
        f.goal(1 / 30);
      }
    };
    turnBy(3);
    expect(f.turned()).toBeLessThan(0.01);
    turnBy(40);
    expect(f.turned()).toBeGreaterThan(0.4);
    expect(toRotvec(identity)).toEqual([0, 0, 0]);
  });

  it('holds the gripper until the pinch reaches it', () => {
    const f = new ArmFollower(defaultMapping({ frame: 'base' }));
    let t = 0;
    for (let i = 0; i < 20; i++) f.observe(pose((t += 1 / 30), [0, 0, 0.5]));
    f.engage(start, 0.2); // the gripper is nearly closed, the pinch is wide open
    f.goal(1 / 30);
    expect(f.gripWaiting).toBe(true);
    expect(f.grip).toBe(0.2);
  });
});

describe('HandTeleop', () => {
  const robotPose = {
    position: { x: 0.3, y: 0, z: 0.2 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
  };
  function setup(armed = true, presentation = 'hand_tracking') {
    const sent: unknown[] = [];
    const state = { armed, presentation };
    const runtime = {
      handStatus: {},
      notify() {},
      layout: { tracked_hands: { right: 'arm' } },
      controls: {
        session: (id: string) => (id === 'arm' ? state : undefined),
        operation: () => ({ profile: 'arm.cartesian_pose.v1' }),
        context: () => ({ feedback: { pose: { pose: robotPose } } }),
        send: (_id: string, input: unknown) => {
          sent.push(input);
          return true;
        },
        adapter: () => undefined,
      },
    } as unknown as WorkspaceRuntime;
    const teleop = new HandTeleop(runtime, () => ({ ...defaultHandSettings, frame: 'base' }));
    let seq = 0;
    const frame = (ms: number, hands: Hand[]): Sighting => ({
      seq: ++seq,
      at: ms,
      width: 640,
      height: 480,
      hands,
    });
    return { teleop, state, sent, frame, runtime };
  }
  const gripped = (z = 0.5) => project(handWorld(true), [0, 0, z]);
  const open = (z = 0.5) => project(handWorld(false), [0, 0, z]);

  function run(
    t: { teleop: HandTeleop; frame: ReturnType<typeof setup>['frame'] },
    from: number,
    frames: number,
    hand: () => Hand,
  ) {
    let now = from;
    for (let i = 0; i < frames; i++) {
      now += 33;
      t.teleop.update(now, t.frame(now, [hand()]));
    }
    return now;
  }

  it('sends nothing for an interface that is not armed', () => {
    const t = setup(false);
    run(t, 0, 20, gripped);
    expect(t.sent).toEqual([]);
  });

  it('sends nothing for another presentation', () => {
    const t = setup(true, 'vr');
    run(t, 0, 20, gripped);
    expect(t.sent).toEqual([]);
  });

  it('ignores a grip that was held while the interface became armed', () => {
    const t = setup(false);
    let now = run(t, 0, 10, gripped);
    t.state.armed = true;
    now = run(t, now, 20, gripped);
    expect(t.sent).toEqual([]);
    now = run(t, now, 10, open);
    now = run(t, now, 10, gripped);
    expect(t.sent.length).toBeGreaterThan(0);
  });

  it('follows the hand after a grip, and holds the robot pose on release', () => {
    const t = setup();
    let now = run(t, 0, 10, open);
    now = run(t, now, 10, gripped);
    const sentWhileHeld = t.sent.length;
    expect(sentWhileHeld).toBeGreaterThan(0);
    const first = t.sent[0] as { pose: { position: { x: number } } };
    expect(first.pose.position.x).toBeCloseTo(0.3, 2);
    now = run(t, now, 5, () => open());
    expect(t.sent.at(-1)).toEqual({ pose: robotPose });
  });

  it('lets go when the webcam stalls', () => {
    const t = setup();
    let now = run(t, 0, 10, open);
    now = run(t, now, 10, gripped);
    const before = t.sent.length;
    t.teleop.update(now + 1000, null);
    expect(t.sent.length).toBe(before + 1);
    expect(t.sent.at(-1)).toEqual({ pose: robotPose });
  });

  it('lets go on a tracking jump', () => {
    const t = setup();
    let now = run(t, 0, 10, open);
    now = run(t, now, 10, gripped);
    t.teleop.update((now += 33), t.frame(now, [project(handWorld(true), [0.3, 0, 0.5])]));
    expect(t.runtime.handStatus).toBeDefined();
    const last = t.sent.at(-1);
    expect(last).toEqual({ pose: robotPose });
  });
});

describe('hand tracking video in the camera deck', () => {
  it('joins the live cameras once frames arrive, and leaves quietly', async () => {
    const { CameraDeck } = await import('../src/lib/teleop/cameras');
    const { HAND_CAMERA_ID } = await import('../src/lib/teleop/hands/bindings');
    const deck = new CameraDeck();
    deck.add('robot-camera', 'Overhead', 0);
    deck.frame('robot-camera', 1);
    deck.add(HAND_CAMERA_ID, 'Hand tracking', 2);
    expect(deck.pending()).toEqual([HAND_CAMERA_ID]);
    deck.frame(HAND_CAMERA_ID, 3);
    expect(deck.tiles).toEqual([HAND_CAMERA_ID]);
    deck.select(HAND_CAMERA_ID);
    expect(deck.main).toBe(HAND_CAMERA_ID);
    deck.remove(HAND_CAMERA_ID, true);
    expect(deck.main).toBe('robot-camera');
    expect(deck.notice).toBe('');
  });
});
