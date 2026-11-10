import { controlChannels, controlKey } from '../controls';
import type { WorkspaceRuntime } from '../runtime';

export type TrackedHand = 'left' | 'right';

/** The ID of the hand tracking video in the live camera deck. A robot track ID never starts with `local:`. */
export const HAND_CAMERA_ID = 'local:hand_tracking';

/** Interfaces that offer the hand tracking presentation, which are the ones a hand can drive. */
export function handInterfaces(runtime: WorkspaceRuntime): [string, string][] {
  return Object.entries(runtime.config?.control_interfaces ?? {})
    .filter(([, equipment]) =>
      Object.values(equipment.operations).some((op) => op.presentations.includes('hand_tracking')),
    )
    .map(([id, equipment]) => [id, equipment.label]);
}

/** Interfaces where the operator has chosen the hand tracking presentation on some channel. */
export function handSelected(runtime: WorkspaceRuntime): string[] {
  return handInterfaces(runtime)
    .map(([id]) => id)
    .filter((id) =>
      controlChannels(runtime.config!.control_interfaces[id]).some(
        (channel) =>
          runtime.controls.session(controlKey(id, channel))?.presentation === 'hand_tracking',
      ),
    );
}

/** Assign an interface to a tracked hand. An empty id clears the hand. One interface has one hand. */
export async function bindTrackedHand(runtime: WorkspaceRuntime, hand: TrackedHand, id: string) {
  await runtime.controls.stopAll();
  if (!runtime.layout) return;
  const other: TrackedHand = hand === 'left' ? 'right' : 'left';
  const hands = { ...runtime.layout.tracked_hands };
  if (id) hands[hand] = id;
  else delete hands[hand];
  if (id && hands[other] === id) delete hands[other];
  runtime.editLayout({ ...runtime.layout, tracked_hands: hands });
}
