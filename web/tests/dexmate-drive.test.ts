import { describe, expect, it } from 'vitest';
import {
  discoveredSimulationAdapters,
  simulationAdapters,
} from '../src/lib/demo/trajectory-adapter';
import type { DriveCapability, PositionSimulationPolicy } from '../src/lib/demo/types';
import type { AdapterContext } from '../src/lib/teleop/controls';

const drive: DriveCapability = {
  profile: 'base.holonomic_twist.v1',
  control_channel: 'primary',
  units: 'm/s · rad/s',
  command_track: '/cmd_vel',
  min_linear_x: -0.3,
  max_linear_x: 0.6,
  max_linear_y: 0.4,
  max_yaw_rate: 1.0,
  max_acceleration: 0.8,
  max_yaw_acceleration: 2.0,
  command_timeout_ms: 300,
  input_interval_ms: 50,
  neutral: 'brake',
};
const policy: PositionSimulationPolicy = {
  version: 2,
  max_feedback_age_ms: 1000,
  operations: {
    head: {
      joint_position: {
        profile: 'joints.trajectory.v1',
        control_channel: 'primary',
        joint_names: ['head_j1'],
        units: 'rad',
        joints: { head_j1: { min: -1, max: 1, max_velocity: 3 } },
      },
    },
    base: { drive },
  },
};
const context = (overrides: Partial<AdapterContext> = {}): AdapterContext => ({
  sessionKey: {},
  interfaceId: 'base',
  operationId: 'drive',
  equipment: { label: 'Base', operations: {} },
  operation: {
    profile: 'base.holonomic_twist.v1',
    command: { track_name: '/cmd_vel', msg_type: 'geometry_msgs/msg/Twist', format: 'json' },
    feedback_tracks: ['/base/joint_states'],
  },
  feedback: {},
  ...overrides,
});
type Twist = {
  linear: { x: number; y: number; z: number };
  angular: { x: number; y: number; z: number };
};

describe('simulated holonomic base', () => {
  it('keeps the joint adapters and adds a Twist adapter for the base', () => {
    const adapters = simulationAdapters(policy);
    expect(adapters.has('joints.trajectory.v1')).toBe(true);
    expect(adapters.get('base.holonomic_twist.v1')?.repeatIntervalMs).toBe(50);
  });

  it('sends neutral first, then forward, strafe and yaw within the limits', () => {
    const a = simulationAdapters(policy).get('base.holonomic_twist.v1')!;
    const ctx = context();
    expect(a.encode({ axes: [1, 1, 1] }, ctx)).toEqual({
      linear: { x: 0, y: 0, z: 0 },
      angular: { x: 0, y: 0, z: 0 },
    });
    const full = a.encode({ axes: [1, 1, 1] }, ctx) as Twist;
    expect(full.linear.x).toBeCloseTo(0.6);
    expect(full.linear.y).toBeCloseTo(0.4);
    expect(full.angular.z).toBeCloseTo(1.0);
    const back = a.encode({ axes: [-1, 0, -1] }, ctx) as Twist;
    expect(back.linear.x).toBeCloseTo(-0.3);
    expect(back.linear.y).toBeCloseTo(-0.4);
    expect(a.encode({ axes: [0.05, 0, 0] }, ctx)).toEqual(a.release(ctx));
    expect(() => a.encode({ axes: [2, 0, 0] }, ctx)).toThrow();
  });

  it('refuses an operation the policy does not describe', () => {
    const a = simulationAdapters(policy).get('base.holonomic_twist.v1')!;
    expect(() => a.encode({ axes: [0, 0, 0] }, context({ operationId: 'other' }))).toThrow();
  });

  it('rejects invalid drive limits', () => {
    const bad = {
      ...policy,
      operations: { base: { drive: { ...drive, input_interval_ms: 200 } } },
    };
    expect(() => simulationAdapters(bad)).toThrow(/timing/);
    const sideways = {
      ...policy,
      operations: { base: { drive: { ...drive, profile: 'base.twist.v1' as const } } },
    };
    expect(() => simulationAdapters(sideways)).toThrow();
  });

  it('is enabled by the mujoco.position.v2 discovery extension', () => {
    const payload = JSON.stringify({
      simulation_control: { implementation: 'mujoco.position.v2', policy },
    });
    expect(discoveredSimulationAdapters(payload).has('base.holonomic_twist.v1')).toBe(true);
  });
});
