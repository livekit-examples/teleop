import type { PositionCapability } from '../demo/types';
import { controlProfiles } from './control-profiles';
import type { AdapterContext, ProfileAdapter } from './controls';
import {
  positionAdapters,
  validateJointLimits,
  validatePositionBinding,
  type BoundCapability,
} from './position-adapter';
import { object, parseJson } from './validation';

/** How often the desktop controls sample and send driving input (control-panel.tsx). */
const DRIVE_INPUT_INTERVAL_MS = 50;

/** `base.twist.v1` limits that a robot declares in `hardware_control`. */
type TwistCapability = {
  profile: 'base.twist.v1';
  control_channel: string;
  /** Forward speed at full input, m/s. */
  max_linear_speed: number;
  /** Reverse speed at full input, m/s (positive). */
  max_reverse_speed: number;
  /** Yaw rate at full input, rad/s. */
  max_angular_speed: number;
  /** The robot stops on its own when commands stop for this long. */
  command_timeout_ms: number;
};

const positive = (c: Record<string, unknown>, key: string, max: number) => {
  const value = c[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > max)
    throw new Error(`Invalid robot driving limit: ${key}.`);
  return value;
};

function validateTwist(c: Record<string, unknown>): TwistCapability {
  positive(c, 'max_linear_speed', 3);
  positive(c, 'max_reverse_speed', 3);
  positive(c, 'max_angular_speed', 6);
  positive(c, 'command_timeout_ms', 1000);
  if ((c.command_timeout_ms as number) < DRIVE_INPUT_INTERVAL_MS * 3)
    throw new Error(
      `Robot command_timeout_ms must cover three ${DRIVE_INPUT_INTERVAL_MS} ms input frames.`,
    );
  if (typeof c.control_channel !== 'string' || !/^[a-z][a-z0-9_]*$/.test(c.control_channel))
    throw new Error('Invalid robot driving control channel.');
  return c as TwistCapability;
}

function twistAdapter(
  capabilities: { interfaceId: string; operationId: string; value: TwistCapability }[],
  maxFeedbackAgeMs: number,
): ProfileAdapter {
  const capability = (ctx: AdapterContext) => {
    const entry = capabilities.find(
      (c) =>
        c.interfaceId === ctx.interfaceId &&
        c.operationId === ctx.operationId &&
        (ctx.operation.control_channel ?? 'primary') === c.value.control_channel,
    );
    if (
      !entry ||
      ctx.operation.profile !== 'base.twist.v1' ||
      ctx.operation.command.msg_type !== controlProfiles['base.twist.v1'].msgType
    )
      throw new Error('The robot control policy does not match this operation.');
    return entry.value;
  };
  const axis = (value = 0) => {
    if (!Number.isFinite(value) || Math.abs(value) > 1)
      throw new Error('Driving input must be between -1 and 1.');
    return value;
  };
  const twist = (x: number, z: number) => ({
    linear: { x, y: 0, z: 0 },
    angular: { x: 0, y: 0, z },
  });
  const initialized = new WeakSet<object>();
  return {
    profile: 'base.twist.v1',
    msgType: controlProfiles['base.twist.v1'].msgType,
    units: 'm/s · rad/s · robot limits',
    maxFeedbackAgeMs,
    validateFeedback: (_value, ctx) => {
      capability(ctx);
    },
    encode: (input, ctx) => {
      const c = capability(ctx);
      // Axes: forward, turn. A differential base has no sideways axis, so the third
      // (strafe) axis that keyboard Q/E and the right stick produce is ignored.
      if (input.joints || input.pose)
        throw new Error('Robot driving accepts forward and turn inputs only.');
      const forward = axis(input.axes?.[0]);
      const turn = axis(input.axes?.[1]);
      const key = ctx.sessionKey ?? ctx.equipment;
      // Neutral is sent first, so arming never starts with motion.
      if (!initialized.has(key)) {
        initialized.add(key);
        return twist(0, 0);
      }
      return twist(
        forward * (forward < 0 ? c.max_reverse_speed : c.max_linear_speed),
        turn * c.max_angular_speed,
      );
    },
    release: (ctx) => {
      initialized.delete(ctx.sessionKey ?? ctx.equipment);
      return twist(0, 0);
    },
  };
}

/** Explicit hardware opt-in: a robot enables live commands only by declaring its limits in
 * `hardware_control`. A robot label or profile alone never enables a live adapter. */
export function discoveredHardwareAdapters(payload: string): Map<string, ProfileAdapter> {
  const root = object(parseJson(payload));
  if (root.hardware_control === undefined) return new Map();
  const policy = object(root.hardware_control, 'hardware_control');
  if (policy.version !== 1) throw new Error('Unsupported hardware_control version.');
  const age = policy.max_feedback_age_ms;
  if (typeof age !== 'number' || !Number.isFinite(age) || age <= 0 || age > 5000)
    throw new Error('Invalid hardware_control max_feedback_age_ms.');
  const twists: { interfaceId: string; operationId: string; value: TwistCapability }[] = [];
  const positions: BoundCapability[] = [];
  for (const [interfaceId, raw] of Object.entries(
    object(policy.operations, 'hardware_control operations'),
  ))
    for (const [operationId, rawCapability] of Object.entries(
      object(raw, 'Interface capabilities'),
    )) {
      const c = object(rawCapability, 'Robot capability');
      if (c.profile === 'base.twist.v1')
        twists.push({ interfaceId, operationId, value: validateTwist(c) });
      else if (c.profile === 'joints.trajectory.v1') {
        const capability = c as PositionCapability;
        const joints = validateJointLimits(capability.joints, 'robot');
        validatePositionBinding(capability, joints);
        if (capability.units !== 'rad') throw new Error('Robot joint positions must be in rad.');
        positions.push({ interfaceId, operationId, value: capability });
      } else throw new Error(`Unsupported hardware_control profile: ${String(c.profile)}.`);
    }
  if (!twists.length && !positions.length)
    throw new Error('hardware_control operations are empty.');
  const result = positions.length
    ? positionAdapters(positions, age, { source: 'robot' })
    : new Map<string, ProfileAdapter>();
  if (twists.length) result.set('base.twist.v1', twistAdapter(twists, age));
  return result;
}
