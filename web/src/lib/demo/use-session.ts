'use client';
import { useEffect, useRef, useState } from 'react';
import { WorkspaceRuntime } from '@/lib/teleop/runtime';
import { browserClock } from '@/lib/teleop/types';
import { acquireSharedRoom } from './shared-room';
import { demoRequest, type ControlQueueState, type DemoRun, type SharedCredentials } from './types';
import { simulationAdapters } from './trajectory-adapter';

export function useDemoSession(id: string | null, mode: 'preview' | 'control') {
  const [runtime, setRuntime] = useState<WorkspaceRuntime | null>(null);
  const [queue, setQueue] = useState<(ControlQueueState & { clockOffset?: number }) | null>(null);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [ended, setEnded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const action = useRef<(name: string) => Promise<void>>(async () => {});
  const engage = useRef<(force?: boolean) => Promise<void>>(async () => {});

  useEffect(() => {
    if (!id) return;
    if (!/^[a-f0-9]{32}$/.test(id)) {
      setError('Invalid simulation instance.');
      return;
    }
    const abort = new AbortController();
    let disposed = false;
    let current: WorkspaceRuntime | undefined;
    let shared: Awaited<ReturnType<typeof acquireSharedRoom>> | undefined;
    let off: (() => void) | undefined;
    let poll: ReturnType<typeof setTimeout> | undefined;
    let clock: ReturnType<typeof setInterval> | undefined;
    let deadline = 0;
    let offset = 0;
    let proof = '';
    let run: DemoRun;
    let controlling = false;
    let lastActivity = 0;
    let hadStake = false;
    let disposal: Promise<void> | undefined;
    const dispose = () =>
      (disposal ??= (async () => {
        off?.();
        if (current) await current.dispose();
        shared?.release();
      })());
    setRuntime(null);
    setQueue(null);
    setError('');
    setActionError('');
    setEnded(false);
    const finish = (message = '') => {
      if (disposed) return;
      disposed = true;
      abort.abort();
      clearTimeout(poll);
      clearInterval(clock);
      void dispose();
      setRuntime(null);
      setError(message);
      setEnded(true);
    };
    const signed = (value: string) => ({ 'X-Sim-Proof': value });
    const updateDeadline = (until: number) => {
      deadline = until - offset;
      setExpiresAt(deadline);
    };
    const fromRoom = () => {
      if (!shared || !current || disposed) return;
      const me = shared.transport.room.localParticipant;
      const peers = [me, ...shared.transport.room.remoteParticipants.values()];
      const robot = run.robot_identity!;
      const waiting = peers
        .filter((p) => p.attributes['vla_demo.queue_robot'] === robot)
        .sort(
          (a, b) =>
            Number(a.attributes['vla_demo.queue_ts']) - Number(b.attributes['vla_demo.queue_ts']) ||
            a.identity.localeCompare(b.identity),
        );
      const holder = peers
        .filter(
          (p) =>
            p.attributes['vla_demo.control_robot'] === robot &&
            Number(p.attributes['vla_demo.control_until']) > Date.now() + offset,
        )
        .sort(
          (a, b) =>
            Number(a.attributes['vla_demo.control_until']) -
            Number(b.attributes['vla_demo.control_until']),
        )[0];
      const position = waiting.findIndex((p) => p.identity === me.identity);
      const mine =
        mode === 'control' &&
        shared.transport.canControl(robot) &&
        me.attributes['teleop.sim.generation'] === id;
      if (mine !== controlling) {
        controlling = mine;
        void current.setControlAdapters(
          mine && run.policy ? simulationAdapters(run.policy) : undefined,
        );
      }
      try {
        const values = JSON.parse(me.attributes['teleop.sim.activity'] ?? '{}');
        if (values[id!]) updateDeadline(values[id!].at + (run.idle_seconds ?? 120) * 1000);
      } catch {
        /* The last confirmed deadline remains active. */
      }
      const remaining = holder
        ? Math.max(0, Number(holder.attributes['vla_demo.control_until']) - Date.now() - offset) /
          1000
        : 0;
      setQueue((previous) => ({
        instance_id: id!,
        robot_identity: robot,
        controller: holder
          ? {
              identity: holder.identity,
              until: Number(holder.attributes['vla_demo.control_until']),
            }
          : null,
        queue: waiting.map((p) => p.identity),
        turn_seconds: run.turn_seconds ?? 60,
        queue_position: position >= 0 ? position + 1 : null,
        estimated_wait_seconds:
          position >= 0 ? Math.ceil(remaining + position * (run.turn_seconds ?? 60)) : null,
        queued_at: position >= 0 ? Number(me.attributes['vla_demo.queue_ts']) : null,
        server_time: Date.now() + offset,
        clockOffset: offset,
        engaged_until: deadline ? deadline + offset : null,
        viewer_count: previous?.viewer_count ?? 1,
      }));
    };
    const refresh = async () => {
      try {
        const state = await demoRequest<ControlQueueState>('queue?instance=' + id, {
          headers: signed(proof),
          signal: abort.signal,
        });
        if (disposed) return;
        offset = state.server_time - Date.now();
        if (state.proof) proof = state.proof;
        shared!.transport.serverTimeOffset = offset;
        if (state.engaged_until) updateDeadline(state.engaged_until);
        setQueue({ ...state, clockOffset: offset });
        fromRoom();
      } catch (problem) {
        if (!disposed) {
          const state = await demoRequest<DemoRun>('instances/' + id, {
            signal: abort.signal,
          }).catch(() => null);
          if (state && !['starting', 'ready'].includes(state.state)) {
            finish(state.reason ?? 'Simulation paused due to inactivity.');
            return;
          }
          setActionError((problem as Error).message);
        }
      }
      if (!disposed) poll = setTimeout(() => void refresh(), document.hidden ? 15000 : 5000);
    };

    void (async () => {
      try {
        run = await demoRequest<DemoRun>('instances/' + id, { signal: abort.signal });
        while (!disposed && ['queued', 'starting'].includes(run.state)) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          run = await demoRequest<DemoRun>('instances/' + id, { signal: abort.signal });
        }
        if (disposed) return;
        if (run.state !== 'ready') {
          finish(run.reason ?? 'This simulation stopped. Choose Watch to restart it.');
          return;
        }
        shared = await acquireSharedRoom();
        if (disposed) {
          shared.release();
          return;
        }
        const credentials = await demoRequest<SharedCredentials>(
          'instances/' + id + '/credentials',
          {
            method: 'POST',
            headers: signed(shared.credentials.proof),
            body: JSON.stringify({ event_id: crypto.randomUUID() }),
            signal: abort.signal,
          },
        );
        proof = credentials.proof;
        if (credentials.discovery)
          shared.transport.managedDiscovery.set(
            run.robot_identity!,
            JSON.stringify(credentials.discovery),
          );
        updateDeadline(credentials.engaged_until);
        let storage: Storage | undefined;
        try {
          storage = window.localStorage;
        } catch {
          /* Layouts can stay in memory. */
        }
        current = new WorkspaceRuntime(shared.transport, storage, browserClock, new Map(), true);
        current.selected = run.robot_identity!;
        current.simulationId = run.simulation_id;
        current.connection = 'connected';
        current.start();
        await current.select(run.robot_identity!, true);
        if (disposed) {
          await dispose();
          return;
        }
        setRuntime(current);
        off = shared.transport.onEvent((event) => {
          if (event === 'interrupted') {
            const me = shared!.transport.room.localParticipant;
            hadStake =
              hadStake ||
              controlling ||
              me.attributes['vla_demo.queue_robot'] === run.robot_identity;
          }
          if (event === 'connected' && Date.now() < deadline) {
            const me = shared!.transport.room.localParticipant;
            if (!me.attributes['teleop.sim.activity'])
              void (async () => {
                try {
                  const restored = await demoRequest<SharedCredentials>(
                    'instances/' + id + '/credentials',
                    {
                      method: 'POST',
                      headers: signed(proof),
                      body: JSON.stringify({ resume: true }),
                      signal: abort.signal,
                    },
                  );
                  proof = restored.proof;
                  if (hadStake)
                    await demoRequest('queue', {
                      method: 'POST',
                      headers: signed(proof),
                      body: JSON.stringify({ instance_id: id, action: 'join', resume: true }),
                      signal: abort.signal,
                    });
                  hadStake = false;
                  fromRoom();
                } catch {
                  if (!disposed) finish('Continue watching to reconnect.');
                }
              })();
          }
          fromRoom();
        });
        fromRoom();
        action.current = async (name) => {
          try {
            const state = await demoRequest<ControlQueueState>('queue', {
              method: 'POST',
              headers: signed(proof),
              body: JSON.stringify({ instance_id: id, action: name }),
              signal: abort.signal,
            });
            if (state.proof) proof = state.proof;
            setActionError('');
            fromRoom();
          } catch (problem) {
            if (!disposed) setActionError((problem as Error).message);
          }
        };
        engage.current = async (force = false) => {
          if (disposed || (!force && Date.now() - lastActivity < 1000)) return;
          lastActivity = Date.now();
          try {
            const result = await demoRequest<{
              engaged_until: number;
              server_time: number;
              proof: string;
            }>('engagement', {
              method: 'POST',
              headers: signed(proof),
              signal: abort.signal,
              body: JSON.stringify({ instance_id: id, event_id: crypto.randomUUID() }),
            });
            if (!disposed) {
              proof = result.proof;
              offset = result.server_time - Date.now();
              updateDeadline(result.engaged_until);
              setActionError('');
            }
          } catch (problem) {
            if (!disposed) setActionError((problem as Error).message);
          }
        };
        clock = setInterval(() => {
          fromRoom();
          if (deadline && Date.now() >= deadline)
            finish('Your viewing time expired. Continue watching to return.');
        }, 200);
        void refresh();
      } catch (problem) {
        if (!disposed) finish((problem as Error).message);
      }
    })();
    return () => {
      disposed = true;
      abort.abort();
      clearTimeout(poll);
      clearInterval(clock);
      action.current = async () => {};
      engage.current = async () => {};
      void dispose();
    };
  }, [id, mode, attempt]);
  return {
    runtime,
    queue,
    error,
    actionError,
    expiresAt,
    ended,
    queueAction: (name: 'join' | 'leave' | 'release') => action.current(name),
    keepWatching: () => engage.current(true),
    interact: (event: { isTrusted: boolean }) => {
      if (event.isTrusted) void engage.current();
    },
    retry: async () => {
      try {
        const run = await demoRequest<DemoRun>('instances/' + id);
        if (['stopped', 'expired', 'failed', 'stopping'].includes(run.state)) {
          const next = await demoRequest<DemoRun>('simulations/' + run.simulation_id + '/watch', {
            method: 'POST',
            body: '{}',
          });
          if (next.state === 'stopping') {
            setError('Cleanup is in progress. Continue watching again shortly.');
            return;
          }
          window.location.assign('/workspace?session=' + next.id);
        } else setAttempt((value) => value + 1);
      } catch (problem) {
        setError((problem as Error).message);
      }
    },
  };
}

export function useSeconds(expiresAt?: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, []);
  return expiresAt ? Math.max(0, Math.ceil((expiresAt - now) / 1000)) : null;
}
