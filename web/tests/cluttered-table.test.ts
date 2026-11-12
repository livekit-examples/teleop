import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { controlChannels } from '../src/lib/teleop/controls';
import { parseDiscovery } from '../src/lib/teleop/validation';

const file = resolve(
  __dirname,
  '../../robo-sims/sims/contract/configs/cluttered-table.discovery.json',
);

describe.skipIf(!existsSync(file))('cluttered table discovery', () => {
  const config = () => parseDiscovery(readFileSync(file, 'utf8'));

  it('is a valid robot configuration with two arms', () => {
    expect(Object.keys(config().control_interfaces)).toEqual(['left_arm', 'right_arm']);
  });

  it('makes hand tracking the default control of each arm, with the gripper beside it', () => {
    for (const equipment of Object.values(config().control_interfaces)) {
      // The workspace picks the first operation of a channel and its first presentation.
      const first = (channel: string) =>
        Object.values(equipment.operations).find(
          (op) => (op.control_channel ?? 'primary') === channel,
        )!;
      expect(first('primary').profile).toBe('arm.cartesian_pose.v1');
      expect(first('primary').presentations[0]).toBe('hand_tracking');
      expect(first('gripper').profile).toBe('gripper.position.v1');
      expect(controlChannels(equipment).sort()).toEqual(['gripper', 'primary']);
    }
  });
});
