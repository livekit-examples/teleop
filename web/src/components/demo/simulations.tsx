'use client';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { demoRequest, type DemoRun, type DemoSimulation } from '@/lib/demo/types';
import { useDemoSession, useSeconds } from '@/lib/demo/use-session';
import { RuntimeContext } from '@/components/workspace/context';
import { Cameras, MediaProvider } from '@/components/workspace/media';
import './simulations.css';

const cards = [
  ['f1tenth', 'Formula RC', 'f1tenth'],
  ['vacuum', 'Vacuum robot', 'vacuum'],
  ['cluttered-table', 'Cluttered table', 'cluttered-table'],
  ['trossen-wxai', 'wxai', 'wxai'],
  ['trossen-wxai-whack', 'wxai whack', 'wxai-whack'],
  ['trossen-workbench', 'workbench', 'workbench'],
  ['trossen-workbench-whack', 'workbench whack', 'workbench-whack'],
];
type Session = ReturnType<typeof useDemoSession>;

export function QueueBanner({ session }: { session: Session }) {
  const { queue, runtime } = session;
  const seconds = useSeconds(session.expiresAt);
  const until = queue?.controller ? queue.controller.until - (queue.clockOffset ?? 0) : null;
  const turn = useSeconds(until);
  const mine = queue?.controller?.identity === runtime?.transport.identity;
  return (
    <div className="demo-session-banner" aria-label="Simulation control queue">
      <span role="status">
        {mine
          ? 'Your turn · ' + turn + 's remaining'
          : queue?.queue_position
            ? 'Queue position ' +
              queue.queue_position +
              ' · estimated wait about ' +
              queue.estimated_wait_seconds +
              's' +
              (queue.queued_at
                ? ' · waited ' +
                  Math.max(0, Math.floor((queue.server_time - queue.queued_at) / 1000)) +
                  's'
                : '')
            : queue?.controller
              ? 'Watching · another visitor controls this simulation'
              : 'Watching · control available'}
        {queue ? ' · ' + queue.viewer_count + ' viewing' : ''}
      </span>
      {mine ? (
        <button onClick={() => void session.queueAction('release')}>Release control</button>
      ) : queue?.queue_position ? (
        <button onClick={() => void session.queueAction('leave')}>Leave queue</button>
      ) : (
        <button onClick={() => void session.queueAction('join')}>Join control queue</button>
      )}
      {seconds !== null && seconds <= 20 && (
        <span role="alert">
          {' '}
          Still watching? {seconds}s until viewing expires.
          <button onClick={() => void session.keepWatching()}>Keep watching</button>
        </span>
      )}
      {session.actionError && (
        <span role="alert" className="demo-error">
          {session.actionError}
        </span>
      )}
    </div>
  );
}

function Preview({ id }: { id: string }) {
  const session = useDemoSession(id, 'preview');
  const seconds = useSeconds(session.expiresAt);
  if (session.error || session.ended)
    return (
      <div role="status">
        <p>{session.error || 'Viewing ended'}</p>
        {session.canContinue && <button onClick={session.retry}>Continue watching</button>}
      </div>
    );
  if (!session.runtime) return <p role="status">Connecting preview…</p>;
  return (
    <div
      role="group"
      aria-label="Simulation preview"
      onPointerDown={(event) => session.interact(event.nativeEvent)}
      onKeyDown={(event) => session.interact(event.nativeEvent)}
    >
      <RuntimeContext.Provider value={session.runtime}>
        <MediaProvider>
          <PreviewCameras runtime={session.runtime} />
        </MediaProvider>
      </RuntimeContext.Provider>
      {seconds !== null && seconds <= 20 && (
        <p role="alert">Still watching? {seconds}s until viewing expires.</p>
      )}
      <button onClick={() => void session.keepWatching()}>Keep watching</button>
    </div>
  );
}
function PreviewCameras({ runtime }: { runtime: NonNullable<Session['runtime']> }) {
  useSyncExternalStore(runtime.subscribe, runtime.snapshot, runtime.snapshot);
  return runtime.discovery === 'ready' ? (
    <Cameras />
  ) : (
    <p role="status">{runtime.error || 'Discovering simulation…'}</p>
  );
}

export function Simulations({ publicDeployment = false }: { publicDeployment?: boolean }) {
  const router = useRouter();
  const [catalog, setCatalog] = useState<DemoSimulation[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const data = await demoRequest<{ enabled: boolean; simulations: DemoSimulation[] }>(
          'simulations',
          { signal: abort.signal },
        );
        if (!abort.signal.aborted) {
          setCatalog(data.simulations);
          setError(data.enabled ? '' : 'Simulation trials are not configured.');
        }
      } catch (problem) {
        if (!abort.signal.aborted) setError((problem as Error).message);
      }
      if (!abort.signal.aborted)
        timer = setTimeout(() => void load(), document.hidden ? 30000 : 10000);
    };
    void load();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, []);
  const watching = useRef<AbortController | null>(null);
  useEffect(() => () => watching.current?.abort(), []);
  // The full teleop page for a robot that is running.
  const teleopHref = (run: DemoRun) =>
    publicDeployment
      ? '/workspace?session=' + run.id
      : '/?robot=' + encodeURIComponent(run.robot_identity ?? '');
  const watch = async (simulation: DemoSimulation) => {
    watching.current?.abort();
    const abort = new AbortController();
    watching.current = abort;
    setBusy(simulation.id);
    setError('');
    try {
      let run = simulation.instance;
      // Start the simulation only when no usable instance exists.
      if (!run || !['queued', 'starting', 'ready'].includes(run.state))
        run = await demoRequest<DemoRun>('simulations/' + simulation.id + '/watch', {
          method: 'POST',
          body: '{}',
          signal: abort.signal,
        });
      // The managed page waits for the instance by itself.
      while (!publicDeployment && !abort.signal.aborted) {
        if (run.state === 'ready' && run.robot_identity) break;
        if (!['queued', 'starting', 'ready'].includes(run.state))
          throw new Error(run.reason ?? 'The simulation stopped before it was ready.');
        await new Promise((resolve) => setTimeout(resolve, 1000));
        run = await demoRequest<DemoRun>('instances/' + run.id, { signal: abort.signal });
      }
      if (!abort.signal.aborted) router.push(teleopHref(run));
    } catch (problem) {
      if (!abort.signal.aborted) setError((problem as Error).message);
    } finally {
      if (watching.current === abort) {
        watching.current = null;
        setBusy(null);
      }
    }
  };
  return (
    <section className="demo-simulations" aria-labelledby="simulations-title">
      <div className="demo-section-heading">
        <span>NO HARDWARE REQUIRED</span>
        <h2 id="simulations-title">Try a simulation</h2>
        <p>Watch a shared robot or join its control queue. Each simulation has its own queue.</p>
        <p>
          Turns last {catalog?.[0]?.turn_seconds ?? 60} seconds. Viewers can keep a simulation
          running with Keep watching.

          If a simulation is not already running, it will start on demand.
        </p>
      </div>
      {error && (
        <p className="demo-error" role="alert">
          {error}
        </p>
      )}
      <div className="demo-catalog">
        {cards.map(([id, name, photo]) => {
          const simulation = catalog?.find((item) => item.id === id);
          if (catalog && !simulation) return null;
          const run = simulation?.instance;
          return (
            <article
              className="demo-sim-card demo-run"
              key={id}
              data-simulation-id={id}
              data-run-id={run?.id}
            >
              <button
                type="button"
                className="demo-sim-photo"
                aria-label={'Operate ' + name}
                aria-busy={busy === id}
                disabled={!simulation?.available || busy === id}
                onClick={() => {
                  if (simulation) void watch(simulation);
                }}
              >
                <Image src={'/simulations/' + photo + '.png'} alt="" fill sizes="300px" />
                {busy === id && (
                  <span className="demo-sim-loading" role="status">
                    {run?.state === 'ready' ? 'Opening…' : 'Starting…'}
                  </span>
                )}
              </button>
              <h3>{name}</h3>
              {simulation && <p>{simulation.summary}</p>}
              {(run?.reason || run?.state || !simulation) && (
                <p role="status">
                  {simulation
                    ? (run?.reason ?? run?.state)
                    : error
                      ? 'Status unavailable'
                      : 'Checking availability…'}
                </p>
              )}
              {run?.state === 'ready' && (
                <p>
                  {run.viewer_count ?? 0} viewing · {run.queue_length ?? 0} in control queue
                </p>
              )}
              {simulation && !simulation.available && <p>{simulation.reason}</p>}
              {run?.state === 'ready' && (
                <>
                  <button
                    aria-pressed={previews.has(run.id)}
                    onClick={() =>
                      setPreviews((previous) => {
                        const next = new Set(previous);
                        if (next.has(run.id)) next.delete(run.id);
                        else next.add(run.id);
                        return next;
                      })
                    }
                  >
                    Preview
                  </button>
                  <Link href={teleopHref(run)}>Open teleop</Link>
                </>
              )}
            </article>
          );
        })}
      </div>
      {[...previews].map((id) => (
        <div className="demo-preview" key={id}>
          <Preview id={id} />
        </div>
      ))}
    </section>
  );
}
