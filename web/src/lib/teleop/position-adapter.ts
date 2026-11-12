import type { JointLimit, PositionCapability } from '../demo/types';
import { controlProfiles } from './control-profiles';
import { cartesianPoseAdapter, type AdapterContext, type ProfileAdapter } from './controls';
import { selectJoints } from './selectors';
import { object } from './validation';

/** Where the limits come from: a simulator policy or a robot's `hardware_control` block. */
export type LimitSource = 'simulation' | 'robot';
const title = (source: LimitSource) => (source === 'simulation' ? 'Simulation' : 'Robot');

export function validateJointLimits(
  value: unknown,
  source: LimitSource,
): Record<string, JointLimit> {
  const entries = object(value, `${title(source)} joint limits`);
  if (!Object.keys(entries).length) throw new Error(`${title(source)} joints are empty.`);
  for (const raw of Object.values(entries)) {
    const limit = object(raw, `${title(source)} joint limit`);
    if (
      ![limit.min, limit.max, limit.max_velocity].every(
        (v) => typeof v === 'number' && Number.isFinite(v),
      ) ||
      (limit.min as number) >= (limit.max as number) ||
      (limit.max_velocity as number) <= 0
    )
      throw new Error(`Invalid ${source} joint limits.`);
  }
  return entries as Record<string, JointLimit>;
}

/** Checks the joint/channel binding shared by every position capability. */
export function validatePositionBinding(
  c: PositionCapability,
  joints: Record<string, JointLimit>,
): void {
  if (
    !Array.isArray(c.joint_names) ||
    !c.joint_names.length ||
    new Set(c.joint_names).size !== c.joint_names.length ||
    c.joint_names.length !== Object.keys(joints).length ||
    c.joint_names.some((n) => typeof n !== 'string' || !Object.hasOwn(joints, n)) ||
    typeof c.control_channel !== 'string' ||
    !/^[a-z][a-z0-9_]*$/.test(c.control_channel)
  )
    throw new Error('Invalid position capability joint/channel binding.');
}

export type BoundCapability = {
  interfaceId?: string;
  operationId?: string;
  value: PositionCapability;
};

/** Joint-space adapters (trajectory, gripper, Cartesian) for validated position capabilities.
 * A legacy capability matches by joint names alone; others match their interface, operation and
 * channel too. */
export function positionAdapters(
  capabilities: BoundCapability[],
  maxFeedbackAgeMs: number,
  options: { source: LimitSource; legacy?: boolean },
): Map<string, ProfileAdapter> {
  const { source, legacy = false } = options;
  const result = new Map<string, ProfileAdapter>();
  if (capabilities.some((c) => c.value.profile === 'arm.cartesian_pose.v1'))
    result.set('arm.cartesian_pose.v1', cartesianPoseAdapter('m · quaternion', maxFeedbackAgeMs));
  for (const profile of new Set(capabilities.map((c) => c.value.profile))) {
    if (profile === 'arm.cartesian_pose.v1') continue;
    const capability = (ctx: AdapterContext) => {
      const names = ctx.operation.joint_names ?? ctx.equipment.joint_names;
      const entries = capabilities.filter(
        (c) =>
          c.value.profile === profile &&
          (legacy ||
            (ctx.interfaceId === c.interfaceId &&
              ctx.operationId === c.operationId &&
              (ctx.operation.control_channel ?? 'primary') === c.value.control_channel)) &&
          names?.length === c.value.joint_names.length &&
          names.every((n) => c.value.joint_names.includes(n)),
      );
      if (entries.length !== 1)
        throw new Error(
          source === 'simulation'
            ? 'The run policy does not match these joint names or operation.'
            : 'The robot control policy does not match these joint names or operation.',
        );
      return entries[0].value;
    };
    const names = (ctx: AdapterContext) => ctx.operation.joint_names ?? ctx.equipment.joint_names!;
    const positions = (ctx: AdapterContext) =>
      selectJoints(Object.values(ctx.feedback)[0], names(ctx)).map((joint) => {
        if (joint.position === undefined || !Number.isFinite(joint.position))
          throw new Error('Current joint positions are required.');
        return joint.position;
      });
    const previous = new WeakMap<object, number[]>();
    const key = (ctx: AdapterContext) => ctx.sessionKey ?? ctx.equipment;
    const gripper = profile === 'gripper.position.v1';
    const adapter: ProfileAdapter = {
      profile,
      msgType: controlProfiles[profile].msgType,
      units: gripper ? 'm · finger displacement' : `rad · ${source} limits`,
      mandatoryFeedback: 'joints',
      maxFeedbackAgeMs,
      // Refresh only explicitly requested targets over the lossy data track.
      // The backend completes accepted trajectories without requiring this refresh.
      repeatIntervalMs: 200,
      jointLimits: (ctx) => capability(ctx).joints,
      ...(gripper
        ? {
            gripperTargets: (ctx: AdapterContext) => {
              const c = capability(ctx);
              return {
                open: c.open_position!,
                closed: c.closed_position!,
                label: c.coordinate_label!,
              };
            },
          }
        : {}),
      validateFeedback: (_value, ctx) => {
        positions(ctx);
        capability(ctx);
      },
      encode: (input, ctx) => {
        const selected = names(ctx),
          current = positions(ctx),
          bounds = capability(ctx).joints;
        if (Object.keys(input.joints ?? {}).some((n) => !selected.includes(n)))
          throw new Error('Unknown joint target.');
        const last = previous.get(key(ctx)) ?? current;
        let duration = 0.5;
        const values = selected.map((name, index) => {
          const bound = bounds[name];
          const target =
            input.joints?.[name] ?? Math.max(bound.min, Math.min(bound.max, current[index]));
          if (!Number.isFinite(target) || target < bound.min || target > bound.max)
            throw new Error(`Position is outside the ${source} limits for ${name}.`);
          duration = Math.max(
            duration,
            (Math.max(Math.abs(target - current[index]), Math.abs(target - last[index])) /
              bound.max_velocity) *
              1.25 +
              0.5,
          );
          return target;
        });
        if (duration > 30)
          throw new Error(`The requested move exceeds the ${source} trajectory limit.`);
        previous.set(key(ctx), values);
        const nanos = Math.ceil(duration * 1e9);
        return {
          joint_names: selected,
          points: [
            {
              positions: values,
              time_from_start: {
                sec: Math.floor(nanos / 1e9),
                nanosec: nanos % 1e9,
              },
            },
          ],
        };
      },
      release: (ctx) => {
        previous.delete(key(ctx));
        return { joint_names: names(ctx), points: [] };
      },
    };
    result.set(profile, adapter);
  }
  return result;
}
