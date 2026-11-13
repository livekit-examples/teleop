import { controlKey, type ControlInput } from '../controls';
import type { WorkspaceRuntime } from '../runtime';
import { selectJoints } from '../selectors';
import { fromQuat, norm, sub, toQuat, turnBetween, type V3 } from './linalg';
import {
  ArmFollower,
  Clutch,
  HandSize,
  assignSides,
  cameraToBase,
  defaultMapping,
  handPose,
  type Hand,
  type HandPose,
  type Mapping,
} from './math';

type Pose = NonNullable<ControlInput['pose']>;
type Side = 'left' | 'right';

/** One webcam frame and the hands in it. `at` is in milliseconds on the performance clock. */
export type Sighting = {
  seq: number;
  at: number;
  width: number;
  height: number;
  hands: Hand[];
};

export type HandSettings = {
  frame: 'tool' | 'base';
  rotate: 'full' | 'off';
  scale: number;
  swapSides: boolean;
  /** The webcam's horizontal field of view, in degrees. */
  hfovDeg: number;
};
export const defaultHandSettings: HandSettings = {
  frame: 'tool',
  rotate: 'full',
  scale: 1,
  swapSides: false,
  hfovDeg: 70,
};

/** Hands not seen for this long are let go. */
const STALE_MS = 250;
/** A palm that moves this far between two frames is a tracking glitch, or two hands swapped. */
const MAX_JUMP_M = 0.08;
/** A palm that turns this far between two frames is one too. */
const MAX_FLIP_RAD = Math.PI / 4;

type Arm = {
  clutch: Clutch;
  follower: ArmFollower;
  size: HandSize;
  gripSize?: number;
  pose?: HandPose;
  image?: [number, number][];
  lastPosition?: V3;
  lastRotation?: number[];
  /** The interface this arm drove when it last engaged. */
  engagedId?: string;
  /** False until the hand has been open once while the interface was allowed. */
  ready: boolean;
  lastTick?: number;
  note: string;
};

/**
 * Hand-tracking Cartesian teleoperation. Each grip takes a fresh reference from the robot's
 * measured pose, so a target never depends on where a hand was before. The caller passes each
 * webcam frame to `update`. The robot solves its own IK from the PoseStamped targets.
 */
export class HandTeleop {
  private arms: Record<Side, Arm>;
  private seen = -1;
  private applied: string;

  constructor(
    private runtime: WorkspaceRuntime,
    private settings: () => HandSettings,
  ) {
    this.arms = { left: this.make(), right: this.make() };
    this.applied = JSON.stringify(this.settings());
  }

  private make(): Arm {
    return {
      clutch: new Clutch(),
      follower: new ArmFollower(this.mapping()),
      size: new HandSize(),
      ready: false,
      note: '',
    };
  }

  private mapping(): Mapping {
    const s = this.settings();
    return defaultMapping({
      frame: s.frame,
      rotate: s.rotate,
      scale: s.scale,
      to_base: cameraToBase(),
    });
  }

  /** What an arm shows on the overlay. */
  view(side: Side) {
    const arm = this.arms[side];
    return {
      image: arm.image,
      curl: arm.pose?.curl,
      gripping: arm.follower.engaged,
      moved: arm.follower.moved(),
      turned: arm.follower.turned(),
      grip: arm.follower.grip,
      waiting: arm.follower.gripWaiting,
    };
  }

  /** Control is allowed only for an armed interface that uses the hand tracking presentation. */
  private allowed(id: string) {
    const control = this.runtime.controls.session(id);
    return (
      !!control &&
      control.armed &&
      control.presentation === 'hand_tracking' &&
      this.runtime.controls.operation(id)?.profile === 'arm.cartesian_pose.v1'
    );
  }

  private why(id: string) {
    const control = this.runtime.controls.session(id);
    if (!control) return 'interface unavailable';
    if (!control.armed) return 'not armed. Acquire control, then Arm';
    if (control.presentation !== 'hand_tracking')
      return `presentation is ${control.presentation}. Switch it to hand_tracking`;
    return 'this operation is not a Cartesian arm';
  }

  private report(side: Side, message: string) {
    const arm = this.arms[side];
    if (arm.note === message) return;
    arm.note = message;
    this.runtime.handStatus[side] = message;
    this.runtime.notify();
  }

  private feedbackPose(id: string): Pose | undefined {
    const feedback = Object.values(this.runtime.controls.context(id).feedback)[0] as
      | { pose?: Pose }
      | undefined;
    return feedback?.pose;
  }

  /** Ends an engagement. The robot holds its measured pose instead of travelling to the last target. */
  private stop(side: Side) {
    const arm = this.arms[side];
    const id = arm.engagedId;
    if (!arm.follower.engaged || !id) return;
    arm.follower.release();
    arm.engagedId = undefined;
    const pose = this.feedbackPose(id);
    if (pose) this.runtime.controls.send(id, { pose: structuredClone(pose) });
  }

  /** The gripper opening of the interface's gripper channel, as 0 closed to 1 open. */
  private gripperState(id: string) {
    const { controls } = this.runtime;
    const key = controlKey(id, 'gripper');
    const session = controls.session(key);
    if (!session?.armed) return undefined;
    const ctx = controls.context(key);
    const name = ctx.equipment.joint_names?.[0];
    const targets = controls.adapter(key)?.gripperTargets?.(ctx);
    if (!name || !targets) return undefined;
    let position: number | undefined;
    try {
      position = selectJoints(Object.values(ctx.feedback)[0], [name])[0].position;
    } catch {
      return undefined;
    }
    if (position === undefined) return undefined;
    return { key, name, targets, session, position };
  }

  /** Feed one webcam frame, or null when there is none. Call each animation frame. */
  update(now: number, sighting: Sighting | null) {
    // A follower keeps the mapping it was made with, so a changed setting starts them afresh.
    const settings = JSON.stringify(this.settings());
    if (settings !== this.applied) {
      this.stopAll();
      this.arms = { left: this.make(), right: this.make() };
      this.applied = settings;
    }
    const fresh = !!sighting && now - sighting.at < STALE_MS;
    if (fresh && sighting.seq !== this.seen) this.see(sighting);
    if (!fresh) {
      for (const side of ['left', 'right'] as Side[]) {
        const arm = this.arms[side];
        if (arm.follower.engaged) {
          this.stop(side);
          this.report(side, 'let go: webcam stalled');
        }
        arm.clutch.update(null);
        arm.follower.forget();
        arm.pose = arm.image = undefined;
        arm.lastPosition = arm.lastRotation = undefined;
      }
    }
    for (const side of ['left', 'right'] as Side[]) this.drive(side, now);
  }

  private see(sighting: Sighting) {
    this.seen = sighting.seq;
    const settings = this.settings();
    const focal = sighting.width / 2 / Math.tan((settings.hfovDeg * Math.PI) / 360);
    const centre: [number, number] = [sighting.width / 2, sighting.height / 2];
    const hands = assignSides(sighting.hands, settings.swapSides);
    for (const side of ['left', 'right'] as Side[]) {
      const arm = this.arms[side];
      const hand = hands[side];
      if (hand) arm.size.add(hand.world);
      const size = arm.follower.engaged ? arm.gripSize : arm.size.value;
      const pose = hand ? handPose(hand, sighting.at / 1000, focal, centre, size) : null;
      const jumped =
        !!pose && !!arm.lastPosition && norm(sub(pose.position, arm.lastPosition)) > MAX_JUMP_M;
      const flipped =
        !!pose &&
        !!arm.lastRotation &&
        settings.rotate !== 'off' &&
        turnBetween(arm.lastRotation, pose.rotation) > MAX_FLIP_RAD;
      arm.lastPosition = pose?.position;
      arm.lastRotation = pose?.rotation;
      arm.pose = pose ?? undefined;
      arm.image = hand?.image;
      const glitch = jumped || flipped;
      if (glitch && arm.clutch.closed) {
        this.stop(side);
        this.report(
          side,
          `the hand ${jumped ? 'jumped' : 'flipped'} (tracking glitch?). Let go and grip again`,
        );
      }
      arm.clutch.update(!pose || glitch ? null : pose.curl);
      if (!pose || glitch) arm.follower.forget();
      else arm.follower.observe(pose, arm.clutch.closed);
    }
  }

  private drive(side: Side, now: number) {
    const { runtime } = this;
    const arm = this.arms[side];
    const id = runtime.layout?.tracked_hands?.[side];
    if (!id) {
      this.report(side, 'no interface bound');
      return;
    }
    if (!this.allowed(id)) {
      this.stop(side);
      arm.ready = false;
      this.report(side, this.why(id));
      return;
    }
    if (!arm.pose) {
      this.report(side, 'hand not seen');
      return;
    }
    const gripping = arm.clutch.closed;
    if (!arm.ready) {
      // A grip that was held while the interface became allowed never engages by arming.
      if (!gripping) arm.ready = true;
      this.report(
        side,
        gripping ? 'open your hand, then grip' : 'ready. Curl three fingers to move',
      );
      return;
    }
    if (!gripping) {
      if (arm.follower.engaged) this.stop(side);
      this.report(side, 'ready. Curl three fingers to move');
      return;
    }
    if (!arm.follower.engaged) {
      const feedback = this.feedbackPose(id);
      if (!feedback) {
        this.report(side, 'waiting for the robot pose. Open your hand and try again');
        return;
      }
      const gripper = this.gripperState(id);
      const span = gripper ? gripper.targets.open - gripper.targets.closed : 0;
      const grip =
        gripper && span ? (gripper.position - gripper.targets.closed) / span : arm.follower.grip;
      arm.gripSize = arm.size.value;
      arm.follower.engage(
        {
          position: [feedback.position.x, feedback.position.y, feedback.position.z],
          rotation: fromQuat(feedback.orientation),
        },
        Math.min(1, Math.max(0, grip)),
      );
      arm.engagedId = id;
      arm.lastTick = now;
    }
    const dt = Math.min(0.1, Math.max(0.001, (now - (arm.lastTick ?? now)) / 1000));
    arm.lastTick = now;
    const goal = arm.follower.goal(dt);
    const target: Pose = {
      position: { x: goal.position[0], y: goal.position[1], z: goal.position[2] },
      orientation: toQuat(goal.rotation),
    };
    if (!runtime.controls.send(id, { pose: target })) {
      this.stop(side);
      arm.ready = false;
      this.report(side, 'robot refused the command. Open your hand and try again');
      return;
    }
    const gripper = this.gripperState(id);
    if (gripper) {
      const { open, closed } = gripper.targets;
      runtime.controls.send(
        gripper.key,
        { joints: { [gripper.name]: closed + (open - closed) * arm.follower.grip } },
        gripper.session.activation,
      );
    }
    this.report(side, arm.follower.gripWaiting ? 'moving (gripper waits for the pinch)' : 'moving');
  }

  /** Lets go of every arm and forgets the hands. Interfaces stay armed. */
  stopAll() {
    for (const side of ['left', 'right'] as Side[]) {
      const arm = this.arms[side];
      this.stop(side);
      arm.clutch.update(null);
      arm.follower.forget();
      arm.ready = false;
    }
  }
}
