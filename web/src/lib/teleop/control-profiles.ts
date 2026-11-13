import type { Operation } from './types';

type InputCapabilities = { gamepad: boolean; xr: boolean; camera: boolean };

/** Register input modes here; their UI/input implementations live in the workspace components. */
export const presentations = {
  joystick: {},
  keyboard: {},
  gamepad: { unavailable: (caps: InputCapabilities) => !caps.gamepad && 'Gamepad disconnected' },
  joint_sliders: {},
  gripper_controls: {},
  vr: { unavailable: (caps: InputCapabilities) => !caps.xr && 'Immersive VR unavailable' },
  hand_tracking: { unavailable: (caps: InputCapabilities) => !caps.camera && 'Camera unavailable' },
} satisfies Record<string, { unavailable?: (caps: InputCapabilities) => string | false }>;

export type Presentation = keyof typeof presentations;
type ProfileDefinition = { msgType: string; presentations: readonly Presentation[] };
const driving: Presentation[] = ['joystick', 'keyboard', 'gamepad'];

/** App-owned command semantics. Discovery describes endpoints, never input devices.
 * Add a profile/message pairing here and its encoder/safety adapter to enable a new command.
 * Adding an input mode to a profile automatically exposes it in every workspace view.
 */
export const controlProfiles: Record<string, ProfileDefinition> = {
  'base.twist.v1': { msgType: 'geometry_msgs/msg/Twist', presentations: driving },
  'base.holonomic_twist.v1': { msgType: 'geometry_msgs/msg/Twist', presentations: driving },
  'base.ackermann_drive.v1': {
    msgType: 'ackermann_msgs/msg/AckermannDrive',
    presentations: driving,
  },
  'joints.velocity_jog.v1': {
    msgType: 'control_msgs/msg/JointJog',
    presentations: ['joint_sliders', 'gamepad'],
  },
  'joints.trajectory.v1': {
    msgType: 'trajectory_msgs/msg/JointTrajectory',
    presentations: ['joint_sliders'],
  },
  'arm.cartesian_pose.v1': {
    msgType: 'geometry_msgs/msg/PoseStamped',
    presentations: ['hand_tracking', 'vr'],
  },
  'gripper.position.v1': {
    msgType: 'trajectory_msgs/msg/JointTrajectory',
    presentations: ['gripper_controls'],
  },
};

/** Unknown profiles and incompatible wire schemas never acquire controls by inference. */
export function operationPresentations(operation?: Operation): readonly string[] {
  if (!operation || !Object.hasOwn(controlProfiles, operation.profile)) return [];
  const profile = controlProfiles[operation.profile];
  return profile.msgType === operation.command.msg_type ? profile.presentations : [];
}

export function presentationReason(name: string, caps: InputCapabilities): string {
  if (!Object.hasOwn(presentations, name)) return 'Presentation is not implemented';
  const definition: { unavailable?: (caps: InputCapabilities) => string | false } =
    presentations[name as Presentation];
  return definition.unavailable?.(caps) || '';
}
