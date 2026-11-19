import { describe, expect, it, vi } from 'vitest';
import { ControlManager, fixtureAdapters } from '../src/lib/teleop/controls';
import { FixtureTransport, fixtureConfig } from '../src/lib/teleop/fixture-transport';
import { CARTESIAN_LEASH, KeyboardTeleop } from '../src/lib/teleop/keyboard-teleop';
import { StreamHub } from '../src/lib/teleop/streams';
import type { Clock, RobotConfig } from '../src/lib/teleop/types';
import { isExcluded } from '../src/lib/teleop/validation';

const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
class FakeClock implements Clock {
  time = 1000;
  now() {
    return this.time;
  }
  async delay(ms: number) {
    this.time += ms;
  }
}

function setup(edit?: (config: RobotConfig) => void) {
  const config = structuredClone(fixtureConfig);
  edit?.(config);
  const clock = new FakeClock();
  const transport = new FixtureTransport();
  const hub = new StreamHub(transport, clock);
  hub.configure(
    transport.publications(),
    true,
    1,
    (s) => isExcluded(config, s.kind, s.track_name),
    'fixture-rover',
  );
  const manager = new ControlManager(transport, hub, fixtureAdapters(), clock);
  manager.configure(config, 'fixture-rover', true, 1);
  manager.observeOwner(transport.identity);
  const feedback = () => {
    transport.push('/joint_states', {
      name: ['left_1', 'left_2', 'right_1', 'right_2', 'left_gripper_joint', 'right_gripper_joint'],
      position: [0, 0, 0, 0, 0.02, 0.02],
    });
    for (const hand of ['left', 'right'])
      transport.push(`/${hand}/pose`, {
        header: { frame_id: `${hand}_base` },
        pose: { position: { x: 0.3, y: 0, z: 0.4 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
      });
  };
  const keyboard = new KeyboardTeleop(
    manager,
    () => {},
    () => clock.time,
    async (ms) => {
      clock.time += ms;
      feedback();
      await flush();
    },
  );
  keyboard.refresh();
  const tick = async (ms = 50) => {
    clock.time += ms;
    feedback();
    await flush();
    keyboard.tick();
  };
  const last = (track: string) =>
    transport.commands.filter((c) => c.track === track).at(-1)?.value as Record<string, any>;
  return { clock, transport, manager, keyboard, tick, last, feedback };
}

describe('robot keyboard', () => {
  it('arms the whole robot in one step and acquires control', async () => {
    const { keyboard, manager, transport } = setup();
    await keyboard.armAll();
    expect(keyboard.problems).toEqual([]);
    expect(manager.ownsControl).toBe(true);
    expect(transport.calls.some((c) => c.method === 'portal.set_active_operator')).toBe(true);
    for (const key of [
      'base',
      'left_arm',
      'right_arm',
      JSON.stringify(['left_arm', 'gripper']),
      JSON.stringify(['right_arm', 'gripper']),
    ])
      expect(manager.session(key)).toMatchObject({ armed: true, presentation: 'keyboard' });
    expect(manager.session('left_arm')?.operation).toBe('pose');
    expect(keyboard.engaged).toBe(true);
  });

  it('drives the base and both arms at the same time', async () => {
    const { keyboard, tick, last } = setup();
    await keyboard.armAll();
    await tick();
    for (const code of ['ArrowUp', 'KeyW', 'KeyL']) expect(keyboard.keydown({ code })).toBe(true);
    await tick();
    expect(last('/cmd_vel').linear.x).toBeGreaterThan(0);
    expect(last('/left/pose_target').pose.position.x).toBeGreaterThan(0.3);
    expect(last('/right/pose_target').pose.position.y).toBeLessThan(0);
  });

  it('opens and closes each gripper with its own keys', async () => {
    const { keyboard, last } = setup();
    await keyboard.armAll();
    keyboard.keydown({ code: 'KeyE' });
    expect(last('/left/gripper_trajectory').points[0].positions).toEqual([0.044]);
    keyboard.keydown({ code: 'KeyU' });
    expect(last('/right/gripper_trajectory').points[0].positions).toEqual([0]);
  });

  it('keeps a held arm target on a leash near the measured pose', async () => {
    const { keyboard, tick, last } = setup();
    await keyboard.armAll();
    keyboard.setSpeed(1);
    keyboard.keydown({ code: 'KeyR' });
    for (let i = 0; i < 100; i++) await tick();
    expect(last('/left/pose_target').pose.position.z).toBeCloseTo(0.4 + CARTESIAN_LEASH, 6);
  });

  it('stops sending the base when keys are released, and sends zero', async () => {
    const { keyboard, tick, last } = setup();
    await keyboard.armAll();
    keyboard.keydown({ code: 'ArrowUp' });
    await tick();
    keyboard.keyup({ code: 'ArrowUp' });
    await tick();
    expect(last('/cmd_vel').linear.x).toBe(0);
  });

  it('ignores keys that are not mapped or not armed', async () => {
    const { keyboard } = setup();
    expect(keyboard.keydown({ code: 'KeyW' })).toBe(false);
    await keyboard.armAll();
    expect(keyboard.keydown({ code: 'KeyZ' })).toBe(false);
  });

  it('disarms everything on Escape', async () => {
    const { keyboard, manager } = setup();
    await keyboard.armAll();
    expect(keyboard.keydown({ code: 'Escape' })).toBe(true);
    await flush();
    expect([...manager.sessions.values()].some((s) => s.armed)).toBe(false);
    expect(keyboard.engaged).toBe(false);
  });

  it('leaves an excluded part disarmed and arms it when included again', async () => {
    const { keyboard, manager } = setup();
    await keyboard.setIncluded('right_arm', false);
    await keyboard.armAll();
    expect(manager.session('right_arm')?.armed).toBeFalsy();
    expect(manager.session(JSON.stringify(['right_arm', 'gripper']))?.armed).toBeFalsy();
    await keyboard.setIncluded('right_arm', true);
    expect(manager.session('right_arm')?.armed).toBe(true);
    await keyboard.setIncluded('left_arm', false);
    expect(manager.session('left_arm')?.armed).toBe(false);
    expect(manager.session('base')?.armed).toBe(true);
  });

  it('reports a part that cannot arm and still arms the rest', async () => {
    const { keyboard, manager, transport } = setup();
    const publish = transport.publish.bind(transport);
    transport.publish = async (op) => {
      if (op.command.track_name === '/right/pose_target') throw new Error('track refused');
      return publish(op);
    };
    await keyboard.armAll();
    expect(keyboard.problems.join(' ')).toContain('Right arm');
    expect(manager.session('left_arm')?.armed).toBe(true);
  });

  it('jogs a lift on 1 and 2, and sends zero velocity while idle', async () => {
    const { keyboard, tick, last } = setup((config) => {
      config.control_interfaces.lift = {
        label: 'Lift',
        joint_names: ['lift_joint'],
        operations: {
          jog: {
            profile: 'joints.velocity_jog.v1',
            command: { track_name: '/lift/jog', msg_type: 'control_msgs/msg/JointJog', format: 'json' },
            feedback_tracks: [],
          },
        },
      };
    });
    await keyboard.armAll();
    expect(keyboard.problems).toEqual([]);
    keyboard.keydown({ code: 'Digit2' });
    await tick();
    expect(last('/lift/jog').velocities).toEqual([0.5]);
    keyboard.keyup({ code: 'Digit2' });
    keyboard.keydown({ code: 'Digit1' });
    await tick();
    expect(last('/lift/jog').velocities).toEqual([-0.5]);
    keyboard.keyup({ code: 'Digit1' });
    await tick();
    expect(last('/lift/jog').velocities).toEqual([0]);
  });

  it('drives only the focused arm in focus mode, and number keys move focus', async () => {
    const { keyboard, tick, last } = setup((config) => {
      const arm = structuredClone(config.control_interfaces.right_arm);
      for (const op of Object.values(arm.operations))
        op.command.track_name = op.command.track_name.replace('/right/', '/third/');
      arm.label = 'Third arm';
      config.control_interfaces.third_arm = arm;
    });
    await keyboard.armAll();
    expect(keyboard.keymap.focus).toEqual(['left_arm', 'right_arm', 'third_arm']);
    keyboard.keydown({ code: 'KeyW' });
    await tick();
    expect(last('/left/pose_target')).toBeDefined();
    expect(last('/right/pose_target')).toBeUndefined();
    keyboard.keyup({ code: 'KeyW' });
    expect(keyboard.keydown({ code: 'Backquote' })).toBe(true);
    keyboard.keydown({ code: 'KeyW' });
    await tick();
    expect(last('/right/pose_target').pose.position.x).toBeGreaterThan(0.3);
  });

  it('drives base, both arms and the head in the same tick', async () => {
    const { keyboard, tick, last } = setup((config) => {
      config.control_interfaces.head = {
        label: 'Camera head',
        joint_names: ['pan', 'tilt'],
        operations: {
          jog: {
            profile: 'joints.velocity_jog.v1',
            command: { track_name: '/head/jog', msg_type: 'control_msgs/msg/JointJog', format: 'json' },
            feedback_tracks: [],
          },
        },
      };
    });
    await keyboard.armAll();
    expect(keyboard.problems).toEqual([]);
    for (const code of ['ArrowLeft', 'KeyW', 'KeyP', 'Digit2', 'Digit3'])
      expect(keyboard.keydown({ code })).toBe(true);
    await tick();
    expect(last('/cmd_vel').angular.z).toBeGreaterThan(0);
    expect(last('/left/pose_target').pose.position.x).toBeGreaterThan(0.3);
    expect(last('/right/pose_target').pose.position.z).toBeGreaterThan(0.4);
    expect(last('/head/jog').velocities).toEqual([0.5, -0.5]);
  });

  it('arms everything on Shift + A, and the chord never moves an arm', async () => {
    const { keyboard, manager, tick, last } = setup();
    expect(keyboard.keydown({ code: 'KeyA', shiftKey: true })).toBe(true);
    await flush();
    await vi.waitFor(() => expect(keyboard.fullyArmed).toBe(true));
    expect(manager.ownsControl).toBe(true);
    // Already armed: the chord is swallowed, not turned into a sideways step.
    expect(keyboard.keydown({ code: 'KeyA', shiftKey: true })).toBe(true);
    await tick();
    expect(last('/left/pose_target')).toBeUndefined();
    // A plain A still moves the left arm.
    keyboard.keyup({ code: 'KeyA' });
    keyboard.keydown({ code: 'KeyA' });
    await tick();
    expect(last('/left/pose_target').pose.position.y).toBeGreaterThan(0);
  });

  it('re-arms a part that dropped out when Shift + A is pressed while engaged', async () => {
    const { keyboard, manager } = setup();
    await keyboard.armAll();
    await manager.stop('right_arm');
    expect(keyboard.fullyArmed).toBe(false);
    keyboard.keydown({ code: 'KeyA', shiftKey: true });
    await vi.waitFor(() => expect(manager.session('right_arm')?.armed).toBe(true));
  });
});
