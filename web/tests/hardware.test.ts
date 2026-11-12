import { describe, expect, it } from 'vitest';
import type { AdapterContext } from '../src/lib/teleop/controls';
import { discoveredHardwareAdapters } from '../src/lib/teleop/hardware-adapters';

const policy = () => ({
  version: 1,
  max_feedback_age_ms: 1000,
  operations: {
    base: {
      drive: {
        profile: 'base.twist.v1',
        control_channel: 'primary',
        max_linear_speed: 0.35,
        max_reverse_speed: 0.25,
        max_angular_speed: 1.5,
        command_timeout_ms: 500,
      },
    },
    head: {
      joint_position: {
        profile: 'joints.trajectory.v1',
        control_channel: 'primary',
        joint_names: ['pan_joint', 'tilt_joint'],
        units: 'rad',
        joints: {
          pan_joint: { min: -0.895, max: 1.005, max_velocity: 3.5 },
          tilt_joint: { min: -1.556, max: 0.481, max_velocity: 3.5 },
        },
      },
    },
  },
});
const discover = (hardware_control: unknown) =>
  discoveredHardwareAdapters(JSON.stringify({ schema_version: 1, hardware_control }));

const driveContext = (): AdapterContext => ({
  sessionKey: {},
  interfaceId: 'base',
  operationId: 'drive',
  equipment: { label: 'Rover', operations: {} },
  operation: {
    profile: 'base.twist.v1',
    command: { track_name: '/cmd_vel', msg_type: 'geometry_msgs/msg/Twist', format: 'json' },
    feedback_tracks: [],
  },
  feedback: {},
});
const headContext = (position = [0.1, -0.2]): AdapterContext => ({
  sessionKey: {},
  interfaceId: 'head',
  operationId: 'joint_position',
  equipment: { label: 'Camera head', joint_names: ['pan_joint', 'tilt_joint'], operations: {} },
  operation: {
    profile: 'joints.trajectory.v1',
    command: {
      track_name: '/head/joint_trajectory',
      msg_type: 'trajectory_msgs/msg/JointTrajectory',
      format: 'json',
    },
    feedback_tracks: ['/joint_states'],
  },
  feedback: { '/joint_states': { name: ['pan_joint', 'tilt_joint'], position } },
});
type Twist = {
  linear: { x: number; y: number; z: number };
  angular: { x: number; y: number; z: number };
};

describe('hardware_control discovery', () => {
  it('enables nothing without an explicit hardware_control block', () => {
    expect(discoveredHardwareAdapters(JSON.stringify({ schema_version: 1 })).size).toBe(0);
  });
  it('installs adapters only for the declared profiles', () => {
    expect([...discover(policy()).keys()].sort()).toEqual([
      'base.twist.v1',
      'joints.trajectory.v1',
    ]);
    const headOnly = policy() as { operations: Record<string, unknown> };
    delete headOnly.operations.base;
    expect([...discover(headOnly).keys()]).toEqual(['joints.trajectory.v1']);
  });
  it('rejects unknown versions, profiles, and invalid limits', () => {
    expect(() => discover({ ...policy(), version: 2 })).toThrow('version');
    expect(() => discover({ ...policy(), max_feedback_age_ms: 0 })).toThrow();
    expect(() => discover({ ...policy(), operations: {} })).toThrow('empty');
    const unknown = policy();
    (unknown.operations.base.drive as { profile: string }).profile = 'joints.velocity_jog.v1';
    expect(() => discover(unknown)).toThrow('Unsupported hardware_control profile');
    for (const [key, value] of [
      ['max_linear_speed', 0],
      ['max_linear_speed', 5],
      ['max_angular_speed', -1],
      ['command_timeout_ms', 100],
      ['command_timeout_ms', 5000],
      ['control_channel', 'Primary'],
    ] as const) {
      const bad = policy();
      (bad.operations.base.drive as Record<string, unknown>)[key] = value;
      expect(() => discover(bad), `${key}=${value}`).toThrow();
    }
    const inverted = policy();
    inverted.operations.head.joint_position.joints.pan_joint.min = 2;
    expect(() => discover(inverted)).toThrow('Invalid robot joint limits');
    const unbound = policy();
    unbound.operations.head.joint_position.joint_names = ['pan_joint'];
    expect(() => discover(unbound)).toThrow('binding');
    const degrees = policy();
    degrees.operations.head.joint_position.units = 'deg';
    expect(() => discover(degrees)).toThrow('rad');
  });
});

describe('hardware base.twist.v1 adapter', () => {
  it('sends neutral first, then scales input to the declared limits', () => {
    const a = discover(policy()).get('base.twist.v1')!;
    const ctx = driveContext();
    expect(a.encode({ axes: [1, 1] }, ctx)).toEqual({
      linear: { x: 0, y: 0, z: 0 },
      angular: { x: 0, y: 0, z: 0 },
    });
    const full = a.encode({ axes: [1, -1, 0] }, ctx) as Twist;
    expect(full.linear).toEqual({ x: 0.35, y: 0, z: 0 });
    expect(full.angular.z).toBeCloseTo(-1.5);
    expect((a.encode({ axes: [-1, 0] }, ctx) as Twist).linear.x).toBeCloseTo(-0.25);
    expect((a.encode({ axes: [0.5, 0] }, ctx) as Twist).linear.x).toBeCloseTo(0.175);
    // A differential base ignores the strafe axis.
    expect((a.encode({ axes: [0, 0, 1] }, ctx) as Twist).linear.y).toBe(0);
  });
  it('releases to zero and starts the next activation from neutral', () => {
    const a = discover(policy()).get('base.twist.v1')!;
    const ctx = driveContext();
    a.encode({ axes: [0, 0] }, ctx);
    expect(a.release(ctx)).toEqual({ linear: { x: 0, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } });
    expect((a.encode({ axes: [1, 0] }, ctx) as Twist).linear.x).toBe(0);
  });
  it('rejects out-of-range input and operations the robot did not declare', () => {
    const a = discover(policy()).get('base.twist.v1')!;
    const ctx = driveContext();
    a.encode({ axes: [0, 0] }, ctx);
    expect(() => a.encode({ axes: [1.5, 0] }, ctx)).toThrow('between -1 and 1');
    expect(() => a.encode({ joints: { pan_joint: 0 } }, ctx)).toThrow();
    expect(() => a.encode({ axes: [0, 0] }, { ...ctx, operationId: 'other' })).toThrow(
      'does not match',
    );
  });
});

describe('hardware joints.trajectory.v1 adapter', () => {
  it('exposes the robot joint limits for the sliders', () => {
    const a = discover(policy()).get('joints.trajectory.v1')!;
    expect(a.mandatoryFeedback).toBe('joints');
    expect(a.units).toContain('robot');
    expect(a.jointLimits!(headContext())).toEqual(policy().operations.head.joint_position.joints);
  });
  it('sends a paced single-point trajectory within the limits', () => {
    const a = discover(policy()).get('joints.trajectory.v1')!;
    const msg = a.encode({ joints: { pan_joint: 0.8 } }, headContext()) as {
      joint_names: string[];
      points: { positions: number[]; time_from_start: { sec: number; nanosec: number } }[];
    };
    expect(msg.joint_names).toEqual(['pan_joint', 'tilt_joint']);
    expect(msg.points).toHaveLength(1);
    // The joint without a target keeps its measured position.
    expect(msg.points[0].positions).toEqual([0.8, -0.2]);
    const seconds = msg.points[0].time_from_start.sec + msg.points[0].time_from_start.nanosec / 1e9;
    expect(seconds).toBeCloseTo((0.7 / 3.5) * 1.25 + 0.5, 6);
  });
  it('rejects targets outside the robot limits and releases with an empty trajectory', () => {
    const a = discover(policy()).get('joints.trajectory.v1')!;
    const ctx = headContext();
    expect(() => a.encode({ joints: { tilt_joint: 0.6 } }, ctx)).toThrow('robot limits');
    expect(() => a.encode({ joints: { wrist: 0 } }, ctx)).toThrow('Unknown joint');
    expect(a.release(ctx)).toEqual({ joint_names: ['pan_joint', 'tilt_joint'], points: [] });
  });
  it('requires fresh joint positions in the feedback', () => {
    const a = discover(policy()).get('joints.trajectory.v1')!;
    const ctx = headContext();
    ctx.feedback = { '/joint_states': { name: ['pan_joint'], position: [0] } };
    expect(() => a.validateFeedback(ctx.feedback['/joint_states'], ctx)).toThrow();
  });
});
