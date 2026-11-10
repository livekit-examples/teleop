import { validatePanel } from '@/lib/teleop/layout';
import type { CatalogEntry, WorkspaceRuntime } from '@/lib/teleop/runtime';
import { inspectFields } from '@/lib/teleop/selectors';
import { suggestVisualization } from '../add-visualization';
import { updatePanel } from '../workspace-host';

/**
 * Add a visualization for a topic with the choices that the Add visualization dialog suggests.
 * Immersive VR has no form, so the topic decides everything. A JSON topic that publishes no
 * schema is sampled for a moment, so that a number or a state gets a better view than raw JSON.
 */
export async function quickAddVisualization(runtime: WorkspaceRuntime, pub: CatalogEntry) {
  let fields = pub.schema?.fields ?? [];
  if (pub.kind === 'data' && !fields.length && pub.encoding === 'json') {
    const key = 'quick-add-preview';
    const release = runtime.streams.acquire(key, {
      robot: runtime.selected,
      source: { kind: 'data', track_name: pub.name, field_path: [] },
      select: (value) => value,
    });
    try {
      for (let wait = 0; wait < 20 && runtime.streams.view(key).value === undefined; wait++)
        await runtime.clock.delay(100);
      const value = runtime.streams.view(key).value;
      if (value !== undefined) fields = inspectFields(value);
    } finally {
      release();
    }
  }
  const suggestion = suggestVisualization(pub.kind, fields);
  const stereo = Object.values(runtime.config?.camera_info ?? {}).some(
    (info) => info.track_name === pub.name && 'left' in info.views,
  );
  const visualization = suggestion.visualization;
  const settings =
    pub.kind === 'audio'
      ? { volume: 0.8, muted: false }
      : pub.kind === 'video'
        ? { image_layout: stereo ? 'stereo_sbs' : 'mono', eye: 'left' }
        : {
            ...(['plot', 'state'].includes(visualization) ? { window_seconds: 30 } : {}),
            ...(visualization === 'state' ? { enum_labels: suggestion.field?.enum ?? {} } : {}),
          };
  const panel = validatePanel({
    visualization,
    label: pub.name,
    visible: true,
    source: {
      kind: pub.kind,
      track_name: pub.name,
      field_path: pub.kind === 'data' ? (suggestion.field?.path ?? []) : [],
      ...(pub.msgType ? { expected_msg_type: pub.msgType } : {}),
    },
    settings,
  });
  updatePanel(runtime, `panel_${crypto.randomUUID().replaceAll('-', '')}`, panel);
  return panel;
}
