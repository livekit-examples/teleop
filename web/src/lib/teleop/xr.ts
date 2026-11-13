import type { WorkspaceRuntime } from './runtime';
import { controlKey, type ControlInput } from './controls';
import { selectJoints } from './selectors';

type Pose = NonNullable<ControlInput['pose']>;
type Q = Pose['orientation'];
type Vec = Pose['position'];
const multiply = (a: Q, b: Q): Q => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});

/** One controller, as read from one XR frame. `pose` is read only while grip is held. */
export type XrHandSample = {
  handedness: 'left' | 'right';
  grip: boolean;
  /** Thumbstick X, from -1 to 1. */
  stick?: number;
  pose(): { position: Vec; orientation: Q } | null;
};

type Engagement = {
  point: Vec;
  q: Q;
  robot: Pose;
  last: Vec;
  lastQ: Q;
  at: number;
};

/** Stick travel below this fraction does not move the gripper. */
const STICK_DEADZONE = 0.15;
/** A fully pushed stick crosses the gripper range in this many seconds. */
const GRIPPER_FULL_TRAVEL_S = 2;

/**
 * Grip-relative Cartesian teleoperation. Each engagement takes a fresh reference, so a robot
 * pose never depends on where a controller was before. The caller reads controllers each XR
 * frame and passes them to `update`.
 */
export class XrTeleop {
  private engaged = new Map<string, Engagement>();
  private pressed = new Map<string, boolean>();
  /** The gripper position that each driven gripper channel last received. */
  private gripper = new Map<string, { target: number; at: number }>();

  constructor(
    private runtime: WorkspaceRuntime,
    private status: (message: string) => void,
  ) {}

  /**
   * Ends an engagement. The interface stays armed, and the robot holds its last target, until the
   * operator disarms it.
   */
  private stop(id: string) {
    if (!this.engaged.delete(id)) return;
    // Aim the robot at where it is now. Without this it keeps moving to the last target it was
    // given, which can be well past the point where the operator let go.
    const pose = this.feedbackPose(id);
    if (pose) this.runtime.controls.send(id, { pose: structuredClone(pose) });
  }

  /** A hand moves a robot only while its interface is armed with the VR presentation. */
  private allowed(id: string) {
    const control = this.runtime.controls.session(id);
    return (
      !!control &&
      control.armed &&
      control.presentation === 'vr' &&
      this.runtime.controls.operation(id)?.profile === 'arm.cartesian_pose.v1'
    );
  }

  /** Why a hand does not move a robot, in words for the operator. */
  private why(id: string) {
    const control = this.runtime.controls.session(id);
    if (!control) return 'interface unavailable';
    if (!control.armed) return 'not armed. Acquire control, then Arm';
    if (control.presentation !== 'vr') return `presentation is ${control.presentation}. Switch it to vr`;
    return 'this operation is not a Cartesian arm';
  }

  private suffix: Record<'left' | 'right', string> = { left: '', right: '' };

  private feedbackPose(id: string): Pose | undefined {
    const feedback = Object.values(this.runtime.controls.context(id).feedback)[0] as
      | { pose?: Pose }
      | undefined;
    return feedback?.pose;
  }

  private report(hand: 'left' | 'right', base: string) {
    const message = base + this.suffix[hand];
    if (this.runtime.xrHands[hand] === message) return;
    this.runtime.xrHands[hand] = message;
    this.runtime.notify();
  }

  /**
   * The thumbstick moves the gripper of the hand's interface, with or without grip. Out, away from
   * the other hand, opens it and in closes it. The gripper channel must be armed.
   */
  private driveGripper(id: string, hand: XrHandSample, now: number) {
    const { controls } = this.runtime;
    const key = controlKey(id, 'gripper');
    const session = controls.session(key);
    if (!session?.armed) return 'off';
    const x = hand.stick ?? 0;
    const travel = (Math.abs(x) - STICK_DEADZONE) / (1 - STICK_DEADZONE);
    const previous = this.gripper.get(key);
    if (travel <= 0) {
      if (previous) this.gripper.set(key, { ...previous, at: now });
      return 'on';
    }
    const ctx = controls.context(key);
    const name = ctx.equipment.joint_names?.[0];
    const targets = controls.adapter(key)?.gripperTargets?.(ctx);
    if (!name || !targets) return 'on';
    const outward = hand.handedness === 'left' ? -1 : 1;
    const speed = outward * Math.sign(x) * Math.min(1, travel);
    let target = previous?.target;
    if (target === undefined) {
      try {
        target = selectJoints(Object.values(ctx.feedback)[0], [name])[0].position;
      } catch {
        // Falls through to the missing position below.
      }
      if (target === undefined) return 'no gripper position yet';
    }
    const seconds = Math.min(0.1, Math.max(0, (now - (previous?.at ?? now)) / 1000));
    const range = targets.open - targets.closed;
    target = Math.min(
      Math.max(targets.open, targets.closed),
      Math.max(Math.min(targets.open, targets.closed), target + (speed * range * seconds) / GRIPPER_FULL_TRAVEL_S),
    );
    this.gripper.set(key, { target, at: now });
    controls.send(key, { joints: { [name]: target } }, session.activation);
    return 'on';
  }

  update(now: number, hands: XrHandSample[]) {
    const { runtime } = this;
    const visible = new Set<string>();
    for (const side of ['left', 'right'] as const)
      if (!hands.some((hand) => hand.handedness === side)) this.report(side, 'controller not tracked');
    for (const hand of hands) {
      const id = runtime.layout?.controller_hands?.[hand.handedness];
      this.suffix[hand.handedness] = '';
      if (!id) {
        this.report(hand.handedness, 'no interface bound');
        continue;
      }
      const state = this.driveGripper(id, hand, now);
      if (runtime.controls.session(controlKey(id, 'gripper')))
        this.suffix[hand.handedness] =
          state === 'on'
            ? ' · gripper on'
            : state === 'off'
              ? ' · gripper off: Enable gripper'
              : ` · ${state}`;
      if (!this.allowed(id)) {
        this.report(hand.handedness, this.why(id));
        // A hand that cannot move a robot forgets its grip, so a held grip never engages by arming.
        this.pressed.delete(id);
        if (this.engaged.has(id)) this.stop(id);
        continue;
      }
      visible.add(id);
      const was = this.pressed.get(id);
      this.pressed.set(id, hand.grip);
      // Seed held buttons without treating them as a new engagement.
      if (was === undefined) {
        this.report(hand.handedness, hand.grip ? 'release grip, then press it' : 'ready. Hold grip to move');
        continue;
      }
      if (!hand.grip) {
        if (this.engaged.has(id)) this.stop(id);
        this.report(hand.handedness, 'ready. Hold grip to move');
        continue;
      }
      const pose = hand.pose();
      if (
        !pose ||
        ![
          pose.position.x,
          pose.position.y,
          pose.position.z,
          pose.orientation.x,
          pose.orientation.y,
          pose.orientation.z,
          pose.orientation.w,
        ].every(Number.isFinite)
      ) {
        this.stop(id);
        this.status(`${id}: controller tracking unavailable; release grip.`);
        continue;
      }
      if (!was && !this.engaged.has(id)) {
        const robot = this.feedbackPose(id);
        if (!robot) {
          this.stop(id);
          this.report(hand.handedness, 'waiting for the robot pose. Release grip and try again');
          continue;
        }
        this.engaged.set(id, {
          point: pose.position,
          q: pose.orientation,
          robot: structuredClone(robot),
          last: pose.position,
          lastQ: pose.orientation,
          at: now,
        });
      }
      const origin = this.engaged.get(id);
      if (!origin) continue;
      const q = pose.orientation;
      const angle =
        2 *
        Math.acos(
          Math.min(
            1,
            Math.abs(
              q.x * origin.lastQ.x +
                q.y * origin.lastQ.y +
                q.z * origin.lastQ.z +
                q.w * origin.lastQ.w,
            ),
          ),
        );
      if (
        now - origin.at > 160 ||
        angle > 0.5 ||
        Math.hypot(
          pose.position.x - origin.last.x,
          pose.position.y - origin.last.y,
          pose.position.z - origin.last.z,
        ) > 0.08
      ) {
        this.stop(id);
        this.status(`${id}: tracking gap/jump; release grip.`);
        this.report(hand.handedness, 'tracking jump. Release grip and try again');
        continue;
      }
      const point = pose.position;
      const delta = multiply(q, {
        x: -origin.q.x,
        y: -origin.q.y,
        z: -origin.q.z,
        w: origin.q.w,
      });
      const target: Pose = {
        position: {
          x: origin.robot.position.x - (point.z - origin.point.z),
          y: origin.robot.position.y - (point.x - origin.point.x),
          z: origin.robot.position.z + (point.y - origin.point.y),
        },
        orientation: multiply(origin.robot.orientation, {
          x: -delta.z,
          y: -delta.x,
          z: delta.y,
          w: delta.w,
        }),
      };
      if (!runtime.controls.send(id, { pose: target })) {
        this.stop(id);
        this.report(hand.handedness, 'robot refused the command. Release grip and try again');
        continue;
      }
      origin.last = point;
      origin.lastQ = q;
      origin.at = now;
      this.report(hand.handedness, 'moving');
    }
    for (const id of this.engaged.keys())
      if (!visible.has(id)) {
        this.stop(id);
        this.pressed.delete(id);
      }
  }

  /** Ends every engagement and disarms every armed VR input. Other inputs keep their state. */
  stopAll() {
    this.engaged.clear();
    this.pressed.clear();
    for (const key of this.gripper.keys()) void this.runtime.controls.stop(key);
    this.gripper.clear();
    for (const [id, session] of this.runtime.controls.sessions)
      if (session.armed && session.presentation === 'vr') void this.runtime.controls.stop(id);
  }
}
