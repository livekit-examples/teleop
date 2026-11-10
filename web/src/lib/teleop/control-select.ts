import { controlKey } from './controls';
import type { WorkspaceRuntime } from './runtime';

/** Choose an operation and presentation for one control channel, and save the choice in the layout. */
export async function chooseControl(
  runtime: WorkspaceRuntime,
  equipmentId: string,
  channel: string,
  operation: string,
  presentation: string,
) {
  const id = controlKey(equipmentId, channel);
  await runtime.controls.select(id, operation, presentation);
  const current = runtime.controls.session(id);
  if (runtime.layout && current) {
    const pref = { operation: current.operation, presentation: current.presentation };
    runtime.editLayout(
      channel === 'primary'
        ? {
            ...runtime.layout,
            control_preferences: { ...runtime.layout.control_preferences, [equipmentId]: pref },
          }
        : {
            ...runtime.layout,
            layout_schema_version: 2,
            control_channel_preferences: {
              ...runtime.layout.control_channel_preferences,
              [equipmentId]: {
                ...runtime.layout.control_channel_preferences?.[equipmentId],
                [channel]: pref,
              },
            },
          },
    );
  }
  runtime.notify();
}
