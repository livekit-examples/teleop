import type { WorkspaceRuntime } from './runtime';
import type { ControlInput } from './controls';

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

/**
 * Grip-relative Cartesian teleoperation. Each engagement takes a fresh reference, so a robot
 * pose never depends on where a controller was before. The caller reads controllers each XR
 * frame and passes them to `update`.
 */
export class XrTeleop {
  private engaged = new Map<string, Engagement>();
  private pressed = new Map<string, boolean>();

  constructor(
    private runtime: WorkspaceRuntime,
    private status: (message: string) => void,
  ) {}

  private stop(id: string) {
    this.engaged.delete(id);
    void this.runtime.controls.stop(id);
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

  update(now: number, hands: XrHandSample[]) {
    const { runtime } = this;
    const visible = new Set<string>();
    for (const hand of hands) {
      const id = runtime.layout?.controller_hands?.[hand.handedness];
      if (!id) continue;
      if (!this.allowed(id)) {
        // A hand that cannot move a robot forgets its grip, so a held grip never engages by arming.
        this.pressed.delete(id);
        if (this.engaged.has(id)) this.stop(id);
        continue;
      }
      visible.add(id);
      const was = this.pressed.get(id);
      this.pressed.set(id, hand.grip);
      // Seed held buttons without treating them as a new engagement.
      if (was === undefined) continue;
      if (!hand.grip) {
        if (this.engaged.has(id)) this.stop(id);
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
        const feedback = Object.values(runtime.controls.context(id).feedback)[0] as
          | { pose?: Pose }
          | undefined;
        if (!feedback?.pose) {
          this.stop(id);
          continue;
        }
        this.engaged.set(id, {
          point: pose.position,
          q: pose.orientation,
          robot: structuredClone(feedback.pose),
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
        continue;
      }
      origin.last = point;
      origin.lastQ = q;
      origin.at = now;
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
    for (const [id, session] of this.runtime.controls.sessions)
      if (session.armed && session.presentation === 'vr') void this.runtime.controls.stop(id);
  }
}
