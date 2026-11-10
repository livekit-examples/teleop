/**
 * Webcam hands as arm targets: the grip clutch, the hand pose, and the relative mapping.
 * A TypeScript port of portal-makermods/src/utils/hands.py without the IK, because the robot
 * solves its own IK from a Cartesian pose. Nothing here needs a camera or a model.
 *
 * Camera frame: x right, y down, z away from the lens, in the raw (unmirrored) webcam image.
 */
import {
  EYE,
  T,
  add,
  apply,
  columns,
  cross,
  diag,
  fromAxisAngle,
  fromRotvec,
  mean,
  mul,
  norm,
  scale,
  solve3,
  sub,
  toRotvec,
  turnBetween,
  unit,
  type M3,
  type V3,
} from './linalg';

export const WRIST = 0;
export const THUMB_TIP = 4;
export const INDEX_MCP = 5;
export const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const RING_MCP = 13;
const PINKY_MCP = 17;
const PALM = [WRIST, INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP];
const CLOSED_FINGERS: [number, number][] = [
  [9, 12],
  [13, 16],
  [17, 20],
];
export const BONES: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
];

/** Camera axes into interface axes: toward the lens is forward, image right is left, image up is up. */
export const CAMERA_TO_BASE: M3 = [0, 0, -1, 1, 0, 0, 0, -1, 0];
/** Camera axes into the tool's axes: z along the fingers, x across the jaws. */
export const CAMERA_TO_TOOL = diag(1, -1, -1);
/** Palm x (wrist to knuckles) is the approach and roll axis z. Palm y is jaw x. Palm normal is tool y. */
export const HAND_TO_TOOL: M3 = [0, 1, 0, 0, 0, 1, 1, 0, 0];

/** A finger counts as curled into the palm below this ratio, and as open above the other. */
export const CURLED_BELOW = 1.0;
export const OPEN_ABOVE = 1.15;

export type Hand = {
  /** The operator's own hand, as the model labels it. */
  label: 'left' | 'right';
  /** 21 landmarks, in pixels. */
  image: [number, number][];
  /** 21 landmarks, in metres, about the hand's centre, camera axes. */
  world: V3[];
};
export type HandPose = {
  /** Seconds, on any steady clock. */
  at: number;
  position: V3;
  rotation: M3;
  /** Thumb tip to index tip, in metres. */
  pinch: number;
  /** Middle, ring, pinky. */
  curl: V3;
};

export function curl(world: V3[]): V3 {
  const wrist = world[WRIST];
  const ratio = ([mcp, tip]: [number, number]) =>
    norm(sub(world[tip], wrist)) / Math.max(norm(sub(world[mcp], wrist)), 1e-6);
  return CLOSED_FINGERS.map(ratio) as V3;
}
export const pinch = (world: V3[]) => norm(sub(world[THUMB_TIP], world[INDEX_TIP]));

export function palmSize(world: V3[]): number {
  const points = PALM.map((i) => world[i]);
  const centre = mean(points);
  return Math.sqrt(points.reduce((s, p) => s + norm(sub(p, centre)) ** 2, 0) / points.length);
}

/**
 * The turn that points the lens axis along the ray through `pixel`. MediaPipe reads world
 * landmarks off a crop, so they come turned as the hand looks along that ray.
 */
export function viewRotation(
  pixel: [number, number],
  focalPx: number,
  centre: [number, number],
): M3 {
  const ray: V3 = [(pixel[0] - centre[0]) / focalPx, (pixel[1] - centre[1]) / focalPx, 1];
  const axis: V3 = [-ray[1], ray[0], 0];
  const sin = norm(axis);
  if (sin < 1e-12) return EYE;
  return fromAxisAngle(scale(axis, 1 / sin), Math.atan2(sin, ray[2]));
}

/**
 * The palm centre in the camera frame, in metres. A perspective least-squares fit places the five
 * rigid palm points where they project onto their pixels, so depth comes from the palm's size.
 * `sizeM` replaces the per-frame size estimate with a steadier one.
 */
export function palmPosition(
  image: [number, number][],
  world: V3[],
  focalPx: number,
  centre: [number, number],
  sizeM?: number,
): V3 | null {
  const raw = PALM.map((i) => world[i]);
  const rawCentre = mean(raw);
  const factor = sizeM === undefined ? 1 : sizeM / Math.max(palmSize(world), 1e-9);
  const palm = raw.map((p) => scale(sub(p, rawCentre), factor));
  const pixels = PALM.map((i) => image[i]);
  const meanPixel: [number, number] = [
    pixels.reduce((s, p) => s + p[0], 0) / pixels.length,
    pixels.reduce((s, p) => s + p[1], 0) / pixels.length,
  ];
  const view = viewRotation(meanPixel, focalPx, centre);
  const model = palm.map((p) => apply(view, p));
  // f (X + mx) = u (Z + mz) and f (Y + my) = v (Z + mz) are linear in the centre (X, Y, Z).
  const ata = new Array<number>(9).fill(0);
  const atb: V3 = [0, 0, 0];
  const accumulate = (row: V3, b: number) => {
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) ata[i * 3 + j] += row[i] * row[j];
      atb[i] += row[i] * b;
    }
  };
  pixels.forEach((pixel, i) => {
    const u = pixel[0] - centre[0];
    const v = pixel[1] - centre[1];
    accumulate([focalPx, 0, -u], u * model[i][2] - focalPx * model[i][0]);
    accumulate([0, focalPx, -v], v * model[i][2] - focalPx * model[i][1]);
  });
  const solved = solve3(ata, atb);
  return solved && solved[2] > 0.05 ? solved : null;
}

/** The palm's axes in the camera frame: x wrist to knuckles, z the palm normal, y = z cross x. */
export function palmRotation(world: V3[]): M3 {
  const x = unit(
    sub(
      mean([world[INDEX_MCP], world[MIDDLE_MCP], world[RING_MCP], world[PINKY_MCP]]),
      world[WRIST],
    ),
  );
  const z = unit(cross(x, sub(world[INDEX_MCP], world[PINKY_MCP])));
  return columns(x, cross(z, x), z);
}

/** The palm's size as the median of recent sightings. MediaPipe's metric scale wanders per frame. */
export class HandSize {
  private sizes: number[] = [];
  constructor(private keep = 150) {}
  add(world: V3[]) {
    this.sizes.push(palmSize(world));
    if (this.sizes.length > this.keep) this.sizes.shift();
  }
  get value(): number | undefined {
    if (!this.sizes.length) return undefined;
    const sorted = [...this.sizes].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
}

export function handPose(
  hand: Hand,
  at: number,
  focalPx: number,
  centre: [number, number],
  sizeM?: number,
): HandPose | null {
  const position = palmPosition(hand.image, hand.world, focalPx, centre, sizeM);
  if (!position) return null;
  const pixels = PALM.map((i) => hand.image[i]);
  const mid: [number, number] = [
    pixels.reduce((s, p) => s + p[0], 0) / pixels.length,
    pixels.reduce((s, p) => s + p[1], 0) / pixels.length,
  ];
  const view = viewRotation(mid, focalPx, centre);
  return {
    at,
    position,
    rotation: mul(view, palmRotation(hand.world)),
    pinch: pinch(hand.world),
    curl: curl(hand.world),
  };
}

/**
 * Which arm each hand drives. The model's label decides, unless both hands carry the same one.
 * Then position decides: the operator's right hand is on the raw image's left. `swap` is for a
 * webcam that mirrors.
 */
export function assignSides(hands: Hand[], swap = false): Partial<Record<'left' | 'right', Hand>> {
  const flip = { left: 'right', right: 'left' } as const;
  const list = swap ? hands.map((h) => ({ ...h, label: flip[h.label] })) : hands;
  if (list.length === 2 && list[0].label === list[1].label) {
    const [onLeft, onRight] = [...list].sort((a, b) => a.image[WRIST][0] - b.image[WRIST][0]);
    return { right: onLeft, left: onRight };
  }
  const out: Partial<Record<'left' | 'right', Hand>> = {};
  for (const hand of list) out[hand.label] ??= hand;
  return out;
}

/** Camera axes into one arm's base axes. `yawDeg` turns the base left of facing the workspace. */
export function cameraToBase(yawDeg = 0): M3 {
  const c = Math.cos((yawDeg * Math.PI) / 180);
  const s = Math.sin((yawDeg * Math.PI) / 180);
  return mul(T([c, -s, 0, s, c, 0, 0, 0, 1]), CAMERA_TO_BASE);
}

/**
 * Whether a hand holds its arm. Three fingers curled into the palm for a few frames close it.
 * Any finger coming out for a frame or two, or the hand leaving, opens it. The gap between the two
 * thresholds keeps a finger near either one from chattering.
 */
export class Clutch {
  closed = false;
  private run = 0;
  constructor(
    private closeFrames = 3,
    private openFrames = 2,
    private curledBelow = CURLED_BELOW,
    private openAbove = OPEN_ABOVE,
  ) {}
  update(curls: V3 | null): boolean {
    if (!curls) {
      this.closed = false;
      this.run = 0;
      return false;
    }
    const change = this.closed
      ? curls.some((c) => c > this.openAbove)
      : curls.every((c) => c < this.curledBelow);
    this.run = change ? this.run + 1 : 0;
    if (this.run >= (this.closed ? this.openFrames : this.closeFrames)) {
      this.closed = !this.closed;
      this.run = 0;
    }
    return this.closed;
  }
}

const alpha = (cutoffHz: number, dt: number) => {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dt);
};

/** The 1€ filter (Casiez et al., 2012): smooth when the hand is still, little lag when it moves. */
export class OneEuro {
  private x: number[] | null = null;
  private dx: number[] = [];
  private at = 0;
  constructor(
    private minCutoffHz: number,
    private beta: number,
    private dCutoffHz = 1,
  ) {}
  clear() {
    this.x = null;
  }
  /** How fast the input moves, in its units per second. */
  get speed() {
    return this.x ? norm(this.dx) : 0;
  }
  call(value: number[], at: number): number[] {
    if (!this.x) {
      this.x = [...value];
      this.dx = value.map(() => 0);
      this.at = at;
      return [...this.x];
    }
    if (at <= this.at) return [...this.x];
    const dt = at - this.at;
    const a = alpha(this.dCutoffHz, dt);
    this.dx = this.dx.map((d, i) => d + a * ((value[i] - this.x![i]) / dt - d));
    const cutoff = this.minCutoffHz + this.beta * norm(this.dx);
    const b = alpha(cutoff, dt);
    this.x = this.x.map((x, i) => x + b * (value[i] - x));
    this.at = at;
    return [...this.x];
  }
}

/** The 1€ filter on rotations: each sighting pulls the estimate along the shortest turn toward it. */
export class OneEuroTurn {
  private r: M3 | null = null;
  private w: V3 = [0, 0, 0];
  private at = 0;
  constructor(
    private minCutoffHz: number,
    private beta: number,
    private dCutoffHz = 1,
  ) {}
  clear() {
    this.r = null;
  }
  call(rotation: M3, at: number): M3 {
    if (!this.r) {
      this.r = [...rotation];
      this.w = [0, 0, 0];
      this.at = at;
    } else if (at > this.at) {
      const dt = at - this.at;
      const towards = toRotvec(mul(rotation, T(this.r)));
      const a = alpha(this.dCutoffHz, dt);
      this.w = this.w.map((w, i) => w + a * (towards[i] / dt - w)) as V3;
      const cutoff = this.minCutoffHz + this.beta * norm(this.w);
      this.r = mul(fromRotvec(scale(towards, alpha(cutoff, dt))), this.r);
      this.at = at;
    }
    return [...this.r];
  }
}

export const rad = (deg: number) => (deg * Math.PI) / 180;

/** How a hand's motion becomes a tool pose. Speeds bound the target. */
export type Mapping = {
  to_base: M3;
  /** `tool`: the gripper's point of view. `base`: fixed camera-to-interface axes. */
  frame: 'tool' | 'base';
  /** Tool metres per hand metre. */
  scale: number;
  /** The share of `scale` that a slow hand gets. */
  fine_scale: number;
  fine_below_m_s: number;
  full_above_m_s: number;
  /** `full`: the tool turns as the hand does. `off`: it keeps its orientation. */
  rotate: 'full' | 'off';
  turn_deadband_rad: number;
  max_hand_turn_rad: number;
  max_speed_m_s: number;
  max_turn_rad_s: number;
  pinch_closed_m: number;
  pinch_open_m: number;
  smoothing_hz: number;
  depth_smoothing_hz: number;
  depth_beta: number;
  turn_smoothing_hz: number;
  turn_beta: number;
  turn_d_cutoff_hz: number;
  hold_m: number;
  hold_rad: number;
  /** The pinch must come this close to the gripper, as a share of its range, to take it. */
  takeover: number;
};
export function defaultMapping(overrides: Partial<Mapping> = {}): Mapping {
  return {
    to_base: cameraToBase(),
    frame: 'tool',
    scale: 1,
    fine_scale: 0.4,
    fine_below_m_s: 0.04,
    full_above_m_s: 0.2,
    rotate: 'full',
    turn_deadband_rad: rad(5),
    max_hand_turn_rad: rad(90),
    max_speed_m_s: 0.5,
    max_turn_rad_s: Math.PI,
    pinch_closed_m: 0.03,
    pinch_open_m: 0.09,
    smoothing_hz: 1,
    depth_smoothing_hz: 0.4,
    depth_beta: 2,
    turn_smoothing_hz: 0.3,
    turn_beta: 0.5,
    turn_d_cutoff_hz: 0.5,
    hold_m: 0.001,
    hold_rad: rad(1.5),
    takeover: 0.1,
    ...overrides,
  };
}
/** How much of the hand's motion the tool makes at this hand speed, before `scale`. */
export function gain(m: Mapping, speed: number) {
  const t = Math.min(
    1,
    Math.max(0, (speed - m.fine_below_m_s) / Math.max(m.full_above_m_s - m.fine_below_m_s, 1e-9)),
  );
  return m.fine_scale + (1 - m.fine_scale) * t * t * (3 - 2 * t);
}
/** The pinch as a gripper opening: 0 closed to 1 open. */
export function gripFraction(m: Mapping, pinchM: number) {
  const span = Math.max(m.pinch_open_m - m.pinch_closed_m, 1e-6);
  return Math.min(1, Math.max(0, (pinchM - m.pinch_closed_m) / span));
}

export type Tcp = { position: V3; rotation: M3 };

/**
 * One arm following one hand's motion since the clutch closed, never the hand's absolute place.
 * Every sighting is filtered (`observe`), gripping or not, so a grip anchors to a settled
 * estimate. A still hand holds the tool still: the target moves only once the hand has taken it
 * `hold_m` (or turned it `hold_rad`). Each tick `goal` moves toward the target no faster than the
 * speed limits. The gripper takes over softly: it holds where it was until the pinch comes to it.
 */
export class ArmFollower {
  engaged = false;
  /** The gripper opening, 0 closed to 1 open. */
  grip = 0;
  private handPos: V3 | null = null;
  private handRot: M3 | null = null;
  private pinchM = 0;
  private anchorHandRot: M3 = EYE;
  private anchor: Tcp = { position: [0, 0, 0], rotation: EYE };
  private held: V3 = [0, 0, 0];
  private kept: M3 = EYE;
  private current: Tcp = { position: [0, 0, 0], rotation: EYE };
  private gripTaken = false;
  private gripSide = 0;
  private across: OneEuro;
  private depth: OneEuro;
  private turning: OneEuroTurn;
  private pinching: OneEuro;

  constructor(readonly mapping: Mapping) {
    this.across = new OneEuro(mapping.smoothing_hz, 4);
    this.depth = new OneEuro(mapping.depth_smoothing_hz, mapping.depth_beta);
    this.turning = new OneEuroTurn(
      mapping.turn_smoothing_hz,
      mapping.turn_beta,
      mapping.turn_d_cutoff_hz,
    );
    this.pinching = new OneEuro(2 * mapping.smoothing_hz, 2);
  }

  /** Take one sighting. While engaged and `moving`, it moves the target and the turn. */
  observe(hand: HandPose, moving = true) {
    const last = this.handPos;
    const xy = this.across.call([hand.position[0], hand.position[1]], hand.at);
    const z = this.depth.call([hand.position[2]], hand.at);
    this.handPos = [xy[0], xy[1], z[0]];
    this.handRot = this.turning.call(hand.rotation, hand.at);
    this.pinchM = this.pinching.call([hand.pinch], hand.at)[0];
    if (!(this.engaged && moving)) return;
    const m = this.mapping;
    if (last) {
      const g = m.scale * gain(m, Math.hypot(this.across.speed, this.depth.speed));
      const axes = m.frame === 'tool' ? mul(this.current.rotation, CAMERA_TO_TOOL) : m.to_base;
      const step = scale(apply(axes, sub(this.handPos, last)), g);
      this.target = add(this.target, step);
      const off = sub(this.target, this.held);
      const gap = norm(off);
      if (gap > m.hold_m) this.held = add(this.held, scale(off, 1 - m.hold_m / gap));
    }
    const relative =
      m.frame === 'tool'
        ? mul(T(this.anchorHandRot), this.handRot)
        : mul(this.handRot, T(this.anchorHandRot));
    let turn = toRotvec(relative);
    const angle0 = norm(turn);
    if (angle0 > m.max_hand_turn_rad) {
      const beyond = scale(turn, 1 - m.max_hand_turn_rad / angle0);
      const slip = fromRotvec(beyond);
      this.anchorHandRot =
        m.frame === 'tool' ? mul(this.anchorHandRot, slip) : mul(slip, this.anchorHandRot);
      turn = sub(turn, beyond);
    }
    const angle = norm(turn);
    const wanted = fromRotvec(
      scale(turn, Math.max(0, angle - m.turn_deadband_rad) / Math.max(angle, 1e-9)),
    );
    const off = toRotvec(mul(wanted, T(this.kept)));
    const gap = norm(off);
    if (gap > m.hold_rad) this.kept = mul(fromRotvec(scale(off, 1 - m.hold_rad / gap)), this.kept);
  }
  private target: V3 = [0, 0, 0];

  /** The hand is gone, or a sighting was a glitch: the next one starts the filters afresh. */
  forget() {
    this.across.clear();
    this.depth.clear();
    this.turning.clear();
    this.pinching.clear();
    this.handPos = null;
    this.handRot = null;
  }

  /** Anchor the filtered hand to the tool pose `tcp` and the gripper opening `grip`. */
  engage(tcp: Tcp, grip: number) {
    if (!this.handPos || !this.handRot) throw new Error('observe the hand before engaging');
    this.engaged = true;
    this.anchorHandRot = [...this.handRot];
    this.kept = EYE;
    this.anchor = { position: [...tcp.position], rotation: [...tcp.rotation] };
    this.current = { position: [...tcp.position], rotation: [...tcp.rotation] };
    this.target = [...tcp.position];
    this.held = [...tcp.position];
    this.grip = grip;
    const wanted = gripFraction(this.mapping, this.pinchM);
    this.gripSide = Math.sign(wanted - grip) || 1;
    this.gripTaken = Math.abs(wanted - grip) <= this.mapping.takeover;
  }
  release() {
    this.engaged = false;
  }

  /** This tick's target tool pose. `dt` is the seconds since the last tick. */
  goal(dt: number): Tcp {
    const m = this.mapping;
    const axes = m.frame === 'tool' ? mul(this.anchor.rotation, HAND_TO_TOOL) : m.to_base;
    const turn = m.rotate === 'off' ? EYE : mul(mul(axes, this.kept), T(axes));
    const rotation = mul(turn, this.anchor.rotation);

    let step = sub(this.held, this.current.position);
    const n = norm(step);
    const limit = m.max_speed_m_s * dt;
    if (n > limit) step = scale(step, limit / n);
    let swing = toRotvec(mul(rotation, T(this.current.rotation)));
    const angle = norm(swing);
    const turnLimit = m.max_turn_rad_s * dt;
    if (angle > turnLimit) swing = scale(swing, turnLimit / angle);
    this.current = {
      position: add(this.current.position, step),
      rotation: mul(fromRotvec(swing), this.current.rotation),
    };

    const wanted = gripFraction(m, this.pinchM);
    if (
      !this.gripTaken &&
      (Math.abs(wanted - this.grip) <= m.takeover ||
        (Math.sign(wanted - this.grip) || 1) !== this.gripSide)
    )
      this.gripTaken = true;
    if (this.gripTaken) this.grip = wanted;
    return { position: [...this.current.position], rotation: [...this.current.rotation] };
  }
  /** The gripper holds until the pinch comes to it. */
  get gripWaiting() {
    return this.engaged && !this.gripTaken;
  }
  /** The target's offset from the anchor, in the interface frame, in metres. */
  moved(): V3 {
    return this.engaged ? sub(this.current.position, this.anchor.position) : [0, 0, 0];
  }
  /** How far the target has turned from the anchor, in rad. */
  turned() {
    return this.engaged ? turnBetween(this.anchor.rotation, this.current.rotation) : 0;
  }
}
