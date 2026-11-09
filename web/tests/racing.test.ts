import { describe, expect, it } from 'vitest';
import {
  discoveredSimulationAdapters,
  simulationAdapters,
} from '../src/lib/demo/trajectory-adapter';
import type { RacingPolicy } from '../src/lib/demo/types';
import type { AdapterContext } from '../src/lib/teleop/controls';
import { KeyboardSteering } from '../src/lib/teleop/keyboard-steering';

const policy: RacingPolicy = {
  version: 1,
  kind: 'rc.ackermann.v1',
  profile: 'base.ackermann_drive.v1',
  interface_id: 'base',
  operation_id: 'drive',
  command_track: '/ackermann_cmd',
  control_channel: 'primary',
  min_speed: -5,
  max_speed: 8,
  max_steering_angle: 0.4189,
  max_steering_rate: 3.2,
  steering_input_exponent: 2,
  max_acceleration: 9.51,
  max_braking: 9.51,
  command_timeout_ms: 150,
  input_interval_ms: 20,
  neutral: 'brake_and_center',
  state_track: '/vehicle_state',
};
const context = (): AdapterContext => ({
  sessionKey: {},
  interfaceId: 'base',
  operationId: 'drive',
  equipment: { label: 'Car', operations: {} },
  operation: {
    profile: policy.profile,
    command: {
      track_name: policy.command_track,
      msg_type: 'ackermann_msgs/msg/AckermannDrive',
      format: 'json',
    },
    presentations: ['gamepad', 'keyboard', 'joystick'],
    feedback_tracks: [],
  },
  feedback: {},
});

describe('Ackermann keyboard steering', () => {
  it('makes short key taps small turns instead of full-lock commands', () => {
    const keyboard = new KeyboardSteering();
    const adapter = simulationAdapters(policy).get(policy.profile)!;
    const ctx = context();
    adapter.encode({ axes: [0, 0] }, ctx);
    let input = 0;
    for (let i = 0; i < 15; i++) input = keyboard.sample(1, 20);
    const command = adapter.encode({ axes: [1, input] }, ctx) as {
      speed: number;
      steering_angle: number;
    };
    expect(command.speed).toBe(8);
    expect((command.steering_angle * 180) / Math.PI).toBeGreaterThan(1);
    expect((command.steering_angle * 180) / Math.PI).toBeLessThan(1.5);
    for (let i = 0; i < 10; i++) input = keyboard.sample(0, 20);
    expect(input).toBe(0);
  });
  it('retains full steering for held keys and returns through center on reversal', () => {
    const keyboard = new KeyboardSteering();
    let input = 0;
    for (let i = 0; i < 75; i++) input = keyboard.sample(1, 20);
    expect(input).toBe(1);
    const trace: number[] = [];
    for (let i = 0; i < 100; i++) trace.push(keyboard.sample(-1, 20));
    expect(trace).toContain(0);
    expect(trace.at(-1)).toBe(-1);
    keyboard.reset();
    expect(keyboard.sample(0, 20)).toBe(0);
  });
  it('depends on elapsed time and caps stale timer gaps', () => {
    const fast = new KeyboardSteering(),
      slow = new KeyboardSteering();
    let a = 0,
      b = 0;
    for (let i = 0; i < 20; i++) a = fast.sample(1, 20);
    for (let i = 0; i < 8; i++) b = slow.sample(1, 50);
    expect(a).toBeCloseTo(b);
    const stale = new KeyboardSteering();
    expect(stale.sample(1, 5000)).toBeCloseTo(0.04);
    expect(stale.sample(1, -100)).toBeCloseTo(0.04);
  });
});

describe('RC driving adapter', () => {
  it('uses identical validated capabilities for manual and managed sessions', () => {
    const discovered = discoveredSimulationAdapters(
      JSON.stringify({ simulation_control: { implementation: policy.kind, policy } }),
    );
    expect(discovered.get(policy.profile)?.repeatIntervalMs).toBe(20);
    expect(simulationAdapters(policy).get(policy.profile)?.telemetryTrack).toBe('/vehicle_state');
  });
  it('sends neutral first, maps SI units, brakes on release and resets first-frame state', () => {
    const a = simulationAdapters(policy).get(policy.profile)!;
    const ctx = context();
    expect(a.encode({ axes: [1, 1] }, ctx)).toMatchObject({ speed: 0, steering_angle: 0 });
    expect(a.encode({ axes: [1, 1] }, ctx)).toMatchObject({ speed: 8, steering_angle: 0.4189 });
    expect(a.encode({ axes: [-1, -1] }, ctx)).toMatchObject({ speed: -5, steering_angle: -0.4189 });
    expect(a.release(ctx)).toMatchObject({ speed: 0, steering_angle: 0 });
    expect(a.encode({ axes: [1, 1] }, ctx)).toMatchObject({ speed: 0, steering_angle: 0 });
  });
  it('rejects malformed limits, timing, input and mismatched operation bindings', () => {
    for (const change of [
      { max_speed: 21 },
      { min_speed: -6 },
      { max_steering_angle: NaN },
      { input_interval_ms: 100 },
      { command_timeout_ms: 30 },
      { neutral: 'coast' },
      { interface_id: 'arm' },
      { steering_input_exponent: NaN },
      { steering_input_exponent: 0.5 },
      { steering_input_exponent: 4 },
    ])
      expect(() => simulationAdapters({ ...policy, ...change } as RacingPolicy)).toThrow();
    const a = simulationAdapters(policy).get(policy.profile)!;
    const ctx = context();
    for (const axes of [
      [2, 0],
      [0, NaN],
      [0, 0, 1],
    ])
      expect(() => a.encode({ axes }, ctx)).toThrow();
    ctx.operation.command.track_name = '/wrong';
    expect(() => a.encode({ axes: [1, 0] }, ctx)).toThrow('does not match');
  });
  it('provides fine analog steering near center while retaining both full-lock angles', () => {
    const a = simulationAdapters(policy).get(policy.profile)!;
    const ctx = context();
    a.encode({ axes: [0, 0] }, ctx);
    const angle = (steering: number) =>
      (a.encode({ axes: [0, steering] }, ctx) as { steering_angle: number }).steering_angle;
    expect(angle(0)).toBe(0);
    expect(angle(0.25)).toBeCloseTo(0.4189 / 16);
    expect(angle(-0.25)).toBeCloseTo(-0.4189 / 16);
    expect(angle(0.5)).toBeCloseTo(0.4189 / 4);
    expect(angle(1)).toBe(0.4189);
    expect(angle(-1)).toBe(-0.4189);
  });
  it('keeps a linear mapping for older policies without an input curve', () => {
    const legacy = { ...policy };
    delete legacy.steering_input_exponent;
    const a = simulationAdapters(legacy).get(policy.profile)!;
    const ctx = context();
    a.encode({ axes: [0, 0] }, ctx);
    expect(a.encode({ axes: [0, 0.25] }, ctx)).toMatchObject({ steering_angle: 0.4189 * 0.25 });
  });
});
