import { controlProfiles } from '../teleop/control-profiles';
import type { AdapterContext, ProfileAdapter } from '../teleop/controls';
import type { VacuumPolicy } from './types';
import { object } from '../teleop/validation';

/** Explicit vacuum implementation: differential drive through `base.twist.v1` Twist JSON. */
export function vacuumAdapters(raw: unknown): Map<string, ProfileAdapter> {
  const p = object(raw, 'Vacuum driving policy');
  if (
    p.version !== 1 ||
    p.kind !== 'vacuum.twist.v1' ||
    p.profile !== 'base.twist.v1' ||
    p.control_channel !== 'primary' ||
    p.interface_id !== 'base' ||
    p.operation_id !== 'drive' ||
    p.command_track !== '/cmd_vel' ||
    p.state_track !== '/run_state' ||
    p.neutral !== 'brake'
  )
    throw new Error('Unsupported vacuum driving policy.');
  const positive = (key: string, max: number) => {
    const value = p[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > max)
      throw new Error(`Invalid vacuum driving limit: ${key}.`);
    return value;
  };
  positive('max_speed', 1);
  positive('max_yaw_rate', 3);
  positive('precision_max_speed', 1);
  positive('max_acceleration', 2);
  positive('command_timeout_ms', 250);
  positive('input_interval_ms', 50);
  if (
    typeof p.min_speed !== 'number' ||
    !Number.isFinite(p.min_speed) ||
    p.min_speed >= 0 ||
    p.min_speed < -(p.max_speed as number) ||
    (p.precision_max_speed as number) > (p.max_speed as number) ||
    (p.input_interval_ms as number) * 3 > (p.command_timeout_ms as number)
  )
    throw new Error('Invalid vacuum speed or command timing policy.');
  // Small stick movements near the center are ignored, then the response grows progressively.
  const deadband = p.input_deadband ?? 0.08;
  const exponent = p.input_exponent ?? 2;
  if (
    typeof deadband !== 'number' ||
    !Number.isFinite(deadband) ||
    deadband < 0 ||
    deadband >= 0.5 ||
    typeof exponent !== 'number' ||
    !Number.isFinite(exponent) ||
    exponent < 1 ||
    exponent > 3
  )
    throw new Error('Invalid vacuum input curve.');
  const policy = p as VacuumPolicy;
  const match = (ctx: AdapterContext) => {
    if (
      ctx.interfaceId !== policy.interface_id ||
      ctx.operationId !== policy.operation_id ||
      ctx.operation.profile !== policy.profile ||
      ctx.operation.command.track_name !== policy.command_track ||
      ctx.operation.command.msg_type !== 'geometry_msgs/msg/Twist' ||
      ctx.operation.command.format !== 'json' ||
      (ctx.operation.control_channel ?? 'primary') !== policy.control_channel
    )
      throw new Error('Vacuum driving policy does not match this operation.');
  };
  const axis = (value = 0) => {
    if (!Number.isFinite(value) || Math.abs(value) > 1)
      throw new Error('Driving input must be between -1 and 1.');
    return value;
  };
  const shape = (value: number) => {
    const size = Math.abs(value);
    if (size <= deadband) return 0;
    return Math.sign(value) * ((size - deadband) / (1 - deadband)) ** exponent;
  };
  const twist = (x: number, z: number) => ({
    linear: { x, y: 0, z: 0 },
    angular: { x: 0, y: 0, z },
  });
  const initialized = new WeakSet<object>();
  const adapter: ProfileAdapter = {
    profile: policy.profile,
    msgType: controlProfiles[policy.profile].msgType,
    units: `m/s · rad/s · forward limit ${policy.max_speed} m/s`,
    maxFeedbackAgeMs: 1000,
    repeatIntervalMs: policy.input_interval_ms,
    validateFeedback: (_value, ctx) => match(ctx),
    encode: (input, ctx) => {
      match(ctx);
      // Axes: forward, turn, and an optional precision switch (0 or 1). No sideways axis.
      const precision = input.axes?.[2] ?? 0;
      if (
        input.joints ||
        input.pose ||
        (input.axes?.length ?? 0) > 3 ||
        (precision !== 0 && precision !== 1)
      )
        throw new Error('Vacuum driving accepts forward, turn and precision inputs only.');
      const forward = shape(axis(input.axes?.[0]));
      const turn = shape(axis(input.axes?.[1]));
      const key = ctx.sessionKey ?? ctx.equipment;
      // Neutral is sent first even if input changes between publication and first frame.
      if (!initialized.has(key)) {
        initialized.add(key);
        return twist(0, 0);
      }
      const limit = precision ? policy.precision_max_speed : policy.max_speed;
      const reverse = precision ? Math.min(-policy.min_speed, limit) : -policy.min_speed;
      return twist(forward * (forward < 0 ? reverse : limit), turn * policy.max_yaw_rate);
    },
    release: (ctx) => {
      match(ctx);
      initialized.delete(ctx.sessionKey ?? ctx.equipment);
      return twist(0, 0);
    },
  };
  return new Map([[policy.profile, adapter]]);
}
