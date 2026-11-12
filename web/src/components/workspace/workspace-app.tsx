"use client";

import Image from "next/image";
import Link from "next/link";
import { Plus } from "lucide-react";
import wordmark from "../../../public/lk-wordmark.svg";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { FixtureTransport } from "@/lib/teleop/fixture-transport";
import { LiveKitTransport } from "@/lib/teleop/livekit-transport";
import { WorkspaceRuntime } from "@/lib/teleop/runtime";
import { compatibleRobot, type Panel } from "@/lib/teleop/types";
import f1tenthLayout from "@/lib/teleop/example-layouts/f1tenth.json";
import armLayout from "@/lib/teleop/example-layouts/arm.json";
import { RuntimeContext } from "./context";
import { MediaProvider } from "./media";
import { ImmersiveVrProvider } from "./immersive-vr";
import { HandTrackingDriver } from "./hand-tracking";
import { WorkspaceHost, updatePanel } from "./workspace-host";
import { AddVisualization, type Prefill } from "./add-visualization";
import { demoRequest } from "@/lib/demo/types";
import { useDemoSession, useSeconds } from "@/lib/demo/use-session";
import "@/components/demo/simulations.css";

function ConnectedWorkspace({
  runtime,
  disconnect,
  connection,
  home = "/",
}: {
  runtime: WorkspaceRuntime;
  disconnect(): void;
  connection?: { connecting: boolean; error: string; retry(): void };
  home?: string;
}) {
  useSyncExternalStore(runtime.subscribe, runtime.snapshot, runtime.snapshot);
  const [editing, setEditing] = useState<string | undefined>(undefined);
  const [prefill, setPrefill] = useState<Prefill | undefined>(undefined);
  const [error, setError] = useState("");
  const importRef = useRef<HTMLInputElement>(null);
  const close = useCallback(() => setEditing(undefined), []);
  const edit = (id: string, topic?: Prefill) => {
    void runtime.controls.stopAll();
    setPrefill(topic);
    setEditing(id);
  };
  const exported = () => {
    if (!runtime.layoutStore) return;
    const url = URL.createObjectURL(
      new Blob([runtime.layoutStore.export()], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `teleop-layout-${runtime.selected.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const fixture =
    runtime.transport instanceof FixtureTransport
      ? runtime.transport
      : undefined;
  // Simulation robots load a saved layout. Any other robot gets the generic example panels.
  const sceneId = runtime.simulationId || runtime.selected;
  const exampleLayout = /f1tenth/.test(sceneId)
    ? f1tenthLayout
    : /cluttered-table|workbench|wxai/.test(sceneId)
      ? armLayout
      : undefined;
  const examples = () => {
    if (exampleLayout) {
      runtime
        .importLayout(JSON.stringify(exampleLayout))
        .catch((problem) =>
          setError(problem instanceof Error ? problem.message : String(problem)),
        );
      return;
    }
    const examples: Panel[] = [
      {
        label: "Yaw rate",
        visualization: "plot",
        visible: true,
        source: {
          kind: "data",
          track_name: "/imu",
          field_path: ["angular_velocity", "z"],
        },
        settings: { window_seconds: 30, expected_rate_hz: 10 },
      },
      {
        label: "System enabled",
        visualization: "boolean",
        visible: true,
        source: { kind: "data", track_name: "/enabled", field_path: ["data"] },
        settings: {},
      },
      {
        label: "Operating state",
        visualization: "state",
        visible: true,
        source: { kind: "data", track_name: "/state", field_path: ["data"] },
        settings: {
          window_seconds: 30,
          enum_labels: { "0": "Idle", "1": "Working", "2": "Waiting" },
        },
      },
    ];
    examples.forEach((panel, i) =>
      updatePanel(runtime, `example_${i + 1}`, panel),
    );
  };
  return (
    <RuntimeContext.Provider value={runtime}>
      <MediaProvider>
        <ImmersiveVrProvider runtime={runtime}>
        <HandTrackingDriver />
        <main className="workspace-app">
          <header className="workspace-topbar">
            <Link
              className="workspace-brand"
              href={home}
              aria-label="Teleop workspace home"
            >
              <Image src={wordmark} alt="LiveKit" priority />
              <small>Teleop</small>
            </Link>
            <Link href="/try">Try a simulation</Link>
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
                    {robot.name || robot.identity}
                    {!compatibleRobot(robot) ? " (incompatible protocol)" : ""}
                  </option>
                ))}
                {runtime.selected &&
                  !runtime
                    .robots()
                    .some((r) => r.identity === runtime.selected) && (
                    <option value={runtime.selected}>
                      {runtime.selected} (offline)
                    </option>
                  )}
              </select>
            </label>
            <span
              className={`connection-badge ${runtime.discovery === "ready" ? "online" : ""}`}
            >
              <span className="connection-dot" aria-hidden="true" />
              {runtime.connection} · {runtime.discovery}
            </span>
            <div className="workspace-top-actions">
              <button
                className="primary"
                disabled={runtime.discovery !== "ready"}
                onClick={() => edit("new")}
              >
                <Plus size={14} strokeWidth={2} aria-hidden="true" />
                Add visualization
              </button>
              <button disabled={!runtime.layout} onClick={exported}>
                Export layout
              </button>
              <button
                disabled={!runtime.layout}
                onClick={() => importRef.current?.click()}
              >
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
              {connection && runtime.connection === "disconnected" ? (
                <button disabled={connection.connecting} onClick={connection.retry}>
                  {connection.connecting ? "Connecting…" : "Connect to room"}
                </button>
              ) : (
                <button onClick={disconnect}>Disconnect</button>
              )}
            </div>
            <input
              hidden
              type="file"
              accept=".json,application/json"
              ref={importRef}
              aria-label="Import layout JSON"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                if (file.size > 2_000_000) {
                  setError("Layout file exceeds 2 MB.");
                  return;
                }
                void file
                  .text()
                  .then((text) => runtime.importLayout(text))
                  .then(() => {
                    setError("");
                    close();
                  })
                  .catch((e: Error) => setError(e.message));
              }}
            />
          </header>
          <div className="workspace-sessionbar">
            <span>{runtime.config?.label ?? "Discover a robot to begin"}</span>
            <span className="layout-save" role="status">
              {runtime.layoutStore?.saveStatus ?? "No layout selected"}
            </span>
            <div className="ownership">
              <span>
                {runtime.controls.owner
                  ? `Operator: ${runtime.controls.owner}`
                  : "Viewing · no active operator"}
              </span>
            </div>
          </div>
          {connection?.error && (
            <div className="workspace-alert" role="alert">
              <span>{connection.error}</span>
              <button disabled={connection.connecting} onClick={connection.retry}>
                Retry connection
              </button>
            </div>
          )}
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
              {runtime.discovery === "failed" && (
                <button
                  onClick={() => void runtime.select(runtime.selected, true)}
                >
                  Retry discovery
                </button>
              )}
              {error && (
                <button
                  aria-label="Dismiss import error"
                  onClick={() => setError("")}
                >
                  ×
                </button>
              )}
            </div>
          )}
          <div className="fixture-toolbar">
            <strong>EXAMPLES</strong>
            <button onClick={examples}>Load example panels</button>
            {fixture && (
              <>
                <span>
                  Generated media and commands; no hardware connected.
                </span>
                <button
                  onClick={() =>
                    fixture.add({
                      id: "/new_sensor",
                      robot: "fixture-rover",
                      kind: "data",
                      name: "/new_sensor",
                      encoding: "json",
                      msgType: "sensor/Temperature",
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
                    fixture.emit("interrupted");
                    setTimeout(() => fixture.emit("connected"), 500);
                  }}
                >
                  Reconnect
                </button>
                <span>{fixture.commands.length} command frames</span>
              </>
            )}
          </div>
          <div className="workspace-canvas">
            {runtime.layout ? (
              <WorkspaceHost
                key={`${runtime.selected}:${runtime.layoutRevision}`}
                onEdit={edit}
              />
            ) : (
              <div className="workspace-empty">
                <h2>Choose a compatible robot</h2>
                <p>
                  Robots advertise their Portal role and version. Viewing does
                  not request control.
                </p>
              </div>
            )}
          </div>
          <footer className="workspace-footer">
            <span>
              {
                runtime
                  .catalog()
                  .filter(
                    (p) => p.available && !p.excluded && p.kind === "data",
                  ).length
              }{" "}
              data topics · {runtime.cameras.cameras.size} live cameras
            </span>
            <span>
              Drag tabs to arrange · resize dividers · use Move for keyboard
              placement
            </span>
            <span>Layout stored in this browser</span>
          </footer>
          {editing && (
            <AddVisualization
              key={`${editing}:${prefill?.kind ?? ""}:${prefill?.track ?? ""}`}
              prefill={editing === "new" ? prefill : undefined}
              initial={
                editing === "new" ? undefined : runtime.layout?.panels[editing]
              }
              onClose={close}
              onSave={(panel) => {
                updatePanel(
                  runtime,
                  editing === "new"
                    ? `panel_${crypto.randomUUID().replaceAll("-", "")}`
                    : editing,
                  panel,
                );
                close();
              }}
            />
          )}
        </main>
        </ImmersiveVrProvider>
      </MediaProvider>
    </RuntimeContext.Provider>
  );
}

function ManagedWorkspace({ id }: { id: string }) {
  const { runtime, error, ended, expiresAt } = useDemoSession(id, "control");
  const seconds = useSeconds(expiresAt);
  const [stopError, setStopError] = useState("");
  if (ended || error)
    return (
      <main className="demo-session-ended">
        <h2>{error ? "Simulation failed" : "Session ended"}</h2>
        <p role="status">
          {error || "Your simulation session is complete. Choose another simulation to launch again."}
        </p>
        <Link href="/try">Return to simulations</Link>
      </main>
    );
  if (!runtime)
    return (
      <main className="demo-session-ended">
        <p role="status">Connecting to your simulation…</p>
        <Link href="/try">Return to simulations</Link>
      </main>
    );
  return (
    <>
      <ConnectedWorkspace
        home="/try"
        runtime={runtime}
        disconnect={() => {
          window.location.href = "/try";
        }}
      />
      <div className="demo-session-banner" role="status">
        Simulation · {seconds}s remaining
        <button onClick={() => {
          void demoRequest(`sessions/${id}`, { method: "DELETE" }).then(() => {
            window.location.href = "/try";
          }).catch((error: Error) => setStopError(error.message));
        }}>Stop simulation</button>
        {stopError && <span role="alert">{stopError}</span>}
      </div>
    </>
  );
}

export function WorkspaceApp() {
  const [sessionId, setSessionId] = useState<string | null | undefined>(
    undefined,
  );
  useEffect(() => {
    setSessionId(new URLSearchParams(window.location.search).get("session"));
  }, []);
  if (sessionId === undefined)
    return (
      <main className="demo-session-ended">
        <p role="status">Loading workspace…</p>
      </main>
    );
  return sessionId ? <ManagedWorkspace id={sessionId} /> : <ManualWorkspace />;
}

function ManualWorkspace() {
  const [runtime, setRuntime] = useState<WorkspaceRuntime | null>(null);
  const current = useRef<WorkspaceRuntime | null>(null);
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const create = useCallback((transport: LiveKitTransport | FixtureTransport) => {
    let storage: Storage | undefined;
    try {
      storage = window.localStorage;
    } catch {
      /* In-memory editing and export remain available. */
    }
    const previous = current.current;
    const next = new WorkspaceRuntime(transport, storage);
    current.current = next;
    void previous?.dispose();
    next.start();
    setRuntime(next);
    return next;
  }, []);
  const connect = useCallback(async () => {
    setConnecting(true);
    setError('');
    const transport = new LiveKitTransport();
    const next = create(transport);
    try {
      const response = await fetch('/api/credentials', { cache: 'no-store' });
      if (current.current !== next) return;
      if (!response.ok)
        throw new Error(
          `Could not get connection credentials (HTTP ${response.status}). Check the server's LiveKit settings.`,
        );
      const credentials = await response.json();
      if (current.current !== next) return;
      if (
        typeof credentials.server_url !== 'string' ||
        !credentials.server_url ||
        typeof credentials.token !== 'string' ||
        !credentials.token
      )
        throw new Error('Could not get connection credentials.');
      await transport.connect(credentials.server_url, credentials.token);
      // An unmount, disconnect or retry may have replaced this connection.
      if (current.current !== next) await transport.disconnect();
    } catch (error) {
      if (current.current === next) setError((error as Error).message);
      await transport.disconnect();
    } finally {
      if (current.current === next) setConnecting(false);
    }
  }, [create]);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('fixture') === '1') {
      const transport = new FixtureTransport();
      create(transport);
      transport.startDemo();
    } else {
      void connect();
    }
    return () => {
      void current.current?.dispose();
      current.current = null;
    };
  }, [connect, create]);
  const disconnect = () => {
    setError('');
    setConnecting(false);
    create(new LiveKitTransport());
  };
  if (!runtime) return <p role="status">Loading workspace…</p>;
  return (
    <ConnectedWorkspace
      runtime={runtime}
      disconnect={disconnect}
      connection={{ connecting, error, retry: () => void connect() }}
    />
  );
}
