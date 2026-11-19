import { controlProfiles } from '../teleop/control-profiles';
import type { AdapterContext, ProfileAdapter } from '../teleop/controls';
import type { DriveCapability } from './types';
import { object } from '../teleop/validation';

export const driveProfiles = ['base.twist.v1', 'base.holonomic_twist.v1'] as const;
export type BoundDrive = { interfaceId: string; operationId: string; value: DriveCapability };

const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);

/** Validates a wheeled-base capability from a `mujoco.position.v2` simulation policy. */
export function validateDriveCapability(raw: unknown): DriveCapability {
  const c = object(raw, 'Drive capability');
  const positive = (key: string, max: number) => {
    const value = c[key];
    if (!finite(value) || (value as number) <= 0 || (value as number) > max)
      throw new Error(`Invalid drive limit: ${key}.`);
  };
  if (
    !(driveProfiles as readonly unknown[]).includes(c.profile) ||
    c.control_channel !== 'primary' ||
    c.units !== 'm/s · rad/s' ||
    typeof c.command_track !== 'string' ||
    !c.command_track ||
    c.neutral !== 'brake'
  )
    throw new Error('Unsupported drive capability.');
  positive('max_linear_x', 3);
  positive('max_yaw_rate', 6);
  positive('max_acceleration', 5);
  positive('max_yaw_acceleration', 10);
  positive('command_timeout_ms', 1000);
  positive('input_interval_ms', 250);
  if (
    !finite(c.min_linear_x) ||
    (c.min_linear_x as number) > 0 ||
    (c.min_linear_x as number) < -(c.max_linear_x as number) ||
    !finite(c.max_linear_y) ||
    (c.max_linear_y as number) < 0 ||
    (c.max_linear_y as number) > 3 ||
    (c.profile === 'base.twist.v1' && c.max_linear_y !== 0) ||
    (c.input_interval_ms as number) * 3 > (c.command_timeout_ms as number)
  )
    throw new Error('Invalid drive speed or command timing limits.');
  return c as DriveCapability;
}

/** Twist adapters for simulated wheeled bases. Axes: forward, turn (left positive) and, for a
 * holonomic base, strafe (left positive). Each axis is between -1 and 1 and scales its limit. */
export function driveAdapters(drives: BoundDrive[]): Map<string, ProfileAdapter> {
  const result = new Map<string, ProfileAdapter>();
  for (const profile of driveProfiles) {
    const bound = drives.filter((d) => d.value.profile === profile);
    if (!bound.length) continue;
    const capability = (ctx: AdapterContext) => {
      const match = bound.filter(
        (d) =>
          d.interfaceId === ctx.interfaceId &&
          d.operationId === ctx.operationId &&
          ctx.operation.profile === profile &&
          ctx.operation.command.track_name === d.value.command_track &&
          ctx.operation.command.msg_type === 'geometry_msgs/msg/Twist' &&
          ctx.operation.command.format === 'json' &&
          (ctx.operation.control_channel ?? 'primary') === 'primary',
      );
      if (match.length !== 1)
        throw new Error('The run policy does not match this drive operation.');
      return match[0].value;
    };
    const axis = (value = 0) => {
      if (!Number.isFinite(value) || Math.abs(value) > 1)
        throw new Error('Driving input must be between -1 and 1.');
      return value;
    };
    // Small stick movements near the center are ignored, then the response grows progressively.
    const shape = (value: number) => {
      const size = Math.abs(value);
      return size <= 0.08 ? 0 : Math.sign(value) * ((size - 0.08) / 0.92) ** 2;
    };
    const twist = (x: number, y: number, z: number) => ({
      linear: { x, y, z: 0 },
      angular: { x: 0, y: 0, z },
    });
    const initialized = new WeakSet<object>();
    const interval = Math.min(...bound.map((d) => d.value.input_interval_ms));
    result.set(profile, {
      profile,
      msgType: controlProfiles[profile].msgType,
      units: 'm/s · rad/s',
      maxFeedbackAgeMs: 1000,
      repeatIntervalMs: interval,
      validateFeedback: (_value, ctx) => {
        capability(ctx);
      },
      encode: (input, ctx) => {
        const c = capability(ctx);
        if (input.joints || input.pose || (input.axes?.length ?? 0) > 3)
          throw new Error('Base driving accepts forward, turn and strafe inputs only.');
        const forward = shape(axis(input.axes?.[0]));
        const turn = shape(axis(input.axes?.[1]));
        const strafe = profile === 'base.holonomic_twist.v1' ? shape(axis(input.axes?.[2])) : 0;
        const key = ctx.sessionKey ?? ctx.equipment;
        // Neutral is sent first, so a displaced input cannot move the base merely by arming.
        if (!initialized.has(key)) {
          initialized.add(key);
          return twist(0, 0, 0);
        }
        return twist(
          forward * (forward < 0 ? -c.min_linear_x : c.max_linear_x),
          strafe * c.max_linear_y,
          turn * c.max_yaw_rate,
        );
      },
      release: (ctx) => {
        capability(ctx);
        initialized.delete(ctx.sessionKey ?? ctx.equipment);
        return twist(0, 0, 0);
      },
    });
  }
  return result;
}
