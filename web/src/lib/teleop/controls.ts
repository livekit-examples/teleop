import { selectJoints } from './selectors';
import { StreamHub } from './streams';
import {
  browserClock,
  errorMessage,
  own,
  type Clock,
  type CommandWriter,
  type ControlInterface,
  type Operation,
  type RobotConfig,
  type Transport,
} from './types';

export type ControlInput = {
  axes?: number[];
  joints?: Record<string, number>;
  pose?: {
    position: { x: number; y: number; z: number };
    orientation: { x: number; y: number; z: number; w: number };
  };
};
export type AdapterContext = {
  sessionKey?: object;
  interfaceId?: string;
  operationId?: string;
  equipment: ControlInterface;
  operation: Operation;
  feedback: Record<string, unknown>;
};
export type ProfileAdapter = {
  profile: string;
  msgType: string;
  presentations: string[];
  units: string;
  mandatoryFeedback?: 'joints' | 'pose';
  maxFeedbackAgeMs: number;
  repeatIntervalMs?: number;
  telemetryTrack?: string;
  jointLimits?(context: AdapterContext): Record<string, { min: number; max: number }>;
  gripperTargets?(context: AdapterContext): {
    open: number;
    closed: number;
    label: string;
  };
  encode(input: ControlInput, context: AdapterContext): unknown;
  release(context: AdapterContext): unknown;
  validateFeedback(value: unknown, context: AdapterContext): void;
};
export type ControlSession = {
  operation: string;
  presentation: string;
  armed: boolean;
  switching: boolean;
  error: string;
  activation: number;
  writer?: CommandWriter;
  token: number;
  lastInputAt?: number;
  lastInput?: ControlInput;
  ending?: Promise<boolean>;
  feedback: (() => void)[];
};
export const knownProfiles = [
  'base.twist.v1',
  'base.holonomic_twist.v1',
  'base.ackermann_drive.v1',
  'joints.velocity_jog.v1',
  'joints.trajectory.v1',
  'arm.cartesian_pose.v1',
  'gripper.position.v1',
];

/** Non-primary session IDs are serialized tuples; primary IDs remain backward compatible. */
/** Profiles that stay armed while idle, until the operator disarms them. */
const IDLE_PROFILES = ['joints.trajectory.v1', 'gripper.position.v1', 'arm.cartesian_pose.v1'];
/** Profiles whose last target repeats while idle. A Cartesian target does not repeat, so that a
 * released arm is not sent back to an old target. */
const REPEAT_PROFILES = ['joints.trajectory.v1', 'gripper.position.v1'];

export function controlKey(id: string, channel = 'primary'): string {
  return channel === 'primary' ? id : JSON.stringify([id, channel]);
}
export function controlTarget(key: string): [string, string] {
  return key.startsWith('[') ? JSON.parse(key) : [key, 'primary'];
}
export function controlChannels(equipment: ControlInterface): string[] {
  return [
    ...new Set(Object.values(equipment.operations).map((op) => op.control_channel ?? 'primary')),
  ];
}

const poseFeedback = (value: unknown) => {
  const pose = (value as { pose?: ControlInput['pose'] })?.pose;
  if (
    !pose ||
    ![
      pose.position?.x,
      pose.position?.y,
      pose.position?.z,
      pose.orientation?.x,
      pose.orientation?.y,
      pose.orientation?.z,
      pose.orientation?.w,
    ].every((n) => typeof n === 'number' && Number.isFinite(n))
  )
    throw new Error('Current end-effector PoseStamped feedback is required.');
  return pose;
};

/** VR end-effector targets, in the arm interface frame. The robot solves its own kinematics. */
export function cartesianPoseAdapter(units: string, maxFeedbackAgeMs: number): ProfileAdapter {
  return {
    profile: 'arm.cartesian_pose.v1',
    msgType: 'geometry_msgs/msg/PoseStamped',
    presentations: ['vr'],
    units,
    mandatoryFeedback: 'pose',
    maxFeedbackAgeMs,
    encode: (input, ctx) => {
      const pose = poseFeedback({ pose: input.pose });
      if ([pose.position.x, pose.position.y, pose.position.z].some((v) => Math.abs(v) > 2))
        throw new Error('Cartesian position exceeds ±2 m.');
      const q = pose.orientation;
      const length = Math.hypot(q.x, q.y, q.z, q.w);
      if (Math.abs(length - 1) > 0.01) throw new Error('Pose quaternion must be normalized.');
      return { header: { frame_id: ctx.equipment.frame_id ?? '' }, pose };
    },
    release: (ctx) => ({
      header: { frame_id: ctx.equipment.frame_id ?? '' },
      pose: poseFeedback(Object.values(ctx.feedback)[0]),
    }),
    validateFeedback: (value) => {
      poseFeedback(value);
    },
  };
}

/** Adapters here apply ONLY to FixtureTransport. Their limits are not hardware defaults. */
export function fixtureAdapters(): Map<string, ProfileAdapter> {
  const axis = (value = 0) => {
    if (!Number.isFinite(value) || Math.abs(value) > 1)
      throw new Error('Fixture input must be between -1 and 1.');
    return value;
  };
  const twist = (input: ControlInput, holonomic = false) => ({
    linear: {
      x: axis(input.axes?.[0]) * 0.5,
      y: holonomic ? axis(input.axes?.[2]) * 0.5 : 0,
      z: 0,
    },
    angular: { x: 0, y: 0, z: axis(input.axes?.[1]) * 0.8 },
  });
  const base = (
    profile: string,
    msgType: string,
    encode: ProfileAdapter['encode'],
  ): ProfileAdapter => ({
    profile,
    msgType,
    presentations: ['joystick', 'keyboard', 'gamepad'],
    units: profile.includes('ackermann') ? 'm/s · steering rad (fixture)' : 'm/s · rad/s (fixture)',
    maxFeedbackAgeMs: 1000,
    encode,
    release: () => encode({}, {} as AdapterContext),
    validateFeedback: () => {},
  });
  const adapters: ProfileAdapter[] = [
    base('base.twist.v1', 'geometry_msgs/msg/Twist', (input) => twist(input)),
    base('base.holonomic_twist.v1', 'geometry_msgs/msg/Twist', (input) => twist(input, true)),
    base('base.ackermann_drive.v1', 'ackermann_msgs/msg/AckermannDrive', (input) => ({
      speed: axis(input.axes?.[0]) * 0.5,
      steering_angle: axis(input.axes?.[1]) * 0.4,
      steering_angle_velocity: 0,
      acceleration: 0,
      jerk: 0,
    })),
  ];
  const jointValues = (input: ControlInput, context: AdapterContext, velocity: boolean) => {
    const names = context.equipment.joint_names ?? [];
    if (!names.length) throw new Error('No exact joint names configured.');
    return names.map((name) => {
      const v = input.joints?.[name] ?? 0;
      if (!Number.isFinite(v) || Math.abs(v) > (velocity ? 1 : 3.14))
        throw new Error(
          `Fixture joint ${name} exceeds its ${velocity ? '1 rad/s' : '3.14 rad'} limit.`,
        );
      return v;
    });
  };
  adapters.push({
    profile: 'joints.velocity_jog.v1',
    msgType: 'control_msgs/msg/JointJog',
    presentations: ['joint_sliders', 'gamepad'],
    units: 'rad/s (fixture limit ±1)',
    maxFeedbackAgeMs: 1000,
    encode: (input, ctx) => ({
      header: { frame_id: ctx.equipment.frame_id ?? '' },
      joint_names: ctx.equipment.joint_names,
      displacements: [],
      velocities: jointValues(input, ctx, true),
      duration: 0.15,
    }),
    release: (ctx) => ({
      header: { frame_id: ctx.equipment.frame_id ?? '' },
      joint_names: ctx.equipment.joint_names,
      displacements: [],
      velocities: (ctx.equipment.joint_names ?? []).map(() => 0),
      duration: 0.15,
    }),
    validateFeedback: () => {},
  });
  const positions = (ctx: AdapterContext) =>
    selectJoints(Object.values(ctx.feedback)[0], ctx.equipment.joint_names).map((joint) => {
      if (joint.position === undefined)
        throw new Error(`Position feedback missing for ${joint.name}.`);
      return joint.position;
    });
  const trajectory = (values: number[], ctx: AdapterContext) => ({
    header: { frame_id: ctx.equipment.frame_id ?? '' },
    joint_names: ctx.equipment.joint_names,
    points: [
      {
        positions: values,
        velocities: [],
        accelerations: [],
        effort: [],
        time_from_start: { sec: 1, nanosec: 0 },
      },
    ],
  });
  adapters.push({
    profile: 'joints.trajectory.v1',
    msgType: 'trajectory_msgs/msg/JointTrajectory',
    presentations: ['joint_sliders'],
    units: 'rad (fixture limit ±3.14)',
    mandatoryFeedback: 'joints',
    maxFeedbackAgeMs: 1000,
    encode: (input, ctx) => trajectory(jointValues(input, ctx, false), ctx),
    release: (ctx) => trajectory(positions(ctx), ctx),
    validateFeedback: (_value, ctx) => {
      positions(ctx);
    },
  });
  adapters.push({
    profile: 'gripper.position.v1',
    msgType: 'trajectory_msgs/msg/JointTrajectory',
    presentations: ['gripper_controls'],
    units: 'm · finger displacement (fixture)',
    repeatIntervalMs: 200,
    mandatoryFeedback: 'joints',
    maxFeedbackAgeMs: 1000,
    jointLimits: (ctx) =>
      Object.fromEntries((ctx.equipment.joint_names ?? []).map((n) => [n, { min: 0, max: 0.044 }])),
    gripperTargets: () => ({
      open: 0.044,
      closed: 0,
      label: 'Finger displacement',
    }),
    encode: (input, ctx) => {
      const name = ctx.equipment.joint_names?.[0];
      const value = name ? input.joints?.[name] : undefined;
      if (value === undefined || !Number.isFinite(value) || value < 0 || value > 0.044)
        throw new Error('Fixture gripper position must be within 0–0.044 m.');
      return {
        joint_names: [name],
        points: [{ positions: [value], time_from_start: { sec: 3, nanosec: 0 } }],
      };
    },
    release: (ctx) => ({ joint_names: ctx.equipment.joint_names, points: [] }),
    validateFeedback: (_value, ctx) => {
      positions(ctx);
    },
  });
  adapters.push(cartesianPoseAdapter('m · quaternion (fixture)', 1000));
  return new Map(adapters.map((adapter) => [adapter.profile, adapter]));
}

export class ControlManager {
  readonly sessions = new Map<string, ControlSession>();
  config?: RobotConfig;
  robot = '';
  connected = false;
  owner = '';
  requested = false;
  pending = false;
  ownershipError = '';
  private generation = 0;
  private visible = true;
  constructor(
    readonly transport: Transport,
    private streams: StreamHub,
    readonly adapters: Map<string, ProfileAdapter>,
    private clock: Clock = browserClock,
  ) {}

  configure(config: RobotConfig | undefined, robot: string, connected: boolean, generation: number) {
    if (generation !== this.generation) {
      this.requested = false;
      this.pending = false;
      void this.stopAll();
      for (const s of this.sessions.values()) s.feedback.forEach((release) => release());
      this.sessions.clear();
    }
    this.generation = generation;
    this.config = config;
    this.robot = robot;
    this.connected = connected;
  }
  observeOwner(owner: string) {
    if (this.owner === owner) return;
    this.owner = owner;
    if (owner !== this.transport.identity) {
      this.requested = false;
      void this.stopAll();
    }
  }
  get ownsControl() {
    return this.connected && this.requested && this.owner === this.transport.identity;
  }
  async request() {
    if (!this.connected || !this.config || this.pending) return;
    const generation = this.generation;
    const robot = this.robot;
    this.pending = true;
    this.ownershipError = '';
    try {
      const response = await this.transport.rpc(
        robot,
        'portal.set_active_operator',
        this.transport.identity,
        3000,
      );
      if (generation !== this.generation) return;
      if (response !== '')
        throw new Error('Unexpected Portal handoff response. Expected an empty string.');
      this.requested = true;
    } catch (error) {
      if (generation === this.generation) this.ownershipError = errorMessage(error);
    } finally {
      if (generation === this.generation) this.pending = false;
    }
  }
  async release() {
    const robot = this.robot;
    const generation = this.generation;
    this.requested = false;
    const stopped = await this.stopAll();
    if (!stopped) this.ownershipError = 'A command release failed. All inputs remain disarmed.';
    if (generation !== this.generation || !this.connected || this.owner !== this.transport.identity)
      return;
    try {
      const result = await this.transport.rpc(robot, 'portal.set_active_operator', '', 3000);
      if (result !== '') throw new Error('Unexpected Portal release response.');
    } catch (error) {
      if (generation === this.generation) this.ownershipError = errorMessage(error);
    }
  }
  session(id: string) {
    return this.sessions.get(id);
  }
  operation(id: string) {
    const s = this.sessions.get(id);
    const [equipmentId, channel] = controlTarget(id);
    const op = s
      ? own(own(this.config?.control_interfaces, equipmentId)?.operations, s.operation)
      : undefined;
    return op && (op.control_channel ?? 'primary') === channel ? op : undefined;
  }
  adapter(id: string) {
    const op = this.operation(id);
    return op ? this.adapters.get(op.profile) : undefined;
  }
  context(id: string): AdapterContext {
    const [interfaceId] = controlTarget(id);
    const rawEquipment = own(this.config?.control_interfaces, interfaceId)!;
    const operation = this.operation(id)!;
    const equipment = operation.joint_names
      ? { ...rawEquipment, joint_names: operation.joint_names }
      : rawEquipment;
    return {
      sessionKey: this.sessions.get(id),
      interfaceId,
      operationId: this.sessions.get(id)?.operation,
      equipment,
      operation,
      feedback: Object.fromEntries(
        operation.feedback_tracks.map((track) => [
          track,
          this.streams.view(this.feedbackId(id, track)).value,
        ]),
      ),
    };
  }
  private feedbackId(id: string, track: string) {
    return JSON.stringify(['control', id, track]);
  }
  private bindFeedback(id: string) {
    const s = this.sessions.get(id);
    const op = this.operation(id);
    if (!s || !op || !this.visible || !this.adapter(id)) return;
    s.feedback.forEach((release) => release());
    s.feedback = [];
    const requiredType =
      this.adapter(id)?.mandatoryFeedback === 'joints'
        ? 'sensor_msgs/msg/JointState'
        : this.adapter(id)?.mandatoryFeedback === 'pose'
          ? 'geometry_msgs/msg/PoseStamped'
          : undefined;
    for (const track of op.feedback_tracks)
      s.feedback.push(
        this.streams.acquire(this.feedbackId(id, track), {
          robot: this.robot,
          source: {
            kind: 'data',
            track_name: track,
            field_path: [],
            expected_msg_type: requiredType,
          },
          select: (value) => {
            const ctx = this.context(id);
            ctx.feedback[track] = value;
            this.adapter(id)?.validateFeedback(value, ctx);
            return value;
          },
        }),
      );
  }
  async select(id: string, operation: string, presentation: string) {
    const old = this.sessions.get(id);
    if (old?.switching) return;
    if (old?.operation === operation && old.presentation === presentation) return;
    const generation = this.generation;
    if (old) {
      old.switching = true;
      const stopped = await this.stop(id);
      if (generation !== this.generation || this.sessions.get(id) !== old) return;
      old.feedback.forEach((release) => release());
      if (!stopped) {
        old.switching = false;
        return;
      }
    }
    const next: ControlSession = {
      operation,
      presentation,
      armed: false,
      switching: false,
      error: '',
      activation: (old?.activation ?? 0) + 1,
      token: 0,
      feedback: [],
    };
    this.sessions.set(id, next);
    this.bindFeedback(id);
  }
  reason(id: string, includeOwnership = true): string | undefined {
    const s = this.sessions.get(id);
    const equipment = own(this.config?.control_interfaces, controlTarget(id)[0]);
    const op = this.operation(id);
    if (!this.connected || !this.config) return 'Connect and complete robot discovery.';
    if (!this.visible) return 'Control panel is hidden; show it before enabling an input.';
    if (!s || !equipment || !op) return 'Saved operation is absent from this robot.';
    if (!op.presentations.includes(s.presentation))
      return 'Saved presentation is not advertised for this operation.';
    const adapter = this.adapters.get(op.profile);
    if (!adapter)
      return knownProfiles.includes(op.profile)
        ? 'Live adapter disabled: verified device units, limits, release behavior and gateway authorization are not configured.'
        : `Unsupported profile: ${op.profile}.`;
    if (!adapter.presentations.includes(s.presentation) || adapter.msgType !== op.command.msg_type)
      return 'Profile command schema or presentation is incompatible.';
    if (adapter.mandatoryFeedback && !op.feedback_tracks.length)
      return `This profile must declare required ${adapter.mandatoryFeedback} feedback.`;
    if (adapter.mandatoryFeedback === 'joints' && !(op.joint_names ?? equipment.joint_names)?.length)
      return 'Exact joint names are required.';
    for (const track of op.feedback_tracks) {
      const view = this.streams.view(this.feedbackId(id, track));
      if (
        ['invalid', 'unsupported', 'excluded', 'unavailable', 'not_requested'].includes(view.status)
      )
        return `Required feedback ${track}: ${view.reason ?? view.status}`;
      if (view.at === undefined || this.clock.now() - view.at > adapter.maxFeedbackAgeMs)
        return `Required feedback ${track}: missing or too old for control (maximum ${adapter.maxFeedbackAgeMs} ms).`;
    }
    if (s.switching) return 'Ending the previous input session.';
    if (s.error) return s.error;
    if (includeOwnership && !this.ownsControl)
      return 'Request robot control in this browser connection.';
  }
  async arm(id: string) {
    const s = this.sessions.get(id);
    const op = this.operation(id);
    if (!s || !op || this.reason(id) || s.writer || s.switching) return;
    if (
      [...this.sessions.entries()].some(
        ([other, session]) =>
          other !== id &&
          (session.writer || session.switching) &&
          this.operation(other)?.command.track_name === op.command.track_name,
      )
    ) {
      s.error = 'Another interface is using this command destination.';
      return;
    }
    const token = ++s.token;
    const generation = this.generation;
    s.switching = true;
    try {
      this.transport.restrictCommands(this.robot);
      const writer = await this.transport.publish(op);
      if (
        token !== s.token ||
        generation !== this.generation ||
        !this.ownsControl ||
        this.sessions.get(id) !== s
      ) {
        await writer.close();
        return;
      }
      s.writer = writer;
      s.armed = true;
      s.activation++;
      s.lastInputAt = undefined;
    } catch (error) {
      s.error = `Could not publish command track: ${errorMessage(error)}`;
    } finally {
      if (token === s.token) s.switching = false;
    }
  }
  send(id: string, input: ControlInput, activation?: number) {
    const s = this.sessions.get(id);
    const adapter = this.adapter(id);
    if (
      !s?.armed ||
      !s.writer ||
      !adapter ||
      (activation !== undefined && activation !== s.activation)
    )
      return false;
    if (this.reason(id)) {
      void this.stop(id);
      return false;
    }
    try {
      s.writer.push(adapter.encode(input, this.context(id)));
      s.lastInputAt = this.clock.now();
      s.lastInput = structuredClone(input);
      return true;
    } catch (error) {
      s.error = `Command rejected: ${errorMessage(error)}`;
      void this.stop(id);
      return false;
    }
  }
  stop(id: string): Promise<boolean> {
    const s = this.sessions.get(id);
    if (!s) return Promise.resolve(true);
    if (s.ending) return s.ending;
    s.armed = false;
    s.token++;
    s.activation++;
    s.lastInputAt = undefined;
    s.lastInput = undefined;
    const writer = s.writer;
    s.writer = undefined;
    if (!writer) {
      s.switching = false;
      return Promise.resolve(!s.error);
    }
    s.switching = true;
    const token = s.token;
    s.ending = (async () => {
      try {
        if (this.connected) {
          const adapter = this.adapter(id);
          if (!adapter) throw new Error('Release adapter is unavailable.');
          writer.push(adapter.release(this.context(id)));
          await writer.flush();
        }
        await writer.close();
        return true;
      } catch (error) {
        s.error = `Release failed; mode remains disarmed: ${errorMessage(error)}`;
        await writer.close().catch(() => {});
        return false;
      } finally {
        if (token === s.token) s.switching = false;
      }
    })().finally(() => {
      s.ending = undefined;
    });
    return s.ending;
  }
  acknowledge(id: string) {
    const s = this.sessions.get(id);
    if (s && !s.armed && !s.switching) s.error = '';
  }
  async stopAll() {
    const results = await Promise.all([...this.sessions.keys()].map((id) => this.stop(id)));
    return results.every(Boolean);
  }
  setVisible(visible: boolean) {
    if (this.visible === visible) return;
    this.visible = visible;
    if (!visible) void this.stopAll();
    for (const [id, s] of this.sessions) {
      s.feedback.forEach((release) => release());
      s.feedback = [];
      if (visible) this.bindFeedback(id);
    }
  }
  tick() {
    for (const [id, s] of this.sessions) {
      if (
        s.armed &&
        (this.reason(id) ||
          (!IDLE_PROFILES.includes(this.operation(id)?.profile ?? '') &&
            s.lastInputAt !== undefined &&
            this.clock.now() - s.lastInputAt > 250))
      )
        void this.stop(id);
      else if (
        s.armed &&
        s.lastInput &&
        s.lastInputAt !== undefined &&
        REPEAT_PROFILES.includes(this.operation(id)?.profile ?? '')
      ) {
        const interval = this.adapter(id)?.repeatIntervalMs;
        if (interval && this.clock.now() - s.lastInputAt >= interval)
          this.send(id, s.lastInput, s.activation);
      }
    }
  }
  dispose() {
    void this.stopAll();
    for (const s of this.sessions.values()) s.feedback.forEach((release) => release());
  }
}
