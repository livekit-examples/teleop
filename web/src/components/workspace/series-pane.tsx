'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { MAX_SERIES, validatePanel } from '@/lib/teleop/layout';
import { inspectFields, panelSeries } from '@/lib/teleop/selectors';
import type { Panel } from '@/lib/teleop/types';
import { useRuntime } from './context';
import { SERIES_COLORS } from './visualizations';

type Draft = { label: string; track: string; path: string; rate: string };

/**
 * Field discovery for one series card, like the Add visualization dialog but without a click:
 * once a topic is selected, a temporary subscription fills the JSON view and the field list.
 * The subscription ends when the card collapses, the topic changes, or the pane closes.
 */
function FieldPicker({
  track,
  path,
  onPath,
}: {
  track: string;
  path: string;
  onPath(path: string): void;
}) {
  const runtime = useRuntime();
  const id = `series-preview:${useId()}`;
  const publication = runtime.catalog().find((pub) => pub.kind === 'data' && pub.name === track);
  const usable = !!publication?.available && publication.encoding === 'json';
  // A published schema lists the fields already, so only schemaless topics need samples.
  const sampling = usable && !publication?.schema;
  useEffect(() => {
    if (!sampling) return;
    return runtime.streams.acquire(id, {
      robot: runtime.selected,
      source: { kind: 'data', track_name: track, field_path: [] },
      select: (value) => value,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, id, sampling, track]);
  const view = runtime.streams.view(id);
  const fields = useMemo(
    () =>
      publication?.schema?.fields ??
      (sampling && view.value !== undefined ? inspectFields(view.value) : []),
    [publication?.schema, sampling, view.value],
  );
  const numeric = fields.filter((field) => field.type === 'number');
  if (!track) return null;
  return (
    <>
      {!!numeric.length && (
        <label>
          Compatible field
          <select value={path} onChange={(event) => onPath(event.target.value)}>
            <option value={path}>{path} (current)</option>
            {numeric.map((field) => (
              <option key={JSON.stringify(field.path)} value={JSON.stringify(field.path)}>
                {JSON.stringify(field.path)} · {field.type}
              </option>
            ))}
          </select>
        </label>
      )}
      {sampling && (
        <div className="json-preview">
          <span className={`status status-${view.status}`}>{view.status}</span>
          <pre>
            {view.value === undefined
              ? (view.reason ?? 'Waiting for JSON…')
              : JSON.stringify(view.value, null, 2)}
          </pre>
        </div>
      )}
      {!usable && (
        <p className="field-help">
          {publication ? 'This topic is not available as JSON.' : 'This topic is not discovered yet.'}
        </p>
      )}
    </>
  );
}

/** Side pane inside a numeric plot: one editable card per plotted topic. */
export function SeriesPane({
  panel,
  onSave,
  onClose,
}: {
  panel: Panel;
  onSave(panel: Panel): void;
  onClose(): void;
}) {
  const runtime = useRuntime();
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    panelSeries(panel).map((item) => ({
      label: item.label,
      track: item.track_name,
      path: JSON.stringify(item.field_path),
      rate: item.expected_rate_hz === undefined ? '' : String(item.expected_rate_hz),
    })),
  );
  // A lone series starts open. With several, each starts collapsed.
  const [open, setOpen] = useState<boolean[]>(() => drafts.map(() => drafts.length === 1));
  const [window, setWindow] = useState(String(panel.settings.window_seconds ?? 30));
  const [error, setError] = useState('');
  const pane = useRef<HTMLElement>(null);
  // null keeps the pane docked to the right edge until it is moved.
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const place = (left: number, top: number) => {
    const el = pane.current;
    const host = el?.offsetParent as HTMLElement | null;
    if (!el || !host) return;
    setPosition({
      left: Math.min(Math.max(0, left), Math.max(0, host.clientWidth - el.offsetWidth)),
      top: Math.min(Math.max(0, top), Math.max(0, host.clientHeight - 40)),
    });
  };
  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    const el = pane.current;
    if (!el || (event.target as HTMLElement).closest('[data-no-drag]')) return;
    drag.current = { dx: event.clientX - el.offsetLeft, dy: event.clientY - el.offsetTop };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current) place(event.clientX - drag.current.dx, event.clientY - drag.current.dy);
  };
  const nudge = (event: KeyboardEvent<HTMLElement>) => {
    const el = pane.current;
    const step = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] }[
      event.key
    ];
    if (!el || !step) return;
    event.preventDefault();
    place(el.offsetLeft + step[0], el.offsetTop + step[1]);
  };
  const publications = runtime
    .catalog()
    .filter((pub) => pub.kind === 'data' && !pub.excluded && pub.encoding === 'json');
  const change = (index: number, patch: Partial<Draft>) =>
    setDrafts((all) => all.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));
  const apply = () => {
    try {
      const series = drafts.map((draft) => {
        if (!draft.track) throw new Error('Select a topic for every series.');
        const msgType = runtime
          .catalog()
          .find((p) => p.kind === 'data' && p.name === draft.track)?.msgType;
        return {
          label: draft.label.trim() || draft.track,
          track_name: draft.track,
          field_path: JSON.parse(draft.path) as (string | number)[],
          ...(msgType ? { expected_msg_type: msgType } : {}),
          ...(draft.rate ? { expected_rate_hz: Number(draft.rate) } : {}),
        };
      });
      const { joint_names: _joints, ...source } = panel.source;
      void _joints;
      const { expected_rate_hz: _rate, ...settings } = panel.settings;
      void _rate;
      onSave(
        validatePanel({
          ...panel,
          source: {
            ...source,
            track_name: series[0].track_name,
            field_path: series[0].field_path,
            ...(series[0].expected_msg_type
              ? { expected_msg_type: series[0].expected_msg_type }
              : { expected_msg_type: undefined }),
          },
          series,
          settings: {
            ...settings,
            window_seconds: Number(window),
            ...(series[0].expected_rate_hz ? { expected_rate_hz: series[0].expected_rate_hz } : {}),
          },
        }),
      );
      setError('');
    } catch (problem) {
      setError(
        problem instanceof SyntaxError
          ? 'Field path must be a JSON array.'
          : (problem as Error).message,
      );
    }
  };
  return (
    <aside
      ref={pane}
      className="series-pane"
      style={position ? { left: position.left, top: position.top, right: 'auto' } : undefined}
      aria-label={`Plotted data for ${panel.label}`}
    >
      <div
        className="series-pane-heading"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        <button
          className="series-pane-handle"
          aria-label="Plotted data. Drag to move this pane, or use the arrow keys."
          onKeyDown={nudge}
        >
          Plotted data
        </button>
        <button data-no-drag onClick={onClose} aria-label="Close plotted data pane">
          ×
        </button>
      </div>
      <div className="series-pane-body">
        {drafts.map((draft, index) => (
          <div
            className="series-card"
            role="group"
            aria-label={draft.label || draft.track || `Series ${index + 1}`}
            key={index}
          >
            <button
              className="series-card-header"
              aria-expanded={open[index]}
              onClick={() => setOpen((all) => all.map((v, i) => (i === index ? !v : v)))}
            >
              {open[index] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <i style={{ background: SERIES_COLORS[index % SERIES_COLORS.length] }} />
              <span>{draft.label || draft.track || `Series ${index + 1}`}</span>
              {draft.track && draft.label && <small>{draft.track}</small>}
            </button>
            {open[index] && (
              <div className="series-card-body">
                <label>
                  Topic
                  <select
                    value={draft.track}
                    onChange={(event) => change(index, { track: event.target.value, path: '[]' })}
                  >
                    <option value="">Select a discovered topic</option>
                    {draft.track && !publications.some((pub) => pub.name === draft.track) && (
                      <option value={draft.track}>{draft.track} (unavailable)</option>
                    )}
                    {publications.map((pub) => (
                      <option key={pub.name} value={pub.name}>
                        {pub.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Literal field path (JSON array)
                  <input
                    value={draft.path}
                    onChange={(event) => change(index, { path: event.target.value })}
                    spellCheck={false}
                  />
                </label>
                <FieldPicker
                  key={draft.track}
                  track={draft.track}
                  path={draft.path}
                  onPath={(path) => change(index, { path })}
                />
                <label>
                  Data label
                  <input
                    value={draft.label}
                    onChange={(event) => change(index, { label: event.target.value })}
                    placeholder={draft.track || 'Data label'}
                  />
                </label>
                <label>
                  Expected sample rate, Hz (optional)
                  <input
                    inputMode="decimal"
                    value={draft.rate}
                    onChange={(event) => change(index, { rate: event.target.value })}
                  />
                </label>
                <button
                  disabled={drafts.length === 1}
                  onClick={() => {
                    setDrafts((all) => all.filter((_, i) => i !== index));
                    setOpen((all) => all.filter((_, i) => i !== index));
                  }}
                >
                  Remove series
                </button>
              </div>
            )}
          </div>
        ))}
        <button
          disabled={drafts.length >= MAX_SERIES}
          onClick={() => {
            setDrafts((all) => [...all, { label: '', track: '', path: '[]', rate: '' }]);
            setOpen((all) => [...all, true]);
          }}
        >
          Add series
        </button>
        <label>
          Window, seconds (all series)
          <input inputMode="decimal" value={window} onChange={(e) => setWindow(e.target.value)} />
        </label>
      </div>
      {error && (
        <p className="series-pane-error" role="alert">
          {error}
        </p>
      )}
      <div className="series-pane-actions">
        <button className="primary" onClick={apply}>
          Apply
        </button>
      </div>
    </aside>
  );
}
