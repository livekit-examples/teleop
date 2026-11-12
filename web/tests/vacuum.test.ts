import { describe, expect, it } from 'vitest';
import {
  discoveredSimulationAdapters,
  simulationAdapters,
} from '../src/lib/demo/trajectory-adapter';
import type { VacuumPolicy } from '../src/lib/demo/types';
import type { AdapterContext } from '../src/lib/teleop/controls';

const policy: VacuumPolicy = {
  version: 1,
  kind: 'vacuum.twist.v1',
  interface_id: 'base',
  operation_id: 'drive',
  command_track: '/cmd_vel',
  profile: 'base.twist.v1',
  control_channel: 'primary',
  min_speed: -0.25,
  max_speed: 0.45,
  max_yaw_rate: 1.8,
  precision_max_speed: 0.15,
  max_acceleration: 0.8,
  command_timeout_ms: 150,
  input_interval_ms: 20,
  input_deadband: 0.08,
  input_exponent: 2,
  neutral: 'brake',
  state_track: '/run_state',
};
const context = (): AdapterContext => ({
  sessionKey: {},
  interfaceId: 'base',
  operationId: 'drive',
  equipment: { label: 'Vacuum', operations: {} },
  operation: {
    profile: policy.profile,
    command: { track_name: '/cmd_vel', msg_type: 'geometry_msgs/msg/Twist', format: 'json' },

    feedback_tracks: [],
  },
  feedback: {},
});
type Twist = {
  linear: { x: number; y: number; z: number };
  angular: { x: number; y: number; z: number };
};
const adapter = () => simulationAdapters(policy).get(policy.profile)!;

describe('vacuum Twist adapter', () => {
  it('sends neutral first, then forward speed and yaw rate within the policy limits', () => {
    const a = adapter();
    const ctx = context();
    expect(a.encode({ axes: [1, 1] }, ctx)).toEqual({
      linear: { x: 0, y: 0, z: 0 },
      angular: { x: 0, y: 0, z: 0 },
    });
    const full = a.encode({ axes: [1, 1] }, ctx) as Twist;
    expect(full.linear).toEqual({ x: 0.45, y: 0, z: 0 });
    expect(full.angular.z).toBeCloseTo(1.8);
    const reverse = a.encode({ axes: [-1, 0] }, ctx) as Twist;
    expect(reverse.linear.x).toBeCloseTo(-0.25);
  });
  it('ignores the deadband and responds progressively near the center', () => {
    const a = adapter();
    const ctx = context();
    a.encode({ axes: [0, 0] }, ctx);
    expect((a.encode({ axes: [0.05, -0.05] }, ctx) as Twist).linear.x).toBe(0);
    const half = a.encode({ axes: [0.5, 0] }, ctx) as Twist;
    expect(half.linear.x).toBeGreaterThan(0);
    expect(half.linear.x).toBeLessThan(0.45 * 0.5);
  });
  it('limits speed to the precision value for chair passages', () => {
    const a = adapter();
    const ctx = context();
    a.encode({ axes: [0, 0, 1] }, ctx);
    expect((a.encode({ axes: [1, 0, 1] }, ctx) as Twist).linear.x).toBeCloseTo(0.15);
    expect((a.encode({ axes: [-1, 0, 1] }, ctx) as Twist).linear.x).toBeCloseTo(-0.15);
  });
  it('rejects sideways input, out-of-range values and extra axes', () => {
    const a = adapter();
    const ctx = context();
    a.encode({ axes: [0, 0] }, ctx);
    expect(() => a.encode({ axes: [0, 0, 0.5] }, ctx)).toThrow();
    expect(() => a.encode({ axes: [0, 0, 0, 1] }, ctx)).toThrow();
    expect(() => a.encode({ axes: [2, 0] }, ctx)).toThrow();
    expect(() => a.encode({ axes: [Number.NaN, 0] }, ctx)).toThrow();
    expect(() => a.encode({ joints: { a: 1 } }, ctx)).toThrow();
  });
  it('releases to a zero command and sends neutral again after release', () => {
    const a = adapter();
    const ctx = context();
    a.encode({ axes: [0, 0] }, ctx);
    expect((a.release(ctx) as Twist).linear.x).toBe(0);
    expect((a.encode({ axes: [1, 0] }, ctx) as Twist).linear.x).toBe(0);
  });
  it('refuses a policy that does not match the operation or has unsafe limits', () => {
    const ctx = context();
    ctx.operation.command.track_name = '/other';
    expect(() => adapter().encode({ axes: [0, 0] }, ctx)).toThrow();
    expect(() => simulationAdapters({ ...policy, max_speed: 5 })).toThrow();
    expect(() => simulationAdapters({ ...policy, command_timeout_ms: 40 })).toThrow();
    expect(() => simulationAdapters({ ...policy, precision_max_speed: 0.9 })).toThrow();
  });
  it('is selected only by an explicit simulation_control implementation', () => {
    const found = discoveredSimulationAdapters(
      JSON.stringify({
        simulation_control: { implementation: 'vacuum.twist.v1', policy },
      }),
    );
    expect(found.has('base.twist.v1')).toBe(true);
    expect(discoveredSimulationAdapters(JSON.stringify({})).size).toBe(0);
  });
});
