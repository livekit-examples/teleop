'use client';
import { useEffect, useState } from 'react';
import { LiveKitTransport } from '@/lib/teleop/livekit-transport';
import { WorkspaceRuntime } from '@/lib/teleop/runtime';
import { browserClock } from '@/lib/teleop/types';
import { demoRequest, type DemoCredentials, type DemoRun } from './types';
import { simulationAdapters } from './trajectory-adapter';

/** One connection owner for both landing previews and managed workspace sessions. */
export function useDemoSession(id: string | null, mode: 'preview' | 'control') {
  const [runtime, setRuntime] = useState<WorkspaceRuntime | null>(null);
  const [error, setError] = useState('');
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [ended, setEnded] = useState(false);
  useEffect(() => {
    if (!id) return;
    if (!/^[a-f0-9]{32}$/.test(id)) {
      setError('Invalid simulation session.');
      setEnded(true);
      return;
    }
    const abort = new AbortController();
    let current: WorkspaceRuntime | undefined;
    let disposal: Promise<void> | undefined;
    const dispose = () => (disposal ??= current?.dispose());
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setTimeout> | undefined;
    let deadline = 0;
    setRuntime(null);
    setError('');
    setEnded(false);
    setExpiresAt(null);
    const finish = (message = '') => {
      if (disposed) return;
      disposed = true;
      abort.abort();
      clearTimeout(timer);
      clearTimeout(poll);
      if (current) {
        // stopAll disarms synchronously before it waits for transport flushing.
        void current.controls.stopAll();
        void dispose();
      }
      setRuntime(null);
      setEnded(true);
      setError(message);
    };
    const deadlineCheck = () => {
      if (deadline && Date.now() >= deadline) finish();
    };
    document.addEventListener('visibilitychange', deadlineCheck);
    window.addEventListener('focus', deadlineCheck);
    const status = async () => {
      try {
        const run = await demoRequest<DemoRun>(`sessions/${id}`, { signal: abort.signal });
        if (!['ready', 'starting'].includes(run.state)) {
          finish(
            run.state === 'failed' || run.reason
              ? run.reason || 'Simulation execution failed.'
              : '',
          );
          return;
        }
      } catch {
        /* The local deadline still applies during a service outage. */
      }
      if (!disposed) poll = setTimeout(() => void status(), 1000);
    };
    void (async () => {
      try {
        const run = await demoRequest<DemoRun>(`sessions/${id}`, { signal: abort.signal });
        if (!['queued', 'starting', 'ready'].includes(run.state)) {
          finish(
            run.state === 'failed' || run.reason
              ? run.reason || 'Simulation execution failed.'
              : '',
          );
          return;
        }
        const simulationId = run.simulation_id;
        const credentials = await demoRequest<DemoCredentials>(`sessions/${id}/credentials`, {
          method: 'POST',
          body: JSON.stringify({ mode }),
          signal: abort.signal,
        });
        if (disposed) return;
        deadline = credentials.expires_at;
        setExpiresAt(deadline);
        if (Date.now() >= deadline) {
          finish();
          return;
        }
        timer = setTimeout(() => finish(), deadline - Date.now());
        if (mode === 'control' && !credentials.policy)
          throw new Error('Simulation control policy is missing.');
        const adapters = mode === 'control' ? simulationAdapters(credentials.policy!) : undefined;
        let storage: Storage | undefined;
        try {
          if (mode === 'control') storage = window.localStorage;
        } catch {
          /* In-memory layouts remain usable. */
        }
        const transport = new LiveKitTransport(mode === 'preview' ? 'observer' : 'operator');
        current = new WorkspaceRuntime(
          transport,
          storage,
          browserClock,
          adapters,
          mode === 'preview',
        );
        current.selected = credentials.robot_identity;
        current.simulationId = simulationId;
        current.start();
        await transport.connect(credentials.server_url, credentials.token);
        if (disposed) {
          await dispose();
          return;
        }
        setRuntime(current);
        void status();
      } catch (error) {
        if (!disposed) finish((error as Error).message);
      }
    })();
    return () => {
      disposed = true;
      abort.abort();
      clearTimeout(timer);
      clearTimeout(poll);
      document.removeEventListener('visibilitychange', deadlineCheck);
      window.removeEventListener('focus', deadlineCheck);
      if (current) void dispose();
    };
  }, [id, mode]);
  return { runtime, error, expiresAt, ended };
}

export function useSeconds(expiresAt?: number | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, []);
  return expiresAt ? Math.max(0, Math.ceil((expiresAt - now) / 1000)) : null;
}
