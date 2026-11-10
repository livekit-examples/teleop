'use client';

import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import type { NamedJoint } from '@/lib/teleop/selectors';
import { compatibility, panelSeries } from '@/lib/teleop/selectors';
import { monitoringPolicy, type Sample } from '@/lib/teleop/streams';
import type { Panel } from '@/lib/teleop/types';
import { own } from '@/lib/teleop/types';
import { useDataView, useRuntime, useSeriesViews } from './context';
import { AudioView, ExtraVideo } from './media';

export const SERIES_COLORS = [
  '#1fd5f9',
  '#23de6b',
  '#ffb752',
  '#dc85ff',
  '#ff6b6b',
  '#f5e663',
  '#6b8cff',
  '#9be3c6',
];

/** Merge per-series samples onto one sorted time axis. Missing points are `undefined` (spanned). */
function mergeSeries(
  all: Sample[][],
  rates: (number | undefined)[],
): [number[], ...(number | null | undefined)[][]] {
  const columns = all.map((samples, index) => {
    const points: [number, number | null][] = [];
    let previous: number | undefined;
    for (const sample of samples) {
      const rate = rates[index];
      if (previous !== undefined && rate && sample.t - previous > monitoringPolicy.stale(rate))
        points.push([(previous + 1) / 1000, null]);
      points.push([sample.t / 1000, typeof sample.value === 'number' ? sample.value : null]);
      previous = sample.t;
    }
    return points;
  });
  const x = [...new Set(columns.flatMap((points) => points.map(([t]) => t)))].sort((a, b) => a - b);
  const ys = columns.map((points) => {
    const byTime = new Map(points);
    return x.map((t) => byTime.get(t));
  });
  return [x, ...ys];
}

function NumericPlot({ samples, panel }: { samples: Sample[][]; panel: Panel }) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<uPlot | null>(null);
  // The user's drag-zoom on time survives new samples until a double click resets it.
  const zoomed = useRef(false);
  // Y range covers every value seen since this plot began, so the scale only widens.
  const seen = useRef<{ min: number; max: number; upTo: number[] }>({
    min: Infinity,
    max: -Infinity,
    upTo: [],
  });
  const series = panelSeries(panel);
  const seriesKey = JSON.stringify(series.map((item) => item.label));
  useEffect(() => {
    const host = ref.current!;
    zoomed.current = false;
    seen.current = { min: Infinity, max: -Infinity, upTo: [] };
    const size = () => ({
      width: Math.max(200, host.clientWidth),
      // The legend sits below the canvas, so leave room for it.
      height: Math.max(120, host.clientHeight - 30),
    });
    const plot = new uPlot(
      {
        ...size(),
        scales: { x: { time: false }, y: { auto: false, range: [0, 1] } },
        axes: [
          { label: 'Receive time (s)', stroke: '#999999', grid: { stroke: '#202020' } },
          { stroke: '#999999', grid: { stroke: '#202020' } },
        ],
        series: [
          {},
          ...series.map((item, index) => ({
            label: item.label,
            stroke: SERIES_COLORS[index % SERIES_COLORS.length],
            width: 1.5,
            spanGaps: false,
          })),
        ],
        cursor: { drag: { x: true, y: false } },
        hooks: {
          // A finished drag selection is a user zoom. Automatic range changes are not.
          setSelect: [
            (u) => {
              if (u.select.width > 0) zoomed.current = true;
            },
          ],
        },
      },
      [[], ...series.map(() => [])],
      host,
    );
    chart.current = plot;
    const reset = () => (zoomed.current = false);
    host.addEventListener('dblclick', reset);
    const observer = new ResizeObserver(() => plot.setSize(size()));
    observer.observe(host);
    return () => {
      host.removeEventListener('dblclick', reset);
      observer.disconnect();
      plot.destroy();
      chart.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesKey]);
  useEffect(() => {
    const plot = chart.current;
    if (!plot) return;
    const range = seen.current;
    samples.forEach((list, index) => {
      const from = range.upTo[index] ?? -Infinity;
      for (const sample of list) {
        if (sample.t <= from) continue;
        if (typeof sample.value === 'number' && Number.isFinite(sample.value)) {
          range.min = Math.min(range.min, sample.value);
          range.max = Math.max(range.max, sample.value);
        }
      }
      range.upTo[index] = list.at(-1)?.t ?? from;
    });
    const data = mergeSeries(
      samples,
      series.map((item) => item.expected_rate_hz),
    );
    if (!data[0].length) return;
    plot.setData(data as uPlot.AlignedData, !zoomed.current);
    if (range.min <= range.max) {
      const pad = (range.max - range.min) * 0.05 || Math.max(Math.abs(range.min) * 0.05, 1);
      plot.setScale('y', { min: range.min - pad, max: range.max + pad });
    }
  });
  return <div ref={ref} className="numeric-plot" aria-label={`${panel.label} numeric plot`} />;
}

function StateTimeline({ samples, panel }: { samples: Sample[]; panel: Panel }) {
  const mapping = panel.settings.enum_labels ?? {};
  const end = samples.at(-1)?.t ?? 1;
  const start = Math.max(0, end - (panel.settings.window_seconds ?? 30) * 1000);
  const changes = samples.filter((sample, i) => i === 0 || sample.value !== samples[i - 1].value);
  const value = samples.at(-1)?.value;
  const label =
    value === undefined
      ? 'Waiting for a value'
      : (own(mapping, String(value)) ?? `Unmapped: ${String(value)}`);
  return (
    <div className="state-view">
      <strong>{label}</strong>
      <svg viewBox="0 0 1000 70" role="img" aria-label={`${panel.label} state timeline`}>
        {changes.map((sample, i) => {
          const x = Math.max(0, ((sample.t - start) / Math.max(1, end - start)) * 1000);
          const next = changes[i + 1]?.t ?? end;
          const width = Math.max(
            2,
            ((next - Math.max(start, sample.t)) / Math.max(1, end - start)) * 1000,
          );
          const known = Object.hasOwn(mapping, String(sample.value));
          const index = Object.keys(mapping).indexOf(String(sample.value));
          return (
            <rect
              key={`${sample.t}:${i}`}
              x={x}
              y="10"
              width={width}
              height="40"
              fill={
                known
                  ? ['#1fd5f9', '#23de6b', '#ffb752', '#dc85ff'][Math.max(0, index) % 4]
                  : '#30302f'
              }
            >
              <title>
                {own(mapping, String(sample.value)) ?? `Unmapped: ${String(sample.value)}`}
              </title>
            </rect>
          );
        })}
      </svg>
      <p className="muted">Receive time · {panel.settings.window_seconds ?? 30}s window</p>
    </div>
  );
}

export function VisualizationView({
  id,
  panel,
  active,
}: {
  id: string;
  panel: Panel;
  active: boolean;
}) {
  const runtime = useRuntime();
  const isPlot = panel.visualization === 'plot';
  const view = useDataView(id, panel, active && !isPlot);
  const seriesViews = useSeriesViews(id, panel, active && isPlot);
  // A plot header reports its worst series so one stale topic is not hidden by a healthy one.
  const worst = seriesViews.find((v) =>
    ['stale', 'invalid', 'unsupported', 'excluded', 'unavailable'].includes(v.status),
  );
  const head = isPlot ? (worst ?? seriesViews[0] ?? view) : view;
  const publication = runtime
    .catalog()
    .find((pub) => pub.kind === panel.source.kind && pub.name === panel.source.track_name);
  const problem = compatibility(panel, publication?.available ? publication : undefined);
  if (panel.source.kind !== 'data') {
    const usable = publication?.available && !publication.excluded && runtime.discovery === 'ready';
    const status = publication?.excluded
      ? 'excluded'
      : problem
        ? 'unsupported'
        : usable
          ? panel.source.kind === 'video'
            ? runtime.cameras.status(
                publication.id,
                runtime.clock.now(),
                runtime.config!.default_video_rate_hz,
              )
            : 'unmonitored'
          : 'unavailable';
    return (
      <div className="workspace-view">
        <div className={`status status-${status}`}>{status}</div>
        {problem && <p>{problem}</p>}
        {!usable && (
          <p>
            {publication?.excluded
              ? 'Blocked by the robot’s current exclusions.'
              : 'Waiting for this exact publication.'}
          </p>
        )}
        {panel.visualization === 'audio' ? (
          <AudioView
            active={active}
            publication={usable ? publication : undefined}
            volume={panel.settings.volume ?? 0.8}
            muted={panel.settings.muted ?? false}
          />
        ) : (
          usable && (
            <ExtraVideo
              publication={publication}
              stereo={panel.settings.image_layout === 'stereo_sbs'}
              eye={panel.settings.eye}
            />
          )
        )}
      </div>
    );
  }
  const display = view.value;
  return (
    <div className="workspace-view" data-testid={`view-${id}`}>
      <div className="view-status">
        <span className="view-status-main">
          {head.status === 'unmonitored' ? (
            !isPlot && <UnmonitoredInfo reason={head.reason} />
          ) : (
            <span className={`status status-${head.status}`}>{head.status}</span>
          )}
        </span>
        <span>{head.observedRate.toFixed(1)} arrivals/s</span>
      </div>
      {head.reason && head.status !== 'unmonitored' && (
        <p className="view-reason">{head.reason}</p>
      )}
      {isPlot && (
        <>
          <ul className="series-legend" aria-label="Plotted data">
            {panelSeries(panel).map((item, index) => (
              <li key={`${item.track_name}:${index}`} title={item.track_name}>
                <i
                  style={{
                    background: SERIES_COLORS[index % SERIES_COLORS.length],
                  }}
                />
                {item.label}
                {seriesViews[index]?.status === 'unmonitored' ? (
                  <UnmonitoredInfo reason={seriesViews[index]?.reason} />
                ) : (
                  <span className={`status status-${seriesViews[index]?.status}`}>
                    {seriesViews[index]?.status}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <NumericPlot samples={seriesViews.map((v) => v.samples)} panel={panel} />
        </>
      )}
      {panel.visualization === 'value' && (
        <div className="numeric-value">
          {typeof display === 'number'
            ? display.toLocaleString(undefined, { maximumFractionDigits: 4 })
            : '—'}
        </div>
      )}
      {panel.visualization === 'boolean' && (
        <div className="boolean-value">
          <span
            className={`boolean-dot ${display === true ? 'is-true' : display === false ? 'is-false' : ''}`}
          />
          <strong>{display === true ? 'TRUE' : display === false ? 'FALSE' : 'UNKNOWN'}</strong>
        </div>
      )}
      {panel.visualization === 'state' && <StateTimeline samples={view.samples} panel={panel} />}
      {panel.visualization === 'joints' && (
        <table className="joint-table">
          <thead>
            <tr>
              <th>Exact joint name</th>
              <th>Position</th>
              <th>Velocity</th>
              <th>Effort</th>
            </tr>
          </thead>
          <tbody>
            {((display as NamedJoint[] | undefined) ?? []).map((joint) => (
              <tr key={joint.name}>
                <td>{joint.name}</td>
                <td>{joint.position?.toFixed(4) ?? '—'}</td>
                <td>{joint.velocity?.toFixed(4) ?? '—'}</td>
                <td>{joint.effort?.toFixed(4) ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {panel.visualization === 'raw' && (
        <pre className="raw-message">
          {display === undefined ? 'Waiting for usable JSON…' : JSON.stringify(display, null, 2)}
        </pre>
      )}
      <details className="view-diagnostics">
        <summary>Stream details</summary>
        <p>
          {panel.source.track_name} · {publication?.msgType ?? 'No schema ID'}
        </p>
        <p>
          {view.arrivals} transport arrivals · {view.decoded} decoded · {view.consumers} consumers
        </p>
        <p>{view.displays} displayed updates</p>
        <p>
          Usable sample:{' '}
          {view.at === undefined
            ? 'none in this session'
            : `${((runtime.clock.now() - view.at) / 1000).toFixed(1)}s ago`}
        </p>
        <p>
          Last values remain visible when stale. Receive freshness does not indicate equipment
          readiness.
        </p>
      </details>
    </div>
  );
}

/** Orange "i" icon: the reason shows only while the pointer or keyboard focus is on it. */
function UnmonitoredInfo({ reason }: { reason?: string }) {
  if (!reason) return null;
  return (
    <span className="view-info" tabIndex={0} aria-label={reason}>
      i<span className="view-info-tip" role="tooltip">{reason}</span>
    </span>
  );
}
