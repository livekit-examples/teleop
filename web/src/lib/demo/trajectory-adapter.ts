import type { AdapterContext, ProfileAdapter } from '@/lib/teleop/controls';
import { selectJoints } from '../teleop/selectors';
import type { SimulationPolicy } from './types';
import { object, parseJson } from '../teleop/validation';

/** Explicit simulator implementation opt-in; never infer this from robot names or profiles. */
export function discoveredSimulationAdapters(payload: string): Map<string, ProfileAdapter> {
  const root = object(parseJson(payload));
  if (root.simulation_control === undefined) return new Map();
  const extension = object(root.simulation_control, 'simulation_control');
  if (extension.implementation !== 'mujoco.joint_trajectory.v1')
    throw new Error('Unsupported simulation control implementation.');
  const policy = object(extension.policy, 'Simulation policy');
  const interfaces = object(policy.interfaces, 'Simulation interfaces');
  if (!Object.keys(interfaces).length) throw new Error('Simulation interfaces are empty.');
  for (const joints of Object.values(interfaces)) {
    const entries = object(joints, 'Simulation joints');
    if (!Object.keys(entries).length) throw new Error('Simulation joints are empty.');
    for (const limit of Object.values(entries)) object(limit, 'Simulation joint limit');
  }
  return simulationAdapters(policy as SimulationPolicy);
}

/** Policy comes from the simulator or managed worker, never fixture defaults. */
export function simulationAdapters(policy: SimulationPolicy): Map<string, ProfileAdapter> {
  if (
    policy.profile !== 'joints.trajectory.v1' ||
    !Number.isFinite(policy.max_feedback_age_ms) ||
    policy.max_feedback_age_ms <= 0
  )
    throw new Error('Unsupported simulation control policy.');
  for (const joints of Object.values(policy.interfaces))
    for (const limit of Object.values(joints))
      if (
        ![limit.min, limit.max, limit.max_velocity].every(Number.isFinite) ||
        limit.min >= limit.max ||
        limit.max_velocity <= 0
      )
        throw new Error('Invalid simulation joint limits.');
  const limits = (ctx: AdapterContext) => {
    const entries = Object.values(policy.interfaces).filter(
      (joints) =>
        ctx.equipment.joint_names?.length === Object.keys(joints).length &&
        ctx.equipment.joint_names.every((name) => Object.hasOwn(joints, name)),
    );
    if (entries.length !== 1) throw new Error('The run policy does not match these joint names.');
    return entries[0];
  };
  const positions = (ctx: AdapterContext) =>
    selectJoints(Object.values(ctx.feedback)[0], ctx.equipment.joint_names).map((joint) => {
      if (joint.position === undefined || !Number.isFinite(joint.position))
        throw new Error('Current joint positions are required.');
      return joint.position;
    });
  const previous = new Map<string, number[]>();
  const adapter: ProfileAdapter = {
    profile: policy.profile,
    msgType: 'trajectory_msgs/msg/JointTrajectory',
    presentations: ['joint_sliders'],
    units: 'rad · simulation limits',
    mandatoryFeedback: 'joints',
    repeatIntervalMs: 200,
    maxFeedbackAgeMs: policy.max_feedback_age_ms,
    jointLimits: (ctx) => limits(ctx),
    validateFeedback: (_value, ctx) => {
      positions(ctx);
      limits(ctx);
    },
    encode: (input, ctx) => {
      const names = ctx.equipment.joint_names!;
      const current = positions(ctx);
      const bounds = limits(ctx);
      const key = names.join('\0');
      const last = previous.get(key) ?? current;
      let duration = 0.5;
      const values = names.map((name, index) => {
        const bound = bounds[name];
        const target =
          input.joints?.[name] ?? Math.max(bound.min, Math.min(bound.max, current[index]));
        if (!Number.isFinite(target) || target < bound.min || target > bound.max)
          throw new Error(`Position is outside the simulation limits for ${name}.`);
        // Include the prior commanded target: measured feedback can lag its trajectory.
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
      previous.set(key, values);
      const nanos = Math.ceil(duration * 1e9);
      return {
        joint_names: names,
        points: [
          {
            positions: values,
            time_from_start: { sec: Math.floor(nanos / 1e9), nanosec: nanos % 1e9 },
          },
        ],
      };
    },
    release: (ctx) => {
      previous.delete(ctx.equipment.joint_names!.join('\0'));
      return { joint_names: ctx.equipment.joint_names, points: [] };
    },
  };
  return new Map([[adapter.profile, adapter]]);
}
