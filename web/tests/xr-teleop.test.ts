import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceRuntime } from '../src/lib/teleop/runtime';
import { XrTeleop, type XrHandSample } from '../src/lib/teleop/xr';

const identity = { x: 0, y: 0, z: 0, w: 1 };
const robotPose = { position: { x: 0.3, y: 0, z: 0.2 }, orientation: identity };

function setup(armed = true) {
  const state = { armed, presentation: 'vr' };
  const sent: unknown[] = [];
  const stop = vi.fn(async () => {});
  const runtime = {
    xrHands: {},
    notify() {},
    layout: { controller_hands: { right: 'arm' } },
    controls: {
      sessions: new Map([['arm', state]]),
      session: () => ({ armed: state.armed, presentation: 'vr' }),
      operation: () => ({ profile: 'arm.cartesian_pose.v1' }),
      context: () => ({ feedback: { pose: { pose: robotPose } } }),
      send: (_id: string, input: unknown) => {
        sent.push(input);
        return true;
      },
      stop,
    },
  } as unknown as WorkspaceRuntime;
  const messages: string[] = [];
  const teleop = new XrTeleop(runtime, (message) => messages.push(message));
  const hand = (grip: boolean, y = 0, z = 0): XrHandSample => ({
    handedness: 'right',
    grip,
    pose: () => ({ position: { x: 0, y, z }, orientation: identity }),
  });
  return { teleop, state, sent, stop, messages, hand };
}

describe('XrTeleop', () => {
  it('does not engage a grip that was already held when the frames began', () => {
    const { teleop, sent, hand } = setup();
    teleop.update(0, [hand(true)]);
    teleop.update(20, [hand(true, 0.01)]);
    expect(sent).toEqual([]);
  });

  it('follows the controller from a fresh reference at each press', () => {
    const { teleop, sent, hand } = setup();
    teleop.update(0, [hand(false)]);
    teleop.update(20, [hand(true, 0.5)]);
    teleop.update(40, [hand(true, 0.51)]);
    const last = sent.at(-1) as { pose: { position: { x: number; y: number; z: number } } };
    // The controller moved up by 0.01 m after engaging, so the robot moves up by 0.01 m.
    expect(sent).toHaveLength(2);
    expect(last.pose.position.z).toBeCloseTo(0.21);
    expect(last.pose.position.x).toBeCloseTo(0.3);
  });

  it('stops following on release and stays armed', () => {
    const { teleop, stop, sent, hand } = setup();
    teleop.update(0, [hand(false)]);
    teleop.update(20, [hand(true)]);
    teleop.update(40, [hand(true, 0.01)]);
    const before = sent.length;
    teleop.update(60, [hand(false, 0.05)]);
    // One command aims the robot at its measured pose, so it does not travel to the last target.
    expect(sent).toHaveLength(before + 1);
    expect(sent.at(-1)).toEqual({ pose: robotPose });
    teleop.update(80, [hand(false, 0.06)]);
    teleop.update(100, [hand(false, 0.07)]);
    expect(sent).toHaveLength(before + 1);
    expect(stop).not.toHaveBeenCalled();
  });

  it('stops following on a tracking jump, says why, and stays armed', () => {
    const { teleop, stop, messages, hand } = setup();
    teleop.update(0, [hand(false)]);
    teleop.update(20, [hand(true)]);
    teleop.update(40, [hand(true, 0.2)]);
    expect(stop).not.toHaveBeenCalled();
    expect(messages.at(-1)).toContain('tracking gap/jump');
  });

  it('does nothing for an interface that is not armed', () => {
    const { teleop, sent, hand } = setup(false);
    teleop.update(0, [hand(false)]);
    teleop.update(20, [hand(true)]);
    teleop.update(40, [hand(true, 0.01)]);
    expect(sent).toEqual([]);
  });

  it('ignores a grip that was held while the interface became armed', () => {
    const { teleop, state, sent, hand } = setup(false);
    teleop.update(0, [hand(true)]);
    state.armed = true;
    teleop.update(20, [hand(true, 0.01)]);
    teleop.update(40, [hand(true, 0.02)]);
    expect(sent).toEqual([]);
  });

  it('disarms only armed VR inputs when the session ends', () => {
    const { teleop, stop } = setup();
    teleop.stopAll();
    expect(stop).toHaveBeenCalledWith('arm');
  });
});
