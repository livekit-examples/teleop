import type { AdapterContext, ProfileAdapter } from '../teleop/controls';
import type { RacingPolicy } from './types';
import { object } from '../teleop/validation';

/** Explicit RC implementation; no fixture/hardware defaults are inferred from a label. */
export function racingAdapters(raw: unknown): Map<string, ProfileAdapter> {
  const p = object(raw, 'RC driving policy');
  if (
    p.version !== 1 ||
    p.kind !== 'rc.ackermann.v1' ||
    p.profile !== 'base.ackermann_drive.v1' ||
    p.control_channel !== 'primary' ||
    p.interface_id !== 'base' ||
    p.operation_id !== 'drive' ||
    p.command_track !== '/ackermann_cmd' ||
    p.state_track !== '/vehicle_state' ||
    p.neutral !== 'brake_and_center'
  )
    throw new Error('Unsupported RC driving policy.');
  const positive = (key: string, max: number) => {
    const value = p[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > max)
      throw new Error(`Invalid RC driving limit: ${key}.`);
    return value;
  };
  positive('max_speed', 20);
  positive('max_steering_angle', 0.4189);
  positive('max_steering_rate', 3.2);
  positive('max_acceleration', 9.51);
  positive('max_braking', 9.51);
  positive('command_timeout_ms', 250);
  positive('input_interval_ms', 50);
  // Older policies used a linear stick-to-angle mapping. New RC policies
  // declare a progressive curve so both analog presentations have fine control.
  const steeringExponent = p.steering_input_exponent ?? 1;
  if (
    typeof steeringExponent !== 'number' ||
    !Number.isFinite(steeringExponent) ||
    steeringExponent < 1 ||
    steeringExponent > 3
  )
    throw new Error('Invalid RC steering input curve.');
  if (
    typeof p.min_speed !== 'number' ||
    !Number.isFinite(p.min_speed) ||
    p.min_speed >= 0 ||
    p.min_speed < -5 ||
    p.min_speed < -(p.max_speed as number) ||
    (p.input_interval_ms as number) * 3 > (p.command_timeout_ms as number)
  )
    throw new Error('Invalid RC speed or command timing policy.');
  const policy = p as RacingPolicy;
  const match = (ctx: AdapterContext) => {
    if (
      ctx.interfaceId !== policy.interface_id ||
      ctx.operationId !== policy.operation_id ||
      ctx.operation.profile !== policy.profile ||
      ctx.operation.command.track_name !== policy.command_track ||
      ctx.operation.command.msg_type !== 'ackermann_msgs/msg/AckermannDrive' ||
      ctx.operation.command.format !== 'json' ||
      (ctx.operation.control_channel ?? 'primary') !== policy.control_channel
    )
      throw new Error('RC driving policy does not match this operation.');
  };
  const axis = (value = 0) => {
    if (!Number.isFinite(value) || Math.abs(value) > 1)
      throw new Error('Driving input must be between -1 and 1.');
    return value;
  };
  const neutral = () => ({
    speed: 0,
    steering_angle: 0,
    steering_angle_velocity: 0,
    acceleration: 0,
    jerk: 0,
  });
  const initialized = new WeakSet<object>();
  const adapter: ProfileAdapter = {
    profile: policy.profile,
    msgType: 'ackermann_msgs/msg/AckermannDrive',
    presentations: ['joystick', 'keyboard', 'gamepad'],
    units: `m/s · steering rad · forward cap ${policy.max_speed} m/s`,
    maxFeedbackAgeMs: 1000,
    repeatIntervalMs: policy.input_interval_ms,
    telemetryTrack: policy.state_track,
    validateFeedback: (_value, ctx) => match(ctx),
    encode: (input, ctx) => {
      match(ctx);
      if (
        input.joints ||
        input.pose ||
        (input.axes?.length ?? 0) > 3 ||
        axis(input.axes?.[2]) !== 0
      )
        throw new Error('RC driving accepts forward and steering axes only.');
      const forward = axis(input.axes?.[0]);
      const steering = axis(input.axes?.[1]);
      const key = ctx.sessionKey ?? ctx.equipment;
      // Neutral is sent first even if input changes between publication and first frame.
      if (!initialized.has(key)) {
        initialized.add(key);
        return neutral();
      }
      return {
        ...neutral(),
        speed: forward * (forward < 0 ? -policy.min_speed : policy.max_speed),
        steering_angle:
          Math.sign(steering) * Math.abs(steering) ** steeringExponent * policy.max_steering_angle,
      };
    },
    release: (ctx) => {
      match(ctx);
      initialized.delete(ctx.sessionKey ?? ctx.equipment);
      return neutral();
    },
  };
  return new Map([[policy.profile, adapter]]);
}
