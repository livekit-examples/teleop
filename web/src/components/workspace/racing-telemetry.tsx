'use client';
import { useEffect, useId } from 'react';
import { useRuntime } from './context';

/** The adapter supplies this optional display capability after policy validation. */
export function RacingTelemetry({ equipmentId, active }: { equipmentId: string; active: boolean }) {
  const runtime = useRuntime();
  const id = useId();
  const operation = runtime.controls.operation(equipmentId);
  const adapter = runtime.controls.adapter(equipmentId);
  const track = adapter?.telemetryTrack;
  const robot = runtime.selected;
  useEffect(() => {
    if (!active || !track || !robot) return;
    return runtime.streams.acquire(id, {
      robot,
      source: {
        kind: 'data',
        track_name: track,
        field_path: [],
        expected_msg_type: 'robo_sims/msg/VehicleStateV1',
      },
      rate: 20,
      select: (value) => value,
    });
  }, [runtime, id, robot, active, track]);
  if (!track || operation?.profile !== 'base.ackermann_drive.v1') return null;
  const view = runtime.streams.view(id);
  const raw = view.value;
  const state = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const number = (key: string, digits = 1) =>
    typeof state[key] === 'number' && Number.isFinite(state[key])
      ? state[key].toFixed(digits)
      : '—';
  const stale = view.at === undefined || runtime.clock.now() - view.at > 1000;
  return (
    <div role="status" aria-label="Race car telemetry">
      <p>
        <strong>{stale ? '—' : number('speed')} m/s</strong> · Lap {number('lap', 0)} ·{' '}
        {number('lap_seconds')} s
      </p>
      <p>
        Last valid lap: {number('last_lap_seconds')} s · Forward cap: {number('speed_limit')} m/s
      </p>
      {stale && <p>Waiting for fresh driving telemetry.</p>}
      {!stale && state.command_timed_out === true && (
        <p>Input timed out. Request control again, then arm the input.</p>
      )}
      {!stale && state.off_track === true && <p>Off track · reduced grip</p>}
      {!stale && state.collision === true && <p>Barrier contact</p>}
      {!stale && state.lap_valid === false && <p>Current lap invalid</p>}
      <p>
        Forward/back controls target speed. Neutral brakes and centers steering. Reverse brakes to
        rest first.
      </p>
    </div>
  );
}
