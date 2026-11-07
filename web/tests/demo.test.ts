import { describe, expect, it } from 'vitest';
import { simulationAdapters } from '../src/lib/demo/trajectory-adapter';
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
    required_feedback_tracks: ['/feedback'],
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
