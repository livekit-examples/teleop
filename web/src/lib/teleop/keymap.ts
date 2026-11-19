import { controlKey } from './controls';

import type { ControlInterface, Operation, RobotConfig } from './types';

/**
 * Robot keymap planner. It reads the control interfaces of one robot and lays out a single
 * keyboard map for the whole robot, so that an operator arms once and drives every part at once.
 *
 * Each interface gets a role (drive, manipulator, linear, aim or joints) and, for arms, a side.
 * Every zone works at the same time, so both arms, the base and the head move together:
 *
 *   arrows                 → drive
 *   W S · A D · R F · E Q  → left arm   (reach · side · up/down · open/close)
 *   I K · J L · P ; · O U  → right arm  (reach · side · up/down · open/close)
 *   1 2 · 3 4 · 5 6 · …    → head, torso, lift: one key pair per joint, in config order
 *
 * A robot with more than two arms falls back to focus mode: ` (backquote) cycles the focused arm,
 * and the left cluster drives whichever arm has focus.
 */

export type PartRole = 'drive' | 'manipulator' | 'linear' | 'aim' | 'joints';
export type Side = 'left' | 'right';
export const PART_ROLES: readonly PartRole[] = ['drive', 'manipulator', 'linear', 'aim', 'joints'];

export type BindingKind = 'drive' | 'cartesian' | 'jog' | 'pairs' | 'gripper';

/** Slot names per binding kind. Values are KeyboardEvent.code strings (physical keys). */
export type Slots = Partial<
  Record<
    | 'forward'
    | 'back'
    | 'left'
    | 'right'
    | 'up'
    | 'down'
    | 'strafe_left'
    | 'strafe_right'
    | 'plus'
    | 'minus'
    | 'prev'
    | 'next'
    | 'open'
    | 'close',
    string
  >
>;

export type Binding = {
  /** Interface ID. */
  part: string;
  kind: BindingKind;
  channel: string;
  /** ControlManager session key. */
  key: string;
  operation: string;
  profile: string;
  keys: Slots;
  /** Joints for jog and pairs. */
  joints?: string[];
  /** Number-row keys, one pair per joint: minus, then plus. */
  pairs?: { joint: string; minus: string; plus: string }[];
  /** Joint jog sends velocities; joint trajectories step a position target. */
  jog?: 'velocity' | 'position';
  /** Shares the focus cluster with other parts; active only while focused. */
  focus?: boolean;
};

export type Part = {
  id: string;
  label: string;
  role: PartRole;
  side?: Side;
  bindings: Binding[];
  /** Why the keyboard cannot drive this part, when it cannot. */
  unmapped?: string;
};

export type Keymap = {
  parts: Part[];
  /** Parts that share the focus cluster, in number-key order. */
  focus: string[];
};

type Cluster = Required<
  Pick<Slots, 'forward' | 'back' | 'left' | 'right' | 'up' | 'down' | 'open' | 'close'>
>;
export const LEFT_CLUSTER: Cluster = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  up: 'KeyR',
  down: 'KeyF',
  open: 'KeyE',
  close: 'KeyQ',
};
export const RIGHT_CLUSTER: Cluster = {
  forward: 'KeyI',
  back: 'KeyK',
  left: 'KeyJ',
  right: 'KeyL',
  up: 'KeyP',
  down: 'Semicolon',
  open: 'KeyO',
  close: 'KeyU',
};
const ARROWS = { forward: 'ArrowUp', back: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
/** Number-row pairs for head, torso and lift joints: minus, plus. */
export const NUMBER_PAIRS: [string, string][] = [
  ['Digit1', 'Digit2'],
  ['Digit3', 'Digit4'],
  ['Digit5', 'Digit6'],
  ['Digit7', 'Digit8'],
  ['Digit9', 'Digit0'],
  ['Minus', 'Equal'],
];
/** Cycles the focused arm in focus mode (Shift reverses). */
export const FOCUS_KEY = 'Backquote';
export const DISARM_KEY = 'Escape';
/** Shift + this key arms every included part (the counterpart of Esc). */
export const ARM_KEY = 'KeyA';

const GLYPHS: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  BracketLeft: '[',
  BracketRight: ']',
  Comma: ',',
  Period: '.',
  Semicolon: ';',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  Escape: 'Esc',
};
/** Short printable label for a KeyboardEvent.code. */
export function keyGlyph(code: string): string {
  if (GLYPHS[code]) return GLYPHS[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}

const AIM_NAME = /head|camera|cam\b|pan|tilt|neck|gimbal/i;
const sideOf = (id: string, equipment: ControlInterface): Side | undefined => {
  if (equipment.side) return equipment.side;
  for (const text of [id, equipment.label, equipment.frame_id ?? '']) {
    if (/(^|[^a-z])(left|l)([^a-z]|$)/i.test(text) || /^left/i.test(text)) return 'left';
    if (/(^|[^a-z])(right|r)([^a-z]|$)/i.test(text) || /^right/i.test(text)) return 'right';
  }
};

type Ops = [string, Operation][];
const channelOf = (op: Operation) => op.control_channel ?? 'primary';
const find = (ops: Ops, profile: (p: string) => boolean, channel = 'primary') =>
  ops.find(([, op]) => channelOf(op) === channel && profile(op.profile));
const jointsOf = (equipment: ControlInterface, op: Operation) =>
  op.joint_names ?? equipment.joint_names ?? [];

/** Classify one interface. An explicit `role` in discovery wins over inference. */
export function partRole(id: string, equipment: ControlInterface): PartRole {
  if (equipment.role) return equipment.role;
  const ops = Object.values(equipment.operations);
  if (ops.some((op) => op.profile.startsWith('base.'))) return 'drive';
  if (
    ops.some((op) => op.profile === 'arm.cartesian_pose.v1' || op.profile === 'gripper.position.v1')
  )
    return 'manipulator';
  const joints = equipment.joint_names ?? [];
  if (joints.length === 1) return 'linear';
  if (joints.length === 2 && AIM_NAME.test(`${id} ${equipment.label}`)) return 'aim';
  return 'joints';
}

/**
 * Lay out the keyboard for a robot. `current` maps session keys to the operation the operator
 * picked under Advanced. Only a base honors it, so that a driving choice there (for example
 * holonomic or Ackermann) carries over; arms always prefer Cartesian motion on the keyboard.
 */
export function planKeymap(
  config: Pick<RobotConfig, 'control_interfaces'> | undefined,
  current: Record<string, string | undefined> = {},
): Keymap {
  const parts: Part[] = [];
  for (const [id, equipment] of Object.entries(config?.control_interfaces ?? {})) {
    const ops = Object.entries(equipment.operations);
    const pick = (match: (p: string) => boolean, channel = 'primary', honor = false) => {
      const chosen = honor ? current[controlKey(id, channel)] : undefined;
      const op = chosen && Object.hasOwn(equipment.operations, chosen)
        ? ([chosen, equipment.operations[chosen]] as [string, Operation])
        : undefined;
      return op && channelOf(op[1]) === channel && match(op[1].profile)
        ? op
        : find(ops, match, channel);
    };
    const part: Part = {
      id,
      label: equipment.label,
      role: partRole(id, equipment),
      side: sideOf(id, equipment),
      bindings: [],
    };
    const bind = (
      kind: BindingKind,
      [operation, op]: [string, Operation],
      extra: Partial<Binding> = {},
    ) =>
      part.bindings.push({
        part: id,
        kind,
        channel: channelOf(op),
        key: controlKey(id, channelOf(op)),
        operation,
        profile: op.profile,
        keys: {},
        ...extra,
      });
    // The primary channel gets one motion binding, chosen by the part's role.
    const base = pick((p) => p.startsWith('base.'), 'primary', true);
    const cartesian = pick((p) => p === 'arm.cartesian_pose.v1');
    const velocity = pick((p) => p === 'joints.velocity_jog.v1');
    const trajectory = pick((p) => p === 'joints.trajectory.v1');
    if (part.role === 'drive' && base) bind('drive', base);
    else if ((part.role === 'aim' || part.role === 'linear') && (velocity ?? trajectory)) {
      const op = (velocity ?? trajectory)!;
      bind('pairs', op, {
        joints: jointsOf(equipment, op[1]),
        jog: velocity ? 'velocity' : 'position',
      });
    } else if (cartesian && cartesian[1].feedback_tracks.length) bind('cartesian', cartesian);
    else if (velocity ?? trajectory) {
      const op = (velocity ?? trajectory)!;
      bind('jog', op, { joints: jointsOf(equipment, op[1]), jog: velocity ? 'velocity' : 'position' });
    }
    // Every other channel that carries a gripper gets open and close.
    for (const channel of new Set(ops.map(([, op]) => channelOf(op))))
      if (channel !== 'primary') {
        const gripper = pick((p) => p === 'gripper.position.v1', channel);
        if (gripper) bind('gripper', gripper);
      }
    if (!part.bindings.length)
      part.unmapped = 'No keyboard mapping for these operations. Use Advanced.';
    parts.push(part);
  }
  return assignKeys(parts);
}

function assignKeys(parts: Part[]): Keymap {
  const motion = (part: Part) => part.bindings.find((b) => b.kind !== 'gripper');
  // Drive: the arrows. A second base has no keys.
  let arrowsTaken = false;
  for (const part of parts.filter((p) => p.role === 'drive')) {
    const binding = motion(part);
    if (!binding) continue;
    if (arrowsTaken) {
      part.unmapped = 'Another base already uses the arrow keys.';
      part.bindings = [];
      continue;
    }
    arrowsTaken = true;
    binding.keys = {
      ...ARROWS,
      ...(binding.profile === 'base.holonomic_twist.v1'
        ? { strafe_left: 'Comma', strafe_right: 'Period' }
        : {}),
    };
  }
  // Head, torso, lift: one number-row pair per joint, in config order.
  let next = 0;
  for (const part of parts) {
    const binding = part.bindings.find((b) => b.kind === 'pairs');
    if (!binding) continue;
    const joints = binding.joints ?? [];
    if (next + joints.length > NUMBER_PAIRS.length) {
      part.unmapped = 'No number keys left. Use Advanced.';
      part.bindings = [];
      continue;
    }
    binding.pairs = joints.map((joint) => {
      const [minus, plus] = NUMBER_PAIRS[next++];
      return { joint, minus, plus };
    });
  }
  // Arms: manipulators and multi-joint parts.
  const hands = parts.filter(
    (p) => (p.role === 'manipulator' || p.role === 'joints') && p.bindings.length,
  );
  const clusterKeys = (part: Part, cluster: Cluster, focus = false) => {
    for (const binding of part.bindings) {
      binding.focus = focus || undefined;
      if (binding.kind === 'gripper') binding.keys = { open: cluster.open, close: cluster.close };
      else if (binding.kind === 'cartesian')
        binding.keys = {
          forward: cluster.forward,
          back: cluster.back,
          left: cluster.left,
          right: cluster.right,
          up: cluster.up,
          down: cluster.down,
        };
      else
        binding.keys = {
          plus: cluster.forward,
          minus: cluster.back,
          ...((binding.joints?.length ?? 0) > 1 ? { prev: cluster.left, next: cluster.right } : {}),
        };
    }
  };
  let focus: string[] = [];
  if (hands.length <= 2) {
    // Sided parts claim their own side; the rest fill what is left, left cluster first.
    const slots: (Part | undefined)[] = [undefined, undefined];
    for (const part of hands) {
      const want = part.side === 'right' ? 1 : part.side === 'left' ? 0 : -1;
      if (want >= 0 && !slots[want]) slots[want] = part;
    }
    for (const part of hands) if (!slots.includes(part)) slots[slots[0] ? 1 : 0] = part;
    if (slots[0]) clusterKeys(slots[0], LEFT_CLUSTER);
    if (slots[1]) clusterKeys(slots[1], RIGHT_CLUSTER);
  } else {
    focus = hands.map((p) => p.id);
    for (const part of hands) clusterKeys(part, LEFT_CLUSTER, true);
  }
  return { parts, focus };
}
