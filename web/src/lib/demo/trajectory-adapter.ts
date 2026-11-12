import type { ProfileAdapter } from '../teleop/controls';
import {
  positionAdapters,
  validateJointLimits,
  validatePositionBinding,
  type BoundCapability,
} from '../teleop/position-adapter';
import type { PositionCapability, SimulationPolicy } from './types';
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
  const capabilities: BoundCapability[] = [];
  if (legacy) {
    if (policy.profile !== 'joints.trajectory.v1')
      throw new Error('Unsupported simulation control policy.');
    const interfaces = object(policy.interfaces, 'Simulation interfaces');
    for (const raw of Object.values(interfaces)) {
      const joints = validateJointLimits(raw, 'simulation');
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
        const joints = validateJointLimits(c.joints, 'simulation');
        validatePositionBinding(c, joints);
        if (c.profile === 'gripper.position.v1') {
          const bound = joints[c.joint_names[0]];
          if (
            c.joint_names.length !== 1 ||
            c.units !== 'm' ||
            typeof c.coordinate_label !== 'string' ||
            !c.coordinate_label.trim() ||
            ![c.open_position, c.closed_position].every(
              (v) =>
                typeof v === 'number' && Number.isFinite(v) && v >= bound.min && v <= bound.max,
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
  return positionAdapters(capabilities, policy.max_feedback_age_ms, {
    source: 'simulation',
    legacy,
  });
}
