'use client';

import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import type { NamedJoint } from '@/lib/teleop/selectors';
import { compatibility } from '@/lib/teleop/selectors';
import { monitoringPolicy, type Sample } from '@/lib/teleop/streams';
import type { Panel } from '@/lib/teleop/types';
import { own } from '@/lib/teleop/types';
import { useDataView, useRuntime } from './context';
import { AudioView, ExtraVideo } from './media';

function NumericPlot({ samples, panel }: { samples: Sample[]; panel: Panel }) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<uPlot | null>(null);
  useEffect(() => {
    const host = ref.current!;
    const plot = new uPlot(
      {
        width: Math.max(200, host.clientWidth),
        height: Math.max(160, host.clientHeight),
        scales: { x: { time: false } },
        axes: [
          { label: 'Receive time (s)', stroke: '#999999', grid: { stroke: '#202020' } },
          { stroke: '#999999', grid: { stroke: '#202020' } },
        ],
        series: [{}, { label: panel.label, stroke: '#1fd5f9', width: 1.5, spanGaps: false }],
        cursor: { drag: { x: true, y: false } },
      },
      [[], []],
      host,
    );
    chart.current = plot;
    const observer = new ResizeObserver(() =>
      plot.setSize({
        width: Math.max(200, host.clientWidth),
        height: Math.max(160, host.clientHeight),
      }),
    );
    observer.observe(host);
    return () => {
      observer.disconnect();
      plot.destroy();
      chart.current = null;
    };
  }, [panel.label]);
  useEffect(() => {
    const x: number[] = [];
    const y: (number | null)[] = [];
    let previous: number | undefined;
    for (const sample of samples) {
      if (
        previous !== undefined &&
        panel.settings.expected_rate_hz &&
        sample.t - previous > monitoringPolicy.stale(panel.settings.expected_rate_hz)
      ) {
        x.push((previous + 1) / 1000);
        y.push(null);
      }
      x.push(sample.t / 1000);
      y.push(typeof sample.value === 'number' ? sample.value : null);
      previous = sample.t;
    }
    if (x.length) chart.current?.setData([x, y]);
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
  const view = useDataView(id, panel, active);
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
        <span className={`status status-${view.status}`}>{view.status}</span>
        <span>{view.observedRate.toFixed(1)} arrivals/s</span>
      </div>
      {view.reason && <p className="view-reason">{view.reason}</p>}
      {panel.visualization === 'plot' && <NumericPlot samples={view.samples} panel={panel} />}
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
