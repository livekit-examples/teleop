import { operationPresentations } from './control-profiles';
import type { WorkspaceRuntime } from './runtime';

export type Hand = 'left' | 'right';

/** Interfaces that offer the VR presentation, which are the ones a hand can drive. */
export function vrInterfaces(runtime: WorkspaceRuntime): [string, string][] {
  return Object.entries(runtime.config?.control_interfaces ?? {})
    .filter(([, equipment]) =>
      Object.values(equipment.operations).some((operation) =>
        operationPresentations(operation).includes('vr'),
      ),
    )
    .map(([id, equipment]) => [id, equipment.label]);
}

/** Assign a control interface to a hand. An empty id clears the hand. One interface has one hand. */
export async function bindHand(runtime: WorkspaceRuntime, hand: Hand, id: string) {
  await runtime.controls.stopAll();
  if (!runtime.layout) return;
  const other: Hand = hand === 'left' ? 'right' : 'left';
  const hands = { ...runtime.layout.controller_hands };
  if (id) hands[hand] = id;
  else delete hands[hand];
  if (id && hands[other] === id) delete hands[other];
  runtime.editLayout({ ...runtime.layout, controller_hands: hands });
}
