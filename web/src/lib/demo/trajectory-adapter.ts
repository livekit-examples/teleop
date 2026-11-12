import { cartesianPoseAdapter, type AdapterContext, type ProfileAdapter } from '../teleop/controls';
import { selectJoints } from '../teleop/selectors';
import type { JointLimit, PositionCapability, SimulationPolicy } from './types';
import { object, parseJson } from '../teleop/validation';
import { racingAdapters } from './racing-adapter';
import { vacuumAdapters } from './vacuum-adapter';

/** Explicit simulator opt-in. A robot label or profile never enables a live adapter. */
export function discoveredSimulationAdapters(payload: string): Map<string, ProfileAdapter> {
  const root = object(parseJson(payload));
  if (root.simulation_control === undefined) return new Map();
  const extension = object(root.simulation_control, 'simulation_control');
  const policy = object(extension.policy, 'Simulation policy');
  if (extension.implementation === 'rc.ackermann.v1') return racingAdapters(policy);
  if (extension.implementation === 'vacuum.twist.v1') return vacuumAdapters(policy);
  if (extension.implementation === 'mujoco.position.v2') {
    if (policy.version !== 2) throw new Error('Unsupported simulation policy version.');
  } else if (extension.implementation === 'mujoco.joint_trajectory.v1') {
    if (policy.version !== undefined)
      throw new Error('Unsupported legacy simulation policy version.');
  } else throw new Error('Unsupported simulation control implementation.');
  return simulationAdapters(policy as SimulationPolicy);
}

function validateLimits(value: unknown): Record<string, JointLimit> {
  const entries = object(value, 'Simulation joint limits');
  if (!Object.keys(entries).length) throw new Error('Simulation joints are empty.');
  for (const raw of Object.values(entries)) {
    const limit = object(raw, 'Simulation joint limit');
    if (
      ![limit.min, limit.max, limit.max_velocity].every(
        (v) => typeof v === 'number' && Number.isFinite(v),
      ) ||
      (limit.min as number) >= (limit.max as number) ||
      (limit.max_velocity as number) <= 0
    )
      throw new Error('Invalid simulation joint limits.');
  }
  return entries as Record<string, JointLimit>;
}

/** Manual discovery and managed sessions use the same validated capabilities. */
export function simulationAdapters(policy: SimulationPolicy): Map<string, ProfileAdapter> {
  if ('kind' in policy)
    return policy.kind === 'vacuum.twist.v1' ? vacuumAdapters(policy) : racingAdapters(policy);
  if (
    typeof policy.max_feedback_age_ms !== 'number' ||
    !Number.isFinite(policy.max_feedback_age_ms) ||
    policy.max_feedback_age_ms <= 0
  )
    throw new Error('Unsupported simulation control policy.');
  const legacy = !('version' in policy);
  const capabilities: {
    interfaceId?: string;
    operationId?: string;
    value: PositionCapability;
  }[] = [];
  if (legacy) {
    if (policy.profile !== 'joints.trajectory.v1')
      throw new Error('Unsupported simulation control policy.');
    const interfaces = object(policy.interfaces, 'Simulation interfaces');
    for (const raw of Object.values(interfaces)) {
      const joints = validateLimits(raw);
      capabilities.push({
        value: {
          profile: policy.profile,
          control_channel: 'primary',
          joint_names: Object.keys(joints),
          units: 'rad',
          joints,
        },
      });
    }
  } else {
    if (policy.version !== 2) throw new Error('Unsupported simulation policy version.');
    for (const [interfaceId, raw] of Object.entries(
      object(policy.operations, 'Simulation operations'),
    ))
      for (const [operationId, rawCapability] of Object.entries(
        object(raw, 'Interface capabilities'),
      )) {
        const c = object(rawCapability, 'Position capability') as PositionCapability;
        const joints = validateLimits(c.joints);
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
        if (c.profile === 'gripper.position.v1') {
          const bound = joints[c.joint_names[0]];
          if (
            c.joint_names.length !== 1 ||
            c.units !== 'm' ||
            typeof c.coordinate_label !== 'string' ||
            !c.coordinate_label.trim() ||
            ![c.open_position, c.closed_position].every(
              (v) => typeof v === 'number' && Number.isFinite(v) && v >= bound.min && v <= bound.max,
            ) ||
            c.open_position === c.closed_position
          )
            throw new Error('Invalid gripper targets or coordinate units.');
        } else if (c.profile === 'arm.cartesian_pose.v1') {
          if (c.units !== 'm · quaternion')
            throw new Error('Unsupported Cartesian capability units.');
        } else if (c.profile !== 'joints.trajectory.v1' || c.units !== 'rad')
          throw new Error('Unsupported position capability profile/units.');
        capabilities.push({ interfaceId, operationId, value: c });
      }
  }
  if (!capabilities.length) throw new Error('Simulation interfaces are empty.');
  const result = new Map<string, ProfileAdapter>();
  if (capabilities.some((c) => c.value.profile === 'arm.cartesian_pose.v1'))
    result.set(
      'arm.cartesian_pose.v1',
      cartesianPoseAdapter('m · quaternion', policy.max_feedback_age_ms),
    );
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
        throw new Error('The run policy does not match these joint names or operation.');
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
      msgType: 'trajectory_msgs/msg/JointTrajectory',
      presentations: [gripper ? 'gripper_controls' : 'joint_sliders'],
      units: gripper ? 'm · finger displacement' : 'rad · simulation limits',
      mandatoryFeedback: 'joints',
      maxFeedbackAgeMs: policy.max_feedback_age_ms,
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
            throw new Error(`Position is outside the simulation limits for ${name}.`);
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
          throw new Error('The requested move exceeds the simulation trajectory limit.');
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
