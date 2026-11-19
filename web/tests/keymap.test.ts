import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fixtureConfig } from '../src/lib/teleop/fixture-transport';
import { keyGlyph, planKeymap, type Keymap } from '../src/lib/teleop/keymap';
import { parseDiscovery } from '../src/lib/teleop/validation';

const example = (name: string) =>
  parseDiscovery(readFileSync(`../generalization/examples/${name}.json`, 'utf8'));
const part = (map: Keymap, id: string) => map.parts.find((p) => p.id === id)!;
const binding = (map: Keymap, id: string, kind: string) =>
  part(map, id).bindings.find((b) => b.kind === kind)!;

describe('robot keymap', () => {
  it('lays out base, lift and two arms for 09', () => {
    const map = planKeymap(example('09-two-arms-mobile-lift'));
    expect(map.focus).toEqual([]);
    expect(part(map, 'base').role).toBe('drive');
    expect(binding(map, 'base', 'drive').keys).toEqual({
      forward: 'ArrowUp',
      back: 'ArrowDown',
      left: 'ArrowLeft',
      right: 'ArrowRight',
    });
    expect(part(map, 'lift').role).toBe('linear');
    expect(binding(map, 'lift', 'pairs')).toMatchObject({
      pairs: [{ joint: 'lift_joint', minus: 'Digit1', plus: 'Digit2' }],
      jog: 'velocity',
    });
    expect(part(map, 'left_arm')).toMatchObject({ role: 'manipulator', side: 'left' });
    expect(binding(map, 'left_arm', 'cartesian')).toMatchObject({
      operation: 'cartesian_pose',
      key: 'left_arm',
      keys: { forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', up: 'KeyR', down: 'KeyF' },
    });
    expect(binding(map, 'left_arm', 'gripper').keys).toEqual({ open: 'KeyE', close: 'KeyQ' });
    expect(binding(map, 'right_arm', 'cartesian').keys).toEqual({
      forward: 'KeyI',
      back: 'KeyK',
      left: 'KeyJ',
      right: 'KeyL',
      up: 'KeyP',
      down: 'Semicolon',
    });
    expect(binding(map, 'right_arm', 'gripper')).toMatchObject({
      key: JSON.stringify(['right_arm', 'gripper']),
      keys: { open: 'KeyO', close: 'KeyU' },
    });
  });

  it('gives a single arm the left cluster', () => {
    const map = planKeymap(example('05-arm'));
    expect(binding(map, 'arm', 'cartesian').keys.forward).toBe('KeyW');
    expect(binding(map, 'arm', 'gripper').keys.open).toBe('KeyE');
  });

  it('puts head and torso joints on the number row, one pair per joint', () => {
    const rover = planKeymap(example('03-rover-pan-tilt'));
    expect(binding(rover, 'base', 'drive').keys.forward).toBe('ArrowUp');
    expect(binding(rover, 'head', 'pairs').pairs?.map((p) => [p.minus, p.plus])).toEqual([
      ['Digit1', 'Digit2'],
      ['Digit3', 'Digit4'],
    ]);
    const config = example('12-humanoid');
    config.control_interfaces.torso = {
      label: 'Torso',
      joint_names: ['torso_lift'],
      operations: config.control_interfaces.head.operations,
    };
    const humanoid = planKeymap(config);
    expect(binding(humanoid, 'head', 'pairs').pairs).toHaveLength(2);
    expect(binding(humanoid, 'torso', 'pairs').pairs).toEqual([
      { joint: 'torso_lift', minus: 'Digit5', plus: 'Digit6' },
    ]);
    expect(binding(humanoid, 'left_arm', 'cartesian').keys.forward).toBe('KeyW');
    expect(binding(humanoid, 'right_arm', 'cartesian').keys.forward).toBe('KeyI');
  });

  it('leaves a part unmapped when the number row runs out', () => {
    const config = example('03-rover-pan-tilt');
    for (const name of ['a', 'b', 'c'])
      config.control_interfaces[`head_${name}`] = structuredClone(config.control_interfaces.head);
    const map = planKeymap(config);
    expect(binding(map, 'head_b', 'pairs').pairs?.at(-1)?.plus).toBe('Equal');
    expect(part(map, 'head_c').bindings).toHaveLength(0);
    expect(part(map, 'head_c').unmapped).toContain('No number keys');
    expect(binding(map, 'head_a', 'pairs').pairs?.at(-1)?.plus).toBe('Digit8');
  });

  it('adds strafe keys for a holonomic base', () => {
    expect(binding(planKeymap(example('08-rover-holonomic')), 'base', 'drive').keys).toMatchObject({
      strafe_left: 'Comma',
      strafe_right: 'Period',
    });
  });

  it('steps joint positions for trajectory-only arms', () => {
    const map = planKeymap(example('10-moveit-dual-panda'));
    expect(binding(map, 'left_arm', 'jog')).toMatchObject({
      jog: 'position',
      keys: { plus: 'KeyW', minus: 'KeyS', prev: 'KeyA', next: 'KeyD' },
    });
    expect(binding(map, 'right_arm', 'jog').keys.plus).toBe('KeyI');
  });

  it('honors a driving mode chosen under Advanced, but keeps arms Cartesian', () => {
    const map = planKeymap(fixtureConfig, { base: 'ackermann', left_arm: 'velocity' });
    expect(binding(map, 'base', 'drive')).toMatchObject({
      operation: 'ackermann',
      profile: 'base.ackermann_drive.v1',
    });
    expect(binding(map, 'left_arm', 'cartesian').operation).toBe('pose');
  });

  it('falls back to focus mode with more than two arms', () => {
    const config = example('07-two-arms-mobile');
    const arm = config.control_interfaces.left_arm;
    config.control_interfaces.third_arm = { ...arm, label: 'Third arm' };
    const map = planKeymap(config);
    expect(map.focus).toEqual(['left_arm', 'right_arm', 'third_arm']);
    for (const id of map.focus) {
      expect(binding(map, id, 'cartesian')).toMatchObject({ focus: true, keys: { forward: 'KeyW' } });
      expect(binding(map, id, 'gripper').keys.open).toBe('KeyE');
    }
    expect(binding(map, 'base', 'drive').focus).toBeUndefined();
  });

  it('uses role and side hints from discovery', () => {
    const config = example('06-two-arms');
    config.control_interfaces.left_arm.side = 'right';
    config.control_interfaces.right_arm.side = 'left';
    const map = planKeymap(config);
    expect(binding(map, 'left_arm', 'cartesian').keys.forward).toBe('KeyI');
    expect(binding(map, 'right_arm', 'cartesian').keys.forward).toBe('KeyW');
  });

  it('rejects an unknown role', () => {
    const raw = JSON.parse(readFileSync('../generalization/examples/01-rover-differential.json', 'utf8'));
    raw.control_interfaces.base.role = 'wheel';
    expect(() => parseDiscovery(JSON.stringify(raw))).toThrow(/role must be/);
    raw.control_interfaces.base.role = 'drive';
    raw.control_interfaces.base.side = 'left';
    expect(parseDiscovery(JSON.stringify(raw)).control_interfaces.base).toMatchObject({ role: 'drive', side: 'left' });
  });

  it('prints key glyphs', () => {
    expect(['KeyW', 'ArrowUp', 'Semicolon', 'Digit3', 'Backquote'].map(keyGlyph)).toEqual([
      'W',
      '↑',
      ';',
      '3',
      '`',
    ]);
  });
});
