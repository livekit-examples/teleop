import type { FieldPath, Panel, PlotSeries, Publication } from './types';

export function selectPath(value: unknown, path: FieldPath): unknown {
  let current = value;
  for (const part of path) {
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, part))
      throw new Error(`Field ${JSON.stringify(path)} is absent.`);
    current = (current as Record<string | number, unknown>)[part];
  }
  return current;
}

export type NamedJoint = {
  name: string;
  position?: number;
  velocity?: number;
  effort?: number;
};
export function selectJoints(value: unknown, names: string[] = []): NamedJoint[] {
  if (!value || typeof value !== 'object') throw new Error('Expected a named joint-state object.');
  const state = value as Record<string, unknown>;
  if (
    !Array.isArray(state.name) ||
    !state.name.every((n) => typeof n === 'string') ||
    new Set(state.name).size !== state.name.length
  )
    throw new Error('Joint state needs unique exact joint names.');
  const wanted = names.length ? names : (state.name as string[]);
  return wanted.map((name) => {
    const i = (state.name as string[]).indexOf(name);
    if (i < 0) throw new Error(`Required joint ${name} is absent.`);
    const joint: NamedJoint = { name };
    for (const key of ['position', 'velocity', 'effort'] as const) {
      const array = state[key];
      if (Array.isArray(array) && typeof array[i] === 'number' && Number.isFinite(array[i]))
        joint[key] = array[i];
    }
    if (joint.position === undefined && joint.velocity === undefined && joint.effort === undefined)
      throw new Error(`No usable values for joint ${name}.`);
    return joint;
  });
}

export function panelSelector(panel: Panel): (value: unknown) => unknown {
  return (value) => {
    const selected = selectPath(value, panel.source.field_path);
    if (panel.visualization === 'joints') return selectJoints(selected, panel.source.joint_names);
    if (panel.source.joint_names?.length) {
      const joint = selectJoints(selected, panel.source.joint_names)[0];
      const number = joint.position;
      if (number === undefined) throw new Error(`Joint ${joint.name} has no position.`);
      return number;
    }
    if (panel.visualization === 'plot' || panel.visualization === 'value') {
      if (typeof selected !== 'number' || !Number.isFinite(selected))
        throw new Error('Selected field is not a finite number.');
    } else if (panel.visualization === 'boolean' && typeof selected !== 'boolean')
      throw new Error('Selected field is not Boolean.');
    else if (
      panel.visualization === 'state' &&
      !['number', 'string', 'boolean'].includes(typeof selected)
    )
      throw new Error('Selected state is not a scalar value.');
    return selected;
  };
}
/** The series a numeric plot draws. Plots saved without `series` draw their single source. */
export function panelSeries(panel: Panel): PlotSeries[] {
  if (panel.series?.length) return panel.series;
  return [
    {
      label: panel.label,
      track_name: panel.source.track_name,
      field_path: panel.source.field_path,
      ...(panel.source.expected_msg_type
        ? { expected_msg_type: panel.source.expected_msg_type }
        : {}),
      ...(panel.settings.expected_rate_hz
        ? { expected_rate_hz: panel.settings.expected_rate_hz }
        : {}),
    },
  ];
}
export function seriesSelector(panel: Panel, index: number): (value: unknown) => unknown {
  // A plot saved without `series` keeps its own source, including any single-joint selection.
  if (!panel.series) return panelSelector(panel);
  const series = panel.series[index];
  return panelSelector({
    ...panel,
    source: {
      ...panel.source,
      track_name: series.track_name,
      field_path: series.field_path,
      joint_names: undefined,
    },
  });
}
export function compatibility(panel: Panel, pub?: Publication): string | undefined {
  if (!pub) return;
  if (panel.source.expected_msg_type && panel.source.expected_msg_type !== pub.msgType)
    return `Saved message type ${panel.source.expected_msg_type} does not match ${pub.msgType ?? 'untyped publication'}.`;
  if (pub.kind === 'data' && pub.encoding !== 'json')
    return `Encoding ${pub.encoding ?? '(not published)'} is unsupported. Explicit JSON frame metadata is required.`;
}
export function inspectFields(
  value: unknown,
  path: FieldPath = [],
  depth = 0,
): { path: FieldPath; type: string }[] {
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  const result = [{ path, type }];
  if (depth < 7 && value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value).slice(0, 100)) {
      result.push(
        ...inspectFields(item, [...path, Array.isArray(value) ? Number(key) : key], depth + 1),
      );
    }
  }
  return result.slice(0, 1000);
}
