import { describe, expect, it } from 'vitest';
import {
  discoveredSimulationAdapters,
  simulationAdapters,
} from '../src/lib/demo/trajectory-adapter';
import type { AdapterContext } from '../src/lib/teleop/controls';
import type { SimulationPolicy } from '../src/lib/demo/types';

const policy: SimulationPolicy = {
  profile: 'joints.trajectory.v1',
  max_feedback_age_ms: 1000,
  interfaces: {
    arm: {
      joint_a: { min: -1, max: 2, max_velocity: 0.5 },
      joint_b: { min: -2, max: 1, max_velocity: 0.25 },
    },
  },
};
const context = (): AdapterContext => ({
  equipment: {
    kind: 'arm',
    label: 'Arm',
    frame_id: 'base',
    joint_names: ['joint_a', 'joint_b'],
    operations: {},
  },
  operation: {
    profile: 'joints.trajectory.v1',
    command: {
      track_name: '/command',
      msg_type: 'trajectory_msgs/msg/JointTrajectory',
      format: 'json',
    },
    feedback_tracks: ['/feedback'],
    presentations: ['joint_sliders'],
  },
  feedback: {
    '/feedback': { name: ['joint_b', 'joint_a'], position: [0.1, 0.2], velocity: [], effort: [] },
  },
});

describe('managed simulation trajectory profile', () => {
  it('matches exact names, preserves omitted targets and uses timing within per-joint speed bounds', () => {
    const adapter = simulationAdapters(policy).get(policy.profile)!;
    const value = adapter.encode({ joints: { joint_a: 1.2 } }, context()) as {
      joint_names: string[];
      points: { positions: number[]; time_from_start: { sec: number; nanosec: number } }[];
      header?: unknown;
    };
    expect(value.header).toBeUndefined();
    expect(value.joint_names).toEqual(['joint_a', 'joint_b']);
    expect(value.points[0].positions).toEqual([1.2, 0.1]);
    expect(value.points[0].time_from_start.sec).toBeGreaterThanOrEqual(2);
    expect(adapter.release(context())).toEqual({ joint_names: ['joint_a', 'joint_b'], points: [] });
  });
  it('rejects out-of-bound targets, missing positions and mismatched policy names', () => {
    const adapter = simulationAdapters(policy).get(policy.profile)!;
    expect(() => adapter.encode({ joints: { joint_a: 2.1 } }, context())).toThrow('limits');
    const missing = context();
    missing.feedback = {};
    expect(() => adapter.validateFeedback({}, missing)).toThrow();
    const foreign = context();
    foreign.equipment.joint_names = ['foreign'];
    expect(() => adapter.jointLimits!(foreign)).toThrow('does not match');
  });
  it('rejects invalid trusted limits instead of falling back to fixture ranges', () => {
    const invalid = structuredClone(policy);
    invalid.interfaces.arm.joint_a.max_velocity = 0;
    expect(() => simulationAdapters(invalid)).toThrow('Invalid');
  });
});

it('keeps omitted measured positions inside soft joint boundaries without accepting invalid explicit targets', () => {
  const adapter = simulationAdapters(policy).get(policy.profile)!;
  const ctx = context();
  ctx.feedback = { '/feedback': { name: ['joint_a', 'joint_b'], position: [-1.00000001, 0.1] } };
  expect(
    (adapter.encode({}, ctx) as { points: { positions: number[] }[] }).points[0].positions[0],
  ).toBe(-1);
  expect(() => adapter.encode({ joints: { joint_a: -1.1 } }, ctx)).toThrow('limits');
});

it('requires an explicit supported simulator implementation and validates its policy', () => {
  expect(discoveredSimulationAdapters('{}').size).toBe(0);
  const payload = (implementation: string, value: unknown = policy) =>
    JSON.stringify({
      simulation_control: { implementation, policy: value },
    });
  expect(discoveredSimulationAdapters(payload('mujoco.joint_trajectory.v1')).size).toBe(1);
  expect(() => discoveredSimulationAdapters(payload('unknown'))).toThrow('implementation');
  expect(() => discoveredSimulationAdapters(payload('mujoco.joint_trajectory.v1', {}))).toThrow();
});

const positionPolicy = () => ({
  version: 2 as const,
  max_feedback_age_ms: 1000,
  operations: {
    left_arm: {
      gripper_position: {
        profile: 'gripper.position.v1' as const,
        control_channel: 'gripper',
        joint_names: ['grip'],
        units: 'm' as const,
        joints: { grip: { min: 0, max: 0.044, max_velocity: 0.025 } },
        coordinate_label: 'Finger displacement',
        open_position: 0.044,
        closed_position: 0,
      },
    },
  },
});
function gripperContext(): AdapterContext {
  const ctx = context();
  ctx.interfaceId = 'left_arm';
  ctx.operationId = 'gripper_position';
  ctx.sessionKey = {};
  ctx.operation = {
    ...ctx.operation,
    profile: 'gripper.position.v1',
    control_channel: 'gripper',
    joint_names: ['grip'],
    presentations: ['gripper_controls'],
  };
  ctx.feedback = { '/feedback': { name: ['grip', 'joint_a'], position: [0.02, 0.4] } };
  return ctx;
}
it('executes the explicit gripper capability with meters, separate names, finite motion and cancellation', () => {
  const adapters = discoveredSimulationAdapters(
    JSON.stringify({
      simulation_control: { implementation: 'mujoco.position.v2', policy: positionPolicy() },
    }),
  );
  const adapter = adapters.get('gripper.position.v1')!,
    ctx = gripperContext();
  expect(adapter.repeatIntervalMs).toBe(200);
  expect(adapter.gripperTargets!(ctx)).toEqual({
    open: 0.044,
    closed: 0,
    label: 'Finger displacement',
  });
  expect(adapter.encode({ joints: { grip: 0.04 } }, ctx)).toMatchObject({
    joint_names: ['grip'],
    points: [{ positions: [0.04] }],
  });
  expect(adapter.release(ctx)).toEqual({ joint_names: ['grip'], points: [] });
  expect(() => adapter.encode({ joints: { joint_a: 1 } }, ctx)).toThrow('Unknown joint');
  expect(() => adapter.encode({ joints: { grip: 0.05 } }, ctx)).toThrow('limits');
  expect(() => adapter.jointLimits!({ ...ctx, interfaceId: 'right_arm' })).toThrow(
    'does not match',
  );
  expect(() =>
    adapter.validateFeedback(
      {},
      { ...ctx, feedback: { '/feedback': { name: ['joint_a'], position: [0] } } },
    ),
  ).toThrow();
});
it('rejects invalid gripper units, endpoint targets and policy versions', () => {
  for (const mutate of [
    (p: ReturnType<typeof positionPolicy>) => {
      p.operations.left_arm.gripper_position.open_position = 0.1;
    },
    (p: ReturnType<typeof positionPolicy>) => {
      Object.assign(p.operations.left_arm.gripper_position, { units: 'rad' });
    },
    (p: ReturnType<typeof positionPolicy>) => {
      Object.assign(p, { version: 3 });
    },
  ]) {
    const p = positionPolicy();
    mutate(p);
    expect(() => simulationAdapters(p)).toThrow();
  }
});
it('does not carry a prior target into another gripper session', () => {
  const adapter = simulationAdapters(positionPolicy()).get('gripper.position.v1')!;
  const first = gripperContext(),
    second = gripperContext();
  adapter.encode({ joints: { grip: 0.044 } }, first);
  second.feedback = { '/feedback': { name: ['grip'], position: [0] } };
  const value = adapter.encode({ joints: { grip: 0 } }, second) as {
    points: { time_from_start: { sec: number; nanosec: number } }[];
  };
  expect(value.points[0].time_from_start).toEqual({ sec: 0, nanosec: 500000000 });
});
