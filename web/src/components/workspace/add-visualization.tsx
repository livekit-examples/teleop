'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { RateFields, type RateDraft, ratesFrom, ratesToFields } from './rate-fields';
import {
  GAUGE_DEFAULT_MAX,
  GAUGE_DEFAULT_MAX_COLOR,
  GAUGE_DEFAULT_MIN,
  GAUGE_DEFAULT_MIN_COLOR,
  gaugeColor,
} from '@/lib/teleop/gauge';
import { validatePanel, visualizationNames } from '@/lib/teleop/layout';
import { inspectFields } from '@/lib/teleop/selectors';
import type { FieldPath, MediaKind, Panel, Visualization } from '@/lib/teleop/types';
import { useRuntime } from './context';

/** A topic picked from the catalog; the dialog pre-fills everything it can infer from it. */
export type Prefill = { kind: MediaKind; track: string };

type Field = { path: FieldPath; type: string; enum?: Record<string, string> };

/** Pick the most useful visualization and field for a topic from its known/inspected fields. */
export function suggestVisualization(
  kind: MediaKind,
  fields: Field[],
): { visualization: Visualization; field?: Field } {
  if (kind === 'video') return { visualization: 'video' };
  if (kind === 'audio') return { visualization: 'audio' };
  const joints = fields.find(
    (field) =>
      field.type === 'object' &&
      fields.some(
        (f) =>
          f.type === 'array' && JSON.stringify(f.path) === JSON.stringify([...field.path, 'name']),
      ) &&
      fields.some(
        (f) =>
          f.type === 'array' && JSON.stringify(f.path) === JSON.stringify([...field.path, 'position']),
      ),
  );
  if (joints) return { visualization: 'joints', field: joints };
  const leaf = (type: string) => fields.find((field) => field.path.length && field.type === type);
  const enumField = fields.find((field) => field.path.length && field.enum);
  if (enumField) return { visualization: 'state', field: enumField };
  const number = leaf('number');
  if (number) return { visualization: 'plot', field: number };
  const boolean = leaf('boolean');
  if (boolean) return { visualization: 'boolean', field: boolean };
  const string = leaf('string');
  if (string) return { visualization: 'state', field: string };
  return { visualization: fields.length ? 'raw' : 'plot', field: fields[0] };
}


export function AddVisualization({
  initial,
  prefill,
  onSave,
  onClose,
}: {
  initial?: Panel;
  prefill?: Prefill;
  onSave(panel: Panel): void;
  onClose(): void;
}) {
  const runtime = useRuntime();
  const dialog = useRef<HTMLElement>(null);
  const prefillFields = (topic: Prefill): Field[] =>
    runtime.catalog().find((pub) => pub.kind === topic.kind && pub.name === topic.track)?.schema
      ?.fields ?? [];
  const [visualization, setVisualization] = useState<Visualization>(
    initial?.visualization ??
      (prefill ? suggestVisualization(prefill.kind, prefillFields(prefill)).visualization : 'plot'),
  );
  const [track, setTrack] = useState(initial?.source.track_name ?? prefill?.track ?? '');
  const [path, setPath] = useState(() =>
    JSON.stringify(
      initial?.source.field_path ??
        (prefill ? suggestVisualization(prefill.kind, prefillFields(prefill)).field?.path : []) ??
        [],
    ),
  );
  const [label, setLabel] = useState(initial?.label ?? prefill?.track ?? '');
  const [rates, setRates] = useState<RateDraft>(() => ratesFrom(initial?.settings));
  const [window, setWindow] = useState(String(initial?.settings.window_seconds ?? 30));
  const [min, setMin] = useState(String(initial?.settings.min ?? GAUGE_DEFAULT_MIN));
  const [max, setMax] = useState(String(initial?.settings.max ?? GAUGE_DEFAULT_MAX));
  const [colorBy, setColorBy] = useState(!!initial?.settings.min_color);
  const [minColor, setMinColor] = useState(initial?.settings.min_color ?? GAUGE_DEFAULT_MIN_COLOR);
  const [maxColor, setMaxColor] = useState(initial?.settings.max_color ?? GAUGE_DEFAULT_MAX_COLOR);
  // Empty inputs read as NaN so validation names the missing bound instead of using 0.
  const bound = (value: string) => (value.trim() === '' ? NaN : Number(value));
  const rangeError =
    visualization === 'gauge' && bound(min) >= bound(max)
      ? 'Minimum must be less than maximum.'
      : '';
  const [enumLabels, setEnumLabels] = useState(
    JSON.stringify(
      initial?.settings.enum_labels ??
        (prefill ? suggestVisualization(prefill.kind, prefillFields(prefill)).field?.enum : {}) ??
        {},
      null,
      2,
    ),
  );
  const [jointNames, setJointNames] = useState(initial?.source.joint_names?.join('\n') ?? '');
  // Without a published schema, a topic picked from the catalog opens its JSON preview so the
  // dialog can discover fields and pre-select one.
  const [preview, setPreview] = useState(
    () => !!prefill && prefill.kind === 'data' && !prefillFields(prefill).length,
  );
  const autofill = useRef(!!prefill && prefill.kind === 'data' && !prefillFields(prefill).length);
  const [error, setError] = useState('');
  const [image, setImage] = useState(initial?.settings.image_layout ?? 'mono');
  const [eye, setEye] = useState(initial?.settings.eye ?? 'left');
  const [volume, setVolume] = useState(initial?.settings.volume ?? 0.8);
  const [muted, setMuted] = useState(initial?.settings.muted ?? false);
  const kind = visualization === 'video' ? 'video' : visualization === 'audio' ? 'audio' : 'data';
  const publications = runtime.catalog().filter((pub) => pub.kind === kind && !pub.excluded);
  const publication = publications.find((pub) => pub.name === track);
  const signature = `${kind}:${track}:${preview}`;
  useEffect(() => {
    if (!preview || kind !== 'data' || !publication?.available || publication.encoding !== 'json')
      return;
    return runtime.streams.acquire('field-preview', {
      robot: runtime.selected,
      source: { kind: 'data', track_name: track, field_path: [] },
      select: (v) => v,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, signature, publication?.id]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () => [
      ...(dialog.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)',
      ) ?? []),
    ];
    focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const elements = focusable();
        const first = elements[0];
        const last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [onClose]);
  const view = runtime.streams.view('field-preview');
  const fields = useMemo(
    () =>
      publication?.schema?.fields ?? (view.value !== undefined ? inspectFields(view.value) : []),
    [publication?.schema, view.value],
  );
  useEffect(() => {
    if (!autofill.current || !fields.length) return;
    autofill.current = false;
    const suggestion = suggestVisualization('data', fields);
    setVisualization(suggestion.visualization);
    if (suggestion.field) setPath(JSON.stringify(suggestion.field.path));
  }, [fields]);
  const fieldType =
    visualization === 'boolean'
      ? 'boolean'
      : ['plot', 'value', 'gauge'].includes(visualization)
        ? 'number'
        : visualization === 'state'
          ? 'scalar'
          : 'any';
  const compatible = fields.filter(
    (field) =>
      fieldType === 'any' ||
      field.type === fieldType ||
      (fieldType === 'scalar' && ['boolean', 'number', 'string'].includes(field.type)),
  );
  const save = () => {
    try {
      if (!publication) throw new Error('Select an eligible topic.');
      if (kind === 'data' && publication.encoding !== 'json')
        throw new Error(
          `Unsupported encoding: ${publication.encoding ?? 'metadata not published'}.`,
        );
      const settings =
        kind === 'audio'
          ? { volume, muted }
          : kind === 'video'
            ? { image_layout: image, eye }
            : {
                ...ratesToFields(rates),
                ...(['plot', 'state'].includes(visualization)
                  ? { window_seconds: Number(window) }
                  : {}),
                ...(visualization === 'state' ? { enum_labels: JSON.parse(enumLabels) } : {}),
                ...(visualization === 'gauge' ? { min: bound(min), max: bound(max) } : {}),
                ...(visualization === 'gauge' && colorBy
                  ? { min_color: minColor, max_color: maxColor }
                  : {}),
              };
      const panel = validatePanel({
        visualization,
        label: label || track,
        visible: initial?.visible ?? true,
        source: {
          kind,
          track_name: track,
          field_path: kind === 'data' ? JSON.parse(path) : [],
          ...(publication.msgType ? { expected_msg_type: publication.msgType } : {}),
          ...(jointNames.trim() && ['joints', 'plot', 'value', 'gauge'].includes(visualization)
            ? {
                joint_names: jointNames
                  .split('\n')
                  .map((name) => name.trim())
                  .filter(Boolean),
              }
            : {}),
        },
        // Keep extra plot series when the dialog edits the first one.
        ...(visualization === 'plot' && initial?.series
          ? {
              series: initial.series.map((item, index) =>
                index === 0
                  ? {
                      ...item,
                      track_name: track,
                      field_path: JSON.parse(path),
                      ...(publication.msgType ? { expected_msg_type: publication.msgType } : {}),
                      ...ratesToFields(rates),
                    }
                  : item,
              ),
            }
          : {}),
        settings,
      });
      onSave(panel);
    } catch (error) {
      setError((error as Error).message);
    }
  };
  return (
    <div className="workspace-modal-backdrop">
      <section
        ref={dialog}
        className="workspace-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="visualization-dialog-title"
      >
        <div className="modal-heading">
          <div>
            <span className="workspace-eyebrow">BUILD YOUR WORKSPACE</span>
            <h2 id="visualization-dialog-title">
              {initial ? 'Visualization settings' : 'Add visualization'}
            </h2>
          </div>
          <button onClick={onClose} aria-label="Close visualization dialog">
            ×
          </button>
        </div>
        <div className="visualization-form">
          <label>
            Visualization
            <select
              value={visualization}
              onChange={(event) => {
                const next = event.target.value as Visualization;
                const nextKind = next === 'video' ? 'video' : next === 'audio' ? 'audio' : 'data';
                autofill.current = false;
                setVisualization(next);
                // Keep a pre-filled topic when it still matches the visualization's media kind.
                if (nextKind === kind && track) return;
                setTrack('');
                setPreview(false);
                setPath('[]');
              }}
            >
              {Object.entries(visualizationNames).map(([type, name]) => (
                <option key={type} value={type}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Topic
            <select
              value={track}
              onChange={(event) => {
                autofill.current = false;
                setTrack(event.target.value);
                setPreview(false);
                setPath('[]');
              }}
            >
              <option value="">Select a discovered topic</option>
              {publications.map((pub) => (
                <option key={pub.name} value={pub.name}>
                  {pub.name}
                  {!pub.available
                    ? ' (unavailable)'
                    : kind === 'data' && pub.encoding !== 'json'
                      ? ' (unsupported encoding)'
                      : ''}
                </option>
              ))}
            </select>
          </label>
          {publication && (
            <p className="field-help">
              {publication.msgType ?? 'No schema ID'} ·{' '}
              {publication.encoding ?? 'No encoding metadata'}
              {kind === 'data' && publication.encoding !== 'json'
                ? ' · JSON decoder unavailable for this publication.'
                : ''}
            </p>
          )}
          <label>
            Panel title
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder={track || 'Panel title'}
            />
          </label>
          {kind === 'data' && (
            <>
              {!publication?.schema && (
                <div className="preview-action">
                  <button
                    disabled={!publication?.available || publication.encoding !== 'json'}
                    onClick={() => setPreview((value) => !value)}
                  >
                    {preview ? 'Close JSON preview' : 'Preview JSON to find fields'}
                  </button>
                  <p className="field-help">
                    Preview receives temporary samples. Closing it releases its subscription.
                  </p>
                </div>
              )}
              {preview && (
                <div className="json-preview">
                  <span className={`status status-${view.status}`}>{view.status}</span>
                  <pre>
                    {view.value === undefined
                      ? (view.reason ?? 'Waiting for JSON…')
                      : JSON.stringify(view.value, null, 2)}
                  </pre>
                </div>
              )}
              {!!fields.length && (
                <label>
                  Compatible field
                  <select
                    value={path}
                    onChange={(event) => {
                      setPath(event.target.value);
                      const field = publication?.schema?.fields.find(
                        (field) => JSON.stringify(field.path) === event.target.value,
                      );
                      if (field?.enum) setEnumLabels(JSON.stringify(field.enum, null, 2));
                    }}
                  >
                    <option value={path}>{path} (current)</option>
                    {compatible.map((field) => (
                      <option key={JSON.stringify(field.path)} value={JSON.stringify(field.path)}>
                        {JSON.stringify(field.path)} · {field.type}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Literal field path (JSON array)
                <input
                  value={path}
                  onChange={(event) => setPath(event.target.value)}
                  spellCheck={false}
                  placeholder={'["angular_velocity", "z"]'}
                />
              </label>
              {['plot', 'value', 'gauge', 'joints'].includes(visualization) && (
                <label>
                  Exact joint names (optional; one per line)
                  <textarea
                    value={jointNames}
                    onChange={(event) => setJointNames(event.target.value)}
                    placeholder={
                      visualization === 'joints'
                        ? 'Leave empty to show all named joints'
                        : 'Select one joint position instead of a scalar field'
                    }
                    rows={2}
                  />
                </label>
              )}
              {visualization === 'gauge' && (
                <>
                  <div className="field-row">
                    <label>
                      Minimum
                      <input
                        type="number"
                        step="any"
                        value={min}
                        onChange={(event) => setMin(event.target.value)}
                        aria-invalid={!!rangeError}
                      />
                    </label>
                    <label>
                      Maximum
                      <input
                        type="number"
                        step="any"
                        value={max}
                        onChange={(event) => setMax(event.target.value)}
                        aria-invalid={!!rangeError}
                      />
                    </label>
                  </div>
                  {rangeError ? (
                    <p className="field-help field-error" role="alert">
                      {rangeError}
                    </p>
                  ) : (
                    <p className="field-help">
                      Values outside this range pin to the end of the arc and are flagged.
                    </p>
                  )}
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={colorBy}
                      onChange={(event) => setColorBy(event.target.checked)}
                    />
                    Color by value
                  </label>
                  {colorBy && (
                    <>
                      <div className="field-row">
                        <label>
                          Minimum color
                          <input
                            type="color"
                            value={minColor}
                            onChange={(event) => setMinColor(event.target.value)}
                          />
                        </label>
                        <label>
                          Maximum color
                          <input
                            type="color"
                            value={maxColor}
                            onChange={(event) => setMaxColor(event.target.value)}
                          />
                        </label>
                      </div>
                      <div
                        className="gauge-color-preview"
                        aria-hidden="true"
                        style={{
                          background: `linear-gradient(to right, ${Array.from({ length: 9 }, (_, i) => gaugeColor(i / 8, minColor, maxColor)).join(', ')})`,
                        }}
                      />
                      <p className="field-help">
                        The fill blends from the minimum color to the value’s color.
                      </p>
                    </>
                  )}
                </>
              )}
              <RateFields value={rates} onChange={setRates} />
              {['plot', 'state'].includes(visualization) && (
                <label>
                  History window, seconds
                  <input
                    type="number"
                    min="0.1"
                    max="600"
                    step="any"
                    value={window}
                    onChange={(event) => setWindow(event.target.value)}
                  />
                </label>
              )}
              {visualization === 'state' && (
                <label>
                  Explicit value-to-label map (JSON object)
                  <textarea
                    rows={4}
                    value={enumLabels}
                    onChange={(event) => setEnumLabels(event.target.value)}
                    placeholder={'{"0":"Idle","1":"Running"}'}
                  />
                </label>
              )}
            </>
          )}
          {kind === 'video' && (
            <>
              <p className="field-help">
                Every eligible camera already appears automatically. This adds another view without
                changing the main camera.
              </p>
              <label>
                Image interpretation
                <select
                  value={image}
                  onChange={(event) => setImage(event.target.value as typeof image)}
                >
                  <option value="mono">Normal full frame</option>
                  <option value="stereo_sbs">Stereo side-by-side</option>
                </select>
              </label>
              {image === 'stereo_sbs' && (
                <label>
                  Eye
                  <select
                    value={eye}
                    onChange={(event) => setEye(event.target.value as typeof eye)}
                  >
                    <option value="left">Left</option>
                    <option value="right">Right</option>
                  </select>
                </label>
              )}
            </>
          )}
          {kind === 'audio' && (
            <>
              <label>
                Volume
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={volume}
                  onChange={(event) => setVolume(Number(event.target.value))}
                />
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={muted}
                  onChange={(event) => setMuted(event.target.checked)}
                />
                Mute
              </label>
              <p className="field-help">
                Listening is always off until you enable it in the panel.
              </p>
            </>
          )}
        </div>
        {error && (
          <p className="workspace-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save}>
            {initial ? 'Save settings' : 'Add panel'}
          </button>
        </div>
      </section>
    </div>
  );
}
