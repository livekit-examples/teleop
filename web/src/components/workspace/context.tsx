'use client';

import { createContext, useContext, useEffect, useSyncExternalStore } from 'react';
import { panelSelector } from '@/lib/teleop/selectors';
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
