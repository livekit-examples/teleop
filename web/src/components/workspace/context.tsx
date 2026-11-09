'use client';

import { createContext, useContext, useEffect, useSyncExternalStore } from 'react';
import { panelSeries, panelSelector, seriesSelector } from '@/lib/teleop/selectors';
import type { StreamView } from '@/lib/teleop/streams';
import type { WorkspaceRuntime } from '@/lib/teleop/runtime';
import type { Panel } from '@/lib/teleop/types';

export const RuntimeContext = createContext<WorkspaceRuntime | null>(null);
export function useRuntime() {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error('Workspace runtime is missing.');
  useSyncExternalStore(runtime.subscribe, runtime.snapshot, runtime.snapshot);
  return runtime;
}
export function useDataView(id: string, panel: Panel, active: boolean) {
  const runtime = useRuntime();
  const signature = JSON.stringify(panel);
  useEffect(() => {
    if (!active || panel.source.kind !== 'data') return;
    return runtime.streams.acquire(`panel:${id}`, {
      robot: runtime.selected,
      cacheKey: panel.visualization,
      source: panel.source,
      select: panelSelector(panel),
      rate: panel.settings.expected_rate_hz,
      windowSeconds: panel.settings.window_seconds,
    });
    // signature is the complete validated, serializable panel spec.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, id, signature, active]);
  const view = runtime.streams.view(`panel:${id}`);
  useEffect(() => {
    if (active && view.at !== undefined) runtime.streams.display(`panel:${id}`, view.at);
  }, [runtime, id, active, view.at]);
  return view;
}

/** One stream consumer per plot series, so each topic subscribes on its own. */
export function useSeriesViews(id: string, panel: Panel, active: boolean): StreamView[] {
  const runtime = useRuntime();
  const signature = JSON.stringify([panel.series, panel.source, panel.settings]);
  const series = panelSeries(panel);
  useEffect(() => {
    if (!active) return;
    const releases = series.map((item, index) =>
      runtime.streams.acquire(`panel:${id}:s${index}`, {
        robot: runtime.selected,
        cacheKey: panel.visualization,
        source: {
          kind: 'data',
          track_name: item.track_name,
          field_path: item.field_path,
          ...(item.expected_msg_type ? { expected_msg_type: item.expected_msg_type } : {}),
        },
        select: seriesSelector(panel, index),
        rate: item.expected_rate_hz,
        windowSeconds: panel.settings.window_seconds,
      }),
    );
    return () => releases.forEach((release) => release());
    // signature is the complete validated, serializable panel spec.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, id, signature, active]);
  const views = series.map((_, index) => runtime.streams.view(`panel:${id}:s${index}`));
  useEffect(() => {
    if (!active) return;
    views.forEach((view, index) => {
      if (view.at !== undefined) runtime.streams.display(`panel:${id}:s${index}`, view.at);
    });
  });
  return views;
}
