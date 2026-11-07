'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { FixtureTransport } from '@/lib/teleop/fixture-transport';
import { LiveKitTransport } from '@/lib/teleop/livekit-transport';
import { WorkspaceRuntime } from '@/lib/teleop/runtime';
import { compatibleRobot, type Panel } from '@/lib/teleop/types';
import { RuntimeContext } from './context';
import { MediaProvider } from './media';
import { WorkspaceHost, updatePanel } from './workspace-host';
import { AddVisualization } from './add-visualization';

function ConnectedWorkspace({
  runtime,
  disconnect,
}: {
  runtime: WorkspaceRuntime;
  disconnect(): void;
}) {
  useSyncExternalStore(runtime.subscribe, runtime.snapshot, runtime.snapshot);
  const [editing, setEditing] = useState<string | undefined>(undefined);
  const [error, setError] = useState('');
  const importRef = useRef<HTMLInputElement>(null);
  const close = useCallback(() => setEditing(undefined), []);
  const edit = (id: string) => {
    void runtime.controls.stopAll();
    setEditing(id);
  };
  const exported = () => {
    if (!runtime.layoutStore) return;
    const url = URL.createObjectURL(
      new Blob([runtime.layoutStore.export()], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `teleop-layout-${runtime.selected.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const fixture = runtime.transport instanceof FixtureTransport ? runtime.transport : undefined;
  const examples = () => {
    const examples: Panel[] = [
      {
        label: 'Yaw rate',
        visualization: 'plot',
        visible: true,
        source: { kind: 'data', track_name: '/imu', field_path: ['angular_velocity', 'z'] },
        settings: { window_seconds: 30, expected_rate_hz: 10 },
      },
      {
        label: 'System enabled',
        visualization: 'boolean',
        visible: true,
        source: { kind: 'data', track_name: '/enabled', field_path: ['data'] },
        settings: {},
      },
      {
        label: 'Operating state',
        visualization: 'state',
        visible: true,
        source: { kind: 'data', track_name: '/state', field_path: ['data'] },
        settings: {
          window_seconds: 30,
          enum_labels: { '0': 'Idle', '1': 'Working', '2': 'Waiting' },
        },
      },
    ];
    examples.forEach((panel, i) => updatePanel(runtime, `example_${i + 1}`, panel));
  };
  return (
    <RuntimeContext.Provider value={runtime}>
      <MediaProvider>
        <main className="workspace-app">
          <header className="workspace-topbar">
            <Link className="workspace-brand" href="/">
              ◈ <span>TELEOP</span>
              <small>WORKSPACE</small>
            </Link>
            <label className="robot-selector">
              <span>Robot</span>
              <select
                aria-label="Robot"
                value={runtime.selected}
                onChange={(event) => {
                  close();
                  void runtime.select(event.target.value);
                }}
              >
                <option value="">Select a robot</option>
                {runtime.robots().map((robot) => (
                  <option key={robot.identity} value={robot.identity}>
                    {robot.name ?? robot.identity}
                    {!compatibleRobot(robot) ? ' (incompatible protocol)' : ''}
                  </option>
                ))}
                {runtime.selected &&
                  !runtime.robots().some((r) => r.identity === runtime.selected) && (
                    <option value={runtime.selected}>{runtime.selected} (offline)</option>
                  )}
              </select>
            </label>
            <span className={`connection-badge ${runtime.discovery === 'ready' ? 'online' : ''}`}>
              ● {runtime.connection} · {runtime.discovery}
            </span>
            <div className="workspace-top-actions">
              <button
                className="primary"
                disabled={runtime.discovery !== 'ready'}
                onClick={() => edit('new')}
              >
                ＋ Add visualization
              </button>
              <button disabled={!runtime.layout} onClick={exported}>
                Export layout
              </button>
              <button disabled={!runtime.layout} onClick={() => importRef.current?.click()}>
                Import layout
              </button>
              <button
                disabled={!runtime.layout}
                onClick={() => {
                  close();
                  void runtime.resetLayout();
                }}
              >
                Reset layout
              </button>
              <button onClick={disconnect}>Disconnect</button>
            </div>
            <input
              hidden
              type="file"
              accept=".json,application/json"
              ref={importRef}
              aria-label="Import layout JSON"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                if (file.size > 2_000_000) {
                  setError('Layout file exceeds 2 MB.');
                  return;
                }
                void file
                  .text()
                  .then((text) => runtime.importLayout(text))
                  .then(() => {
                    setError('');
                    close();
                  })
                  .catch((e: Error) => setError(e.message));
              }}
            />
          </header>
          <div className="workspace-sessionbar">
            <span>{runtime.config?.label ?? 'Discover a robot to begin'}</span>
            <span className="layout-save" role="status">
              {runtime.layoutStore?.saveStatus ?? 'No layout selected'}
            </span>
            <div className="ownership">
              <span>
                {runtime.controls.owner
                  ? `Operator: ${runtime.controls.owner}`
                  : 'Viewing · no active operator'}
              </span>
              <button
                disabled={runtime.discovery !== 'ready' || runtime.controls.pending}
                onClick={() =>
                  void (
                    runtime.controls.ownsControl
                      ? runtime.controls.release()
                      : runtime.controls.request()
                  ).then(runtime.notify)
                }
              >
                {runtime.controls.pending
                  ? 'Requesting…'
                  : runtime.controls.ownsControl
                    ? 'Release control'
                    : 'Request control'}
              </button>
            </div>
          </div>
          {(runtime.error ||
            runtime.layoutStore?.error ||
            runtime.controls.ownershipError ||
            error) && (
            <div className="workspace-alert" role="alert">
              <span>
                {error ||
                  runtime.error ||
                  runtime.controls.ownershipError ||
                  runtime.layoutStore?.error}
              </span>
              {runtime.discovery === 'failed' && (
                <button onClick={() => void runtime.select(runtime.selected, true)}>
                  Retry discovery
                </button>
              )}
              {error && (
                <button aria-label="Dismiss import error" onClick={() => setError('')}>
                  ×
                </button>
              )}
            </div>
          )}
          {fixture && (
            <div className="fixture-toolbar">
              <strong>FIXTURE LAB</strong>
              <span>Generated media and commands; no hardware connected.</span>
              <button onClick={examples}>Load example panels</button>
              <button
                onClick={() =>
                  fixture.add({
                    id: '/new_sensor',
                    robot: 'fixture-rover',
                    kind: 'data',
                    name: '/new_sensor',
                    encoding: 'json',
                    msgType: 'sensor/Temperature',
                  })
                }
              >
                Publish new topic
              </button>
              <button
                onClick={() => {
                  const camera = runtime.cameras.main;
                  if (camera) fixture.remove(camera);
                }}
              >
                Remove main video
              </button>
              <button
                onClick={() => {
                  fixture.emit('interrupted');
                  setTimeout(() => fixture.emit('connected'), 500);
                }}
              >
                Reconnect
              </button>
              <span>{fixture.commands.length} command frames</span>
            </div>
          )}
          <div className="workspace-canvas">
            {runtime.layout ? (
              <WorkspaceHost key={`${runtime.selected}:${runtime.layoutRevision}`} onEdit={edit} />
            ) : (
              <div className="workspace-empty">
                <h2>Choose a compatible robot</h2>
                <p>
                  Robots advertise their Portal role and version. Viewing does not request control.
                </p>
              </div>
            )}
          </div>
          <footer className="workspace-footer">
            <span>
              {
                runtime.catalog().filter((p) => p.available && !p.excluded && p.kind === 'data')
                  .length
              }{' '}
              data topics · {runtime.cameras.cameras.size} live cameras
            </span>
            <span>Drag tabs to arrange · resize dividers · use Move for keyboard placement</span>
            <span>Layout stored in this browser</span>
          </footer>
          {editing && (
            <AddVisualization
              key={editing}
              initial={editing === 'new' ? undefined : runtime.layout?.panels[editing]}
              onClose={close}
              onSave={(panel) => {
                updatePanel(
                  runtime,
                  editing === 'new' ? `panel_${crypto.randomUUID().replaceAll('-', '')}` : editing,
                  panel,
                );
                close();
              }}
            />
          )}
        </main>
      </MediaProvider>
    </RuntimeContext.Provider>
  );
}

export function WorkspaceApp() {
  const [runtime, setRuntime] = useState<WorkspaceRuntime | null>(null);
  const current = useRef<WorkspaceRuntime | null>(null);
  const [url, setUrl] = useState(
    process.env.NEXT_PUBLIC_LIVEKIT_URL ??
      process.env.NEXT_PUBLIC_ROVER_LIVEKIT_URL ??
      process.env.NEXT_PUBLIC_ROBOT_LIVEKIT_URL ??
      '',
  );
  const [token, setToken] = useState(
    process.env.NEXT_PUBLIC_LIVEKIT_TOKEN ??
      process.env.NEXT_PUBLIC_ROVER_LIVEKIT_TOKEN ??
      process.env.NEXT_PUBLIC_ROBOT_LIVEKIT_TOKEN ??
      '',
  );
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const create = (transport: LiveKitTransport | FixtureTransport) => {
    let storage: Storage | undefined;
    try {
      storage = window.localStorage;
    } catch {
      /* In-memory editing and export remain available. */
    }
    const next = new WorkspaceRuntime(transport, storage);
    current.current = next;
    next.start();
    setRuntime(next);
    return next;
  };
  const demo = () => {
    setError('');
    const transport = new FixtureTransport();
    create(transport);
    transport.startDemo();
  };
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('fixture') === '1' && !current.current)
      demo();
    return () => {
      void current.current?.dispose();
      current.current = null;
    };
  }, []);
  const disconnect = () => {
    const previous = current.current;
    current.current = null;
    setRuntime(null);
    void previous?.dispose();
  };
  const connect = async () => {
    setConnecting(true);
    setError('');
    const transport = new LiveKitTransport();
    const next = create(transport);
    try {
      await transport.connect(url, token);
    } catch (error) {
      if (current.current === next) {
        current.current = null;
        setRuntime(null);
        setError((error as Error).message);
      }
      await next.dispose();
    } finally {
      setConnecting(false);
    }
  };
  if (runtime) return <ConnectedWorkspace runtime={runtime} disconnect={disconnect} />;
  return (
    <main className="workspace-app workspace-connect">
      <div className="connect-card">
        <Link className="workspace-brand" href="/">
          ◈ TELEOP <small>WORKSPACE</small>
        </Link>
        <span className="workspace-eyebrow">YOUR ROBOT. YOUR VIEW.</span>
        <h1>A workspace for every signal.</h1>
        <p>
          Connect to a LiveKit room, discover a robot, and arrange live video and telemetry around
          the way you work.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void connect();
          }}
        >
          <label>
            LiveKit server URL
            <input
              type="url"
              required
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="wss://your-project.livekit.cloud"
            />
          </label>
          <label>
            Participant token
            <input
              type="password"
              required
              value={token}
              onChange={(event) => setToken(event.target.value)}
              autoComplete="off"
              placeholder="Paste a room token"
            />
          </label>
          <button className="primary" disabled={connecting}>
            {connecting ? 'Connecting…' : 'Connect to room →'}
          </button>
        </form>
        {error && (
          <p className="workspace-error" role="alert">
            {error}
          </p>
        )}
        <div className="connect-divider">or explore without hardware</div>
        <button onClick={demo}>Open fixture workspace</button>
        <p className="field-help">
          Tokens stay in memory. Only visualization layouts are saved locally.
        </p>
      </div>
    </main>
  );
}
