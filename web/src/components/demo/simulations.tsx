'use client';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { LoaderCircle, Play, Square } from 'lucide-react';
import { demoRequest, type DemoRun, type DemoSimulation } from '@/lib/demo/types';
import { useDemoSession, useSeconds } from '@/lib/demo/use-session';
import { RuntimeContext } from '@/components/workspace/context';
import { Cameras, MediaProvider } from '@/components/workspace/media';
import './simulations.css';

const simulationCards = new Map([
  ['trossen-wxai', { name: 'wxai', photo: '/simulations/wxai.png' }],
  ['trossen-wxai-whack', { name: 'wxai whack', photo: '/simulations/wxai-whack.png' }],
  ['trossen-workbench', { name: 'workbench', photo: '/simulations/workbench.png' }],
  [
    'trossen-workbench-whack',
    { name: 'workbench whack', photo: '/simulations/workbench-whack.png' },
  ],
]);
const simulationName = (id: string) => simulationCards.get(id)?.name ?? id;

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
          <h3>{simulationName(run.simulation_id)}</h3>
          <p role="status">
            {run.state === 'queued'
              ? `Queued · position ${run.queue_position ?? '…'}${run.queue_length ? ` of ${run.queue_length}` : ''}`
              : run.state}
            {run.state !== 'queued' && seconds !== null && ` · ${seconds}s remaining`}
          </p>
        </div>
        {['queued', 'starting', 'ready'].includes(run.state) && (
          <button
            onClick={stop}
            aria-label={
              run.state === 'queued'
                ? `Leave queue for ${simulationName(run.simulation_id)}`
                : `Stop ${simulationName(run.simulation_id)}`
            }
          >
            <Square size={14} /> {run.state === 'queued' ? 'Leave queue' : 'Stop'}
          </button>
        )}
      </div>
      {run.state === 'queued' && (
        <p className="demo-queue-estimate">
          {run.estimated_wait_seconds == null
            ? 'Estimating your wait…'
            : `Estimated wait: about ${run.estimated_wait_seconds < 60 ? `${Math.max(5, Math.ceil(run.estimated_wait_seconds / 5) * 5)} seconds` : `${Math.ceil(run.estimated_wait_seconds / 60)} minutes`}.`}{' '}
          Updates automatically. Startup time and early stops can change this estimate.
        </p>
      )}
      {run.state === 'failed' && (
        <p className="demo-error">Simulation startup or execution failed. Try another launch.</p>
      )}
      {['expired', 'stopped'].includes(run.state) && (
        <p>Session complete. Choose a simulation to launch again.</p>
      )}
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
  const router = useRouter();
  const launched = useRef<string | null>(null);
  const requests = useRef(new Map<string, string>());
  const queueLog = useRef(new Map<string, string>());
  const [catalog, setCatalog] = useState<DemoSimulation[]>([]);
  const [runs, setRuns] = useState<DemoRun[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    try {
      launched.current = sessionStorage.getItem('teleop.pending-trial');
      const cached: DemoRun[] = JSON.parse(localStorage.getItem('teleop.active-trials') ?? '[]');
      if (Array.isArray(cached)) setRuns(cached.filter((run) => /^[a-f0-9]{32}$/.test(run.id)));
    } catch {
      /* Status polling works without browser storage. */
    }
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async (first = false) => {
      try {
        if (first) {
          const data = await demoRequest<{ enabled: boolean; simulations: DemoSimulation[] }>(
            'simulations',
            { signal: abort.signal },
          );
          if (!data.enabled) {
            setEnabled(true);
            setError('Simulation trials are not configured. The direct workspace is available.');
            return;
          }
          setEnabled(true);
          setCatalog(data.simulations);
        }
        const data = await demoRequest<DemoRun[]>('sessions', { signal: abort.signal });
        setRuns(data);
        try {
          localStorage.setItem(
            'teleop.active-trials',
            JSON.stringify(
              data.filter((run) => ['queued', 'starting', 'ready', 'stopping'].includes(run.state)),
            ),
          );
        } catch {
          /* Optional cache. */
        }
        for (const run of data) {
          if (run.state !== 'queued') continue;
          const progress = `${run.queue_position}:${Math.ceil((run.estimated_wait_seconds ?? 0) / 15)}`;
          if (queueLog.current.get(run.id) !== progress) {
            console.info(
              `session=${run.id} queued position=${run.queue_position} estimated_wait_seconds=${run.estimated_wait_seconds}`,
            );
            queueLog.current.set(run.id, progress);
          }
        }
        if (data.some((run) => run.id === launched.current && run.state === 'ready')) {
          const id = launched.current;
          launched.current = null;
          try {
            sessionStorage.removeItem('teleop.pending-trial');
          } catch {
            /* Optional cache. */
          }
          router.push(`/workspace?session=${id}`);
        }
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
  }, [router]);
  const start = async (simulation: DemoSimulation) => {
    setBusy(simulation.id);
    setError('');
    let requestId = requests.current.get(simulation.id);
    try {
      requestId ??= sessionStorage.getItem(`teleop.launch:${simulation.id}`) ?? undefined;
    } catch {
      /* Memory retry remains available. */
    }
    requestId ??= crypto.randomUUID();
    requests.current.set(simulation.id, requestId);
    try {
      sessionStorage.setItem(`teleop.launch:${simulation.id}`, requestId);
    } catch {
      /* Memory retry remains available. */
    }
    try {
      const run = await demoRequest<DemoRun>('sessions', {
        method: 'POST',
        body: JSON.stringify({ simulation_id: simulation.id, request_id: requestId }),
      });
      requests.current.delete(simulation.id);
      try {
        sessionStorage.removeItem(`teleop.launch:${simulation.id}`);
      } catch {
        /* Storage may be disabled. */
      }
      launched.current = run.id;
      try {
        sessionStorage.setItem('teleop.pending-trial', run.id);
      } catch {
        /* Optional cache. */
      }
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
      if (launched.current === next.id) {
        launched.current = null;
        try {
          sessionStorage.removeItem('teleop.pending-trial');
        } catch {
          /* Optional cache. */
        }
      }
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
          Launch a robot and take control. The workspace opens when it is ready.
          {catalog[0]?.duration_seconds
            ? ` Each new session lasts ${catalog[0].duration_seconds} seconds from ready.`
            : ''}
        </p>
      </div>
      {error && (
        <p className="demo-error" role="alert">
          {error}
        </p>
      )}
      <div className="demo-catalog">
        {catalog
          .filter((sim) => simulationCards.has(sim.id))
          .map((sim) => (
            <button
              className="demo-sim-card"
              key={sim.id}
              data-simulation-id={sim.id}
              disabled={
                !sim.available ||
                busy !== null ||
                runs.some((r) => ['queued', 'starting', 'ready', 'stopping'].includes(r.state))
              }
              onClick={() => void start(sim)}
              title={sim.reason || sim.summary}
            >
              <span className="demo-sim-photo">
                <Image
                  src={simulationCards.get(sim.id)!.photo}
                  alt=""
                  loading={sim.id === 'trossen-wxai' ? 'eager' : 'lazy'}
                  fill
                  sizes="(max-width: 600px) 100vw, (max-width: 1000px) 50vw, 280px"
                />
                {busy === sim.id && (
                  <span className="demo-sim-loading" aria-label="Launching simulation">
                    <LoaderCircle className="animate-spin" size={28} />
                  </span>
                )}
              </span>
              <strong>{simulationName(sim.id)}</strong>
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
