'use client';
import Link from 'next/link';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Bot, Boxes, LoaderCircle, Play, Square } from 'lucide-react';
import { demoRequest, type DemoRun, type DemoSimulation } from '@/lib/demo/types';
import { useDemoSession, useSeconds } from '@/lib/demo/use-session';
import { RuntimeContext } from '@/components/workspace/context';
import { Cameras, MediaProvider } from '@/components/workspace/media';
import './simulations.css';

function Preview({ id }: { id: string }) {
  const { runtime, error, ended } = useDemoSession(id, 'preview');
  if (error || ended) return <p role="status">{error || 'Session ended'}</p>;
  if (!runtime) return <p role="status">Connecting preview…</p>;
  return (
    <RuntimeContext.Provider value={runtime}>
      <MediaProvider>
        <PreviewCameras runtime={runtime} />
      </MediaProvider>
    </RuntimeContext.Provider>
  );
}
function PreviewCameras({
  runtime,
}: {
  runtime: NonNullable<ReturnType<typeof useDemoSession>['runtime']>;
}) {
  useSyncExternalStore(runtime.subscribe, runtime.snapshot, runtime.snapshot);
  return runtime.discovery === 'ready' ? (
    <Cameras />
  ) : (
    <p role="status">{runtime.error || 'Discovering simulation…'}</p>
  );
}
function RunCard({
  run,
  preview,
  select,
  stop,
}: {
  run: DemoRun;
  preview: boolean;
  select(): void;
  stop(): void;
}) {
  const seconds = useSeconds(run.expires_at);
  const ready = run.state === 'ready' && (seconds ?? 0) > 0;
  return (
    <article className="demo-run" data-run-id={run.id}>
      <div className="demo-run-heading">
        <div>
          <h3>{run.simulation_id}</h3>
          <p role="status">
            {run.state} {seconds !== null && `· ${seconds}s remaining`}
          </p>
        </div>
        {['starting', 'ready'].includes(run.state) && (
          <button onClick={stop} aria-label={`Stop ${run.simulation_id}`}>
            <Square size={14} /> Stop
          </button>
        )}
      </div>
      {run.reason && <p className="demo-error">{run.reason}</p>}
      {ready && (
        <div className="demo-run-actions">
          <button onClick={select} aria-pressed={preview}>
            Preview
          </button>
          <Link
            className="demo-primary"
            onClick={() => {
              if (preview) select();
            }}
            href={`/workspace?session=${run.id}`}
          >
            <Play size={14} /> Open control
          </Link>
        </div>
      )}
      {preview && ready && (
        <div className="demo-preview">
          <Preview id={run.id} />
        </div>
      )}
    </article>
  );
}
export function Simulations() {
  const [catalog, setCatalog] = useState<DemoSimulation[]>([]);
  const [runs, setRuns] = useState<DemoRun[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async (first = false) => {
      try {
        if (first) {
          const data = await demoRequest<{ enabled: boolean; simulations: DemoSimulation[] }>(
            'simulations',
            { signal: abort.signal },
          );
          if (!data.enabled) return;
          setEnabled(true);
          setCatalog(data.simulations);
        }
        const data = await demoRequest<DemoRun[]>('sessions', { signal: abort.signal });
        setRuns(data);
      } catch (error) {
        if (!abort.signal.aborted) {
          setEnabled(true);
          setError((error as Error).message);
        }
      }
      if (!abort.signal.aborted) timer = setTimeout(() => void load(), 1000);
    };
    void load(true);
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, []);
  const start = async (simulation: DemoSimulation) => {
    setBusy(simulation.id);
    setError('');
    try {
      const run = await demoRequest<DemoRun>('sessions', {
        method: 'POST',
        body: JSON.stringify({ simulation_id: simulation.id, request_id: crypto.randomUUID() }),
      });
      setRuns((runs) => [run, ...runs.filter((r) => r.id !== run.id)]);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const stop = async (run: DemoRun) => {
    setError('');
    if (preview === run.id) setPreview(null);
    try {
      const next = await demoRequest<DemoRun>(`sessions/${run.id}`, { method: 'DELETE' });
      setRuns((runs) => runs.map((r) => (r.id === next.id ? next : r)));
    } catch (error) {
      setError((error as Error).message);
    }
  };
  if (!enabled) return null;
  return (
    <section className="demo-simulations" aria-labelledby="simulations-title">
      <div className="demo-section-heading">
        <span>NO HARDWARE REQUIRED</span>
        <h2 id="simulations-title">Try a simulation</h2>
        <p>
          Launch a robot, watch it live, and take control. Each session lasts 60 seconds from ready.
        </p>
      </div>
      {error && (
        <p className="demo-error" role="alert">
          {error}
        </p>
      )}
      <div className="demo-catalog">
        {catalog.map((sim) => (
          <button
            className="demo-sim-card"
            key={sim.id}
            disabled={!sim.available || busy !== null || runs.some((r) => r.state === 'starting')}
            onClick={() => void start(sim)}
            title={sim.reason || sim.summary}
          >
            {busy === sim.id ? (
              <LoaderCircle className="animate-spin" size={28} />
            ) : sim.icon === 'dual-arm' ? (
              <Boxes size={28} />
            ) : (
              <Bot size={28} />
            )}
            <strong>{sim.id}</strong>
            <span>{sim.summary}</span>
            <small>{sim.available ? 'Launch simulation →' : sim.reason}</small>
          </button>
        ))}
      </div>
      <div className="demo-section-heading demo-my-runs">
        <h2>My simulations</h2>
        <p>Preview a running session or open the teleop workspace.</p>
      </div>
      {runs.length === 0 ? (
        <p className="demo-empty">Your simulations will appear here.</p>
      ) : (
        <div className="demo-runs">
          {runs.map((run) => (
            <RunCard
              key={run.id}
              run={run}
              preview={preview === run.id}
              select={() => setPreview((id) => (id === run.id ? null : run.id))}
              stop={() => void stop(run)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
