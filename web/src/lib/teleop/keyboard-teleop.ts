import type { ControlInput, ControlManager } from './controls';
import { KeyboardSteering } from './keyboard-steering';
import { ARM_KEY, DISARM_KEY, FOCUS_KEY, planKeymap, type Binding, type Keymap, type Part } from './keymap';
import { selectJoints } from './selectors';

type Pose = NonNullable<ControlInput['pose']>;

/** End-effector speed at 100 % (m/s). */
export const CARTESIAN_SPEED = 0.15;
/** A keyboard target never leads the measured end effector by more than this (m). */
export const CARTESIAN_LEASH = 0.1;
/** Joint-jog velocity at 100 %, in the profile's normalized units (fixture: rad/s, ±1). */
export const JOG_SPEED = 1;
/** Joint-position step rate at 100 % (rad/s) for trajectory-only parts. */
export const POSITION_RATE = 0.6;
/** A target older than this re-reads the robot before the next step (ms). */
const TARGET_TTL = 1000;

export type KeyEventLike = { code: string; shiftKey?: boolean; repeat?: boolean };

/**
 * One keyboard router for the whole robot. It arms every keyboard-mapped part in one step, reads
 * the keymap from `planKeymap`, and turns held keys into commands every tick. Each armed session
 * still goes through ControlManager, so every existing check (ownership, feedback age, adapter
 * limits, release on stop) applies unchanged.
 */
export class KeyboardTeleop {
  readonly held = new Set<string>();
  shift = false;
  /** Speed scale, 0.1–1. */
  speed = 0.5;
  /** Index into keymap.focus. */
  focused = 0;
  readonly excluded = new Set<string>();
  /** Set on arm; cleared once every key has been up. Motion waits for it. */
  waitingForNeutral = false;
  busy = false;
  problems: string[] = [];
  keymap: Keymap = { parts: [], focus: [] };
  private cartesian = new Map<string, { target: Pose; at: number }>();
  private positions = new Map<string, { target: Record<string, number>; at: number }>();
  private selectedJoint = new Map<string, number>();
  private steering = new Map<string, KeyboardSteering>();
  private last?: number;

  constructor(
    private manager: ControlManager,
    private notify: () => void = () => {},
    private now: () => number = () => performance.now(),
    private wait: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  /** Re-plan from the current config and Advanced choices. Cheap; call before reading. */
  refresh(): Keymap {
    const current = Object.fromEntries(
      [...this.manager.sessions].map(([key, session]) => [key, session.operation]),
    );
    this.keymap = planKeymap(this.manager.config, current);
    if (this.focused >= this.keymap.focus.length) this.focused = 0;
    return this.keymap;
  }

  /** Bindings of included parts (all of them, focus or not). */
  bindings(parts: string[] = this.keymap.parts.map((p) => p.id)): Binding[] {
    return this.keymap.parts
      .filter((p) => parts.includes(p.id) && !this.excluded.has(p.id))
      .flatMap((p) => p.bindings);
  }
  isArmed(binding: Binding): boolean {
    const session = this.manager.session(binding.key);
    return (
      !!session?.armed &&
      session.presentation === 'keyboard' &&
      session.operation === binding.operation
    );
  }
  /** Any keyboard binding is armed. */
  get engaged(): boolean {
    return this.keymap.parts.some((p) => p.bindings.some((b) => this.isArmed(b)));
  }
  /** Included parts that have keys. */
  mappedParts(): Part[] {
    return this.keymap.parts.filter((p) => p.bindings.length && !this.excluded.has(p.id));
  }
  /** Every included, mapped part is armed. */
  get fullyArmed(): boolean {
    const parts = this.mappedParts();
    return parts.length > 0 && parts.every((p) => this.partArmed(p));
  }
  partArmed(part: Part): boolean {
    return part.bindings.length > 0 && part.bindings.every((b) => this.isArmed(b));
  }
  /** Bindings that respond to keys right now. */
  active(): Binding[] {
    const focused = this.keymap.focus[this.focused];
    return this.bindings().filter((b) => this.isArmed(b) && (!b.focus || b.part === focused));
  }
  selectedJointOf(binding: Binding): string | undefined {
    return binding.joints?.[this.selectedJoint.get(binding.key) ?? 0];
  }

  /** Every key a binding listens to. */
  static codes(binding: Binding): string[] {
    return [
      ...Object.values(binding.keys),
      ...(binding.pairs ?? []).flatMap((pair) => [pair.minus, pair.plus]),
    ];
  }
  private pressed(code?: string): number {
    return code && this.held.has(code) && !this.waitingForNeutral ? 1 : 0;
  }
  private axis(binding: Binding, plus: keyof Binding['keys'], minus: keyof Binding['keys']) {
    return this.pressed(binding.keys[plus]) - this.pressed(binding.keys[minus]);
  }

  /** Returns true when the key belongs to an armed binding, so the caller can preventDefault. */
  keydown(event: KeyEventLike): boolean {
    this.shift = !!event.shiftKey;
    if (event.code === DISARM_KEY) {
      if (!this.engaged) return false;
      void this.disarmAll();
      return true;
    }
    // Shift + A arms every included part. While everything is armed it does nothing, so the
    // chord never doubles as motion.
    if (event.code === ARM_KEY && event.shiftKey) {
      if (!this.mappedParts().length) return false;
      if (!event.repeat && !this.busy && !this.fullyArmed) void this.armAll();
      return true;
    }
    const active = this.active();
    if (!active.length) return false;
    if (event.code === FOCUS_KEY && this.keymap.focus.length) {
      if (!event.repeat) {
        const count = this.keymap.focus.length;
        this.focus((this.focused + (event.shiftKey ? count - 1 : 1)) % count);
      }
      return true;
    }
    const owners = this.bindings().filter(
      (b) => this.isArmed(b) && KeyboardTeleop.codes(b).includes(event.code),
    );
    if (!owners.length) return false;
    // A key that was already down when the robot armed only repeats; it never starts motion.
    if (event.repeat || this.held.has(event.code)) return true;
    if (this.waitingForNeutral && this.held.size === 0) this.waitingForNeutral = false;
    this.held.add(event.code);
    if (this.waitingForNeutral) {
      this.notify();
      return true;
    }
    for (const binding of active) {
      if (binding.kind === 'gripper') {
        if (binding.keys.open === event.code) this.grip(binding, 'open');
        if (binding.keys.close === event.code) this.grip(binding, 'closed');
      }
      if (binding.kind === 'jog' && (binding.joints?.length ?? 0) > 1) {
        const step =
          binding.keys.next === event.code ? 1 : binding.keys.prev === event.code ? -1 : 0;
        if (step) {
          const count = binding.joints!.length;
          const index = this.selectedJoint.get(binding.key) ?? 0;
          this.selectedJoint.set(binding.key, (index + step + count) % count);
        }
      }
    }
    this.notify();
    return true;
  }
  keyup(event: KeyEventLike) {
    this.shift = !!event.shiftKey;
    if (!this.held.delete(event.code)) return;
    if (this.waitingForNeutral && this.held.size === 0) this.waitingForNeutral = false;
    this.notify();
  }
  /** Window blur or hidden tab: let go of everything. */
  releaseAll() {
    this.held.clear();
    this.shift = false;
    this.notify();
  }
  setSpeed(value: number) {
    this.speed = Math.max(0.1, Math.min(1, value));
    this.notify();
  }
  focus(index: number) {
    if (index < 0 || index >= this.keymap.focus.length) return;
    this.focused = index;
    this.held.clear();
    this.notify();
  }

  private grip(binding: Binding, which: 'open' | 'closed') {
    const ctx = this.manager.context(binding.key);
    const name = ctx.equipment.joint_names?.[0];
    const targets = this.manager.adapter(binding.key)?.gripperTargets?.(ctx);
    if (!name || !targets) {
      this.problems = [`${this.label(binding)}: gripper targets unavailable.`];
      return;
    }
    const session = this.manager.session(binding.key);
    this.manager.send(binding.key, { joints: { [name]: targets[which] } }, session?.activation);
  }
  private label(binding: Binding) {
    return this.keymap.parts.find((p) => p.id === binding.part)?.label ?? binding.part;
  }

  /** Send one round of commands. Call every ~50 ms while mounted. */
  tick() {
    const now = this.now();
    const dt = this.last === undefined ? 0.05 : Math.max(0, Math.min(100, now - this.last)) / 1000;
    this.last = now;
    if (this.waitingForNeutral && this.held.size === 0) this.waitingForNeutral = false;
    let changed = false;
    for (const binding of this.active()) {
      const session = this.manager.session(binding.key)!;
      const send = (input: ControlInput) => {
        if (!this.manager.send(binding.key, input, session.activation)) changed = true;
      };
      try {
        if (binding.kind === 'drive') {
          const forward = this.axis(binding, 'forward', 'back');
          let turn = this.axis(binding, 'left', 'right');
          const strafe = this.axis(binding, 'strafe_left', 'strafe_right');
          if (binding.profile === 'base.ackermann_drive.v1') {
            let steering = this.steering.get(binding.key);
            if (!steering) this.steering.set(binding.key, (steering = new KeyboardSteering()));
            turn = steering.sample(turn, dt * 1000);
          }
          send({ axes: [forward * this.speed, turn * this.speed, strafe * this.speed] });
        } else if (binding.kind === 'jog' || binding.kind === 'pairs') {
          const joints = binding.joints ?? [];
          const values: Record<string, number> =
            binding.kind === 'pairs'
              ? Object.fromEntries(
                  (binding.pairs ?? []).map((pair) => [
                    pair.joint,
                    this.pressed(pair.plus) - this.pressed(pair.minus),
                  ]),
                )
              : { [this.selectedJointOf(binding) ?? '']: this.axis(binding, 'plus', 'minus') };
          delete values[''];
          if (binding.jog === 'velocity') {
            const all = this.manager.context(binding.key).equipment.joint_names ?? joints;
            send({
              joints: Object.fromEntries(
                all.map((name) => [name, (values[name] ?? 0) * this.speed * JOG_SPEED]),
              ),
            });
          } else if (Object.values(values).some((v) => v !== 0)) {
            const target = this.positionTarget(binding, now);
            const limits = this.manager
              .adapter(binding.key)
              ?.jointLimits?.(this.manager.context(binding.key));
            for (const [name, direction] of Object.entries(values)) {
              const next = target[name] + direction * this.speed * POSITION_RATE * dt;
              const limit = limits?.[name];
              target[name] = limit ? Math.max(limit.min, Math.min(limit.max, next)) : next;
            }
            send({ joints: { ...target } });
          }
        } else if (binding.kind === 'cartesian') {
          const dx = this.axis(binding, 'forward', 'back');
          const dy = this.axis(binding, 'left', 'right');
          const dz = this.axis(binding, 'up', 'down');
          if (!dx && !dy && !dz) continue;
          const measured = this.measuredPose(binding);
          let entry = this.cartesian.get(binding.key);
          if (!entry || now - entry.at > TARGET_TTL)
            entry = { target: structuredClone(measured), at: now };
          const step = this.speed * CARTESIAN_SPEED * dt;
          const p = entry.target.position;
          const next = { x: p.x + dx * step, y: p.y + dy * step, z: p.z + dz * step };
          // Leash: keep the target within reach of where the arm actually is.
          const lead = {
            x: next.x - measured.position.x,
            y: next.y - measured.position.y,
            z: next.z - measured.position.z,
          };
          const length = Math.hypot(lead.x, lead.y, lead.z);
          const scale = length > CARTESIAN_LEASH ? CARTESIAN_LEASH / length : 1;
          entry.target.position = {
            x: measured.position.x + lead.x * scale,
            y: measured.position.y + lead.y * scale,
            z: measured.position.z + lead.z * scale,
          };
          entry.at = now;
          this.cartesian.set(binding.key, entry);
          send({ pose: structuredClone(entry.target) });
        }
      } catch (error) {
        this.problems = [`${this.label(binding)}: ${(error as Error).message}`];
        void this.manager.stop(binding.key);
        changed = true;
      }
    }
    if (changed) this.notify();
  }

  private measuredPose(binding: Binding): Pose {
    const value = Object.values(this.manager.context(binding.key).feedback)[0] as
      | { pose?: Pose }
      | undefined;
    if (!value?.pose) throw new Error('waiting for the end-effector pose.');
    return value.pose;
  }
  private positionTarget(binding: Binding, now: number) {
    let entry = this.positions.get(binding.key);
    if (!entry || now - entry.at > TARGET_TTL) {
      const ctx = this.manager.context(binding.key);
      const joints = selectJoints(Object.values(ctx.feedback)[0], ctx.equipment.joint_names);
      entry = {
        target: Object.fromEntries(
          joints.map((joint) => {
            if (joint.position === undefined)
              throw new Error(`position feedback missing for ${joint.name}.`);
            return [joint.name, joint.position];
          }),
        ),
        at: now,
      };
    }
    entry.at = now;
    this.positions.set(binding.key, entry);
    return entry.target;
  }

  private reset() {
    this.held.clear();
    this.cartesian.clear();
    this.positions.clear();
    this.steering.clear();
  }

  /**
   * Arm every keyboard-mapped part of the included set (all parts by default). Acquires robot
   * control first when needed. Problems are reported per part; the others still arm.
   */
  async armAll(parts?: string[]) {
    if (this.busy) return;
    this.busy = true;
    this.problems = [];
    this.notify();
    const manager = this.manager;
    try {
      if (!manager.ownsControl) {
        await manager.request();
        if (!manager.ownsControl) {
          this.problems = [manager.ownershipError || 'Could not acquire robot control.'];
          return;
        }
      }
      this.refresh();
      const bindings = this.bindings(parts);
      for (const binding of bindings) {
        const session = manager.session(binding.key);
        if (session?.operation !== binding.operation || session.presentation !== 'keyboard')
          await manager.select(binding.key, binding.operation, 'keyboard');
      }
      // A newly selected session waits for its first feedback sample.
      const deadline = this.now() + 2000;
      while (bindings.some((b) => manager.reason(b.key)) && this.now() < deadline)
        await this.wait(100);
      const problems: string[] = [];
      for (const binding of bindings) {
        if (this.isArmed(binding)) continue;
        const reason = manager.reason(binding.key);
        if (reason) {
          problems.push(`${this.label(binding)}: ${reason}`);
          continue;
        }
        await manager.arm(binding.key);
        if (!this.isArmed(binding))
          problems.push(
            `${this.label(binding)}: ${manager.session(binding.key)?.error || 'did not arm.'}`,
          );
      }
      this.problems = [...new Set(problems)];
      this.reset();
      this.waitingForNeutral = true;
    } finally {
      this.busy = false;
      this.notify();
    }
  }

  /** Disarm every input on the robot, keyboard or not. */
  async disarmAll() {
    this.reset();
    this.waitingForNeutral = false;
    const stopped = await this.manager.stopAll();
    if (!stopped) this.problems = ['A command release failed. All inputs remain disarmed.'];
    this.notify();
  }

  /** Include or exclude one part. Excluding stops it; including an engaged robot arms it. */
  async setIncluded(part: string, included: boolean) {
    const target = this.keymap.parts.find((p) => p.id === part);
    if (!target) return;
    if (!included) {
      this.excluded.add(part);
      await Promise.all(target.bindings.map((b) => this.manager.stop(b.key)));
      this.notify();
      return;
    }
    this.excluded.delete(part);
    if (this.engaged) await this.armAll([part]);
    else this.notify();
  }
}
