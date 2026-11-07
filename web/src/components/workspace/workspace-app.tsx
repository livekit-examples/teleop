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
import { RuntimeContext } from "./context";
import { MediaProvider } from "./media";
import { WorkspaceHost, updatePanel } from "./workspace-host";
import { AddVisualization } from "./add-visualization";
import { useDemoSession, useSeconds } from "@/lib/demo/use-session";
import "@/components/demo/simulations.css";

function ConnectedWorkspace({
  runtime,
  disconnect,
}: {
  runtime: WorkspaceRuntime;
  disconnect(): void;
}) {
  useSyncExternalStore(runtime.subscribe, runtime.snapshot, runtime.snapshot);
  const [editing, setEditing] = useState<string | undefined>(undefined);
  const [error, setError] = useState("");
  const importRef = useRef<HTMLInputElement>(null);
  const close = useCallback(() => setEditing(undefined), []);
  const edit = (id: string) => {
    void runtime.controls.stopAll();
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
  const examples = () => {
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
        <main className="workspace-app">
          <header className="workspace-topbar">
            <Link
              className="workspace-brand"
              href="/"
              aria-label="Teleop workspace home"
            >
              <Image src={wordmark} alt="LiveKit" priority />
              <small>Teleop</small>
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
              <button
                disabled={
                  runtime.discovery !== "ready" || runtime.controls.pending
                }
                onClick={() =>
                  void (
                    runtime.controls.ownsControl
                      ? runtime.controls.release()
                      : runtime.controls.request()
                  ).then(runtime.notify)
                }
              >
                {runtime.controls.pending
                  ? "Requesting…"
                  : runtime.controls.ownsControl
                    ? "Release control"
                    : "Request control"}
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
              key={editing}
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
      </MediaProvider>
    </RuntimeContext.Provider>
  );
}

function ManagedWorkspace({ id }: { id: string }) {
  const { runtime, error, ended, expiresAt } = useDemoSession(id, "control");
  const seconds = useSeconds(expiresAt);
  if (ended || error)
    return (
      <main className="demo-session-ended">
        <h2>Session ended</h2>
        <p role="status">
          {error || "Your 60-second simulation session is complete."}
        </p>
        <Link href="/">Return to simulations</Link>
      </main>
    );
  if (!runtime)
    return (
      <main className="demo-session-ended">
        <p role="status">Connecting to your simulation…</p>
        <Link href="/">Return to simulations</Link>
      </main>
    );
  return (
    <>
      <ConnectedWorkspace
        runtime={runtime}
        disconnect={() => {
          window.location.href = "/";
        }}
      />
      <div className="demo-session-banner" role="status">
        Simulation · {seconds}s remaining
      </div>
    </>
  );
}

const PASSWORD_KEY = "teleop.workspace.password";

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
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [reveal, setReveal] = useState(false);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(PASSWORD_KEY);
      if (saved) setPassword(saved);
    } catch {
      /* Storage is unavailable, so the password is not remembered. */
    }
  }, []);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!drawerOpen) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setDrawerOpen(false);
      toggleRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);
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
    setError("");
    const transport = new FixtureTransport();
    create(transport);
    transport.startDemo();
  };
  useEffect(() => {
    if (
      new URLSearchParams(window.location.search).get("fixture") === "1" &&
      !current.current
    )
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
  const connect = async (): Promise<boolean> => {
    setConnecting(true);
    setError("");
    const transport = new LiveKitTransport();
    const next = create(transport);
    try {
      const response = await fetch("/api/credentials", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${password.trim()}` },
      });
      if (!response.ok) {
        if (response.status === 403)
          throw new Error("Incorrect password. Please try again.");
        if (response.status === 401) throw new Error("Password is required.");
        throw new Error(
          `Could not get connection credentials (HTTP ${response.status}).`,
        );
      }
      const credentials = await response.json();
      if (
        typeof credentials.server_url !== "string" ||
        !credentials.server_url ||
        typeof credentials.token !== "string" ||
        !credentials.token
      )
        throw new Error("Could not get connection credentials.");
      await transport.connect(credentials.server_url, credentials.token);
      try {
        window.localStorage.setItem(PASSWORD_KEY, password.trim());
      } catch {
        /* Storage is unavailable, so the password is not remembered. */
      }
      return true;
    } catch (error) {
      if (current.current === next) {
        current.current = null;
        setRuntime(null);
        setError((error as Error).message);
      }
      await next.dispose();
      return false;
    } finally {
      setConnecting(false);
    }
  };
  const signIn = async () => {
    if (!password.trim()) {
      setDrawerOpen(true);
      return;
    }
    if (!(await connect())) setDrawerOpen(true);
  };
  if (runtime)
    return <ConnectedWorkspace runtime={runtime} disconnect={disconnect} />;
  return (
    <main className="workspace-app workspace-connect">
      <div className="connect-shell">
        <header className="connect-masthead">
          <h1 className="connect-brand">
            <Image src={wordmark} alt="LiveKit" priority />
            <span>Teleop</span>
          </h1>
          <div
            className="connect-status"
            data-state={connecting ? "connecting" : "disconnected"}
          >
            <span className="connect-status-dot" aria-hidden="true" />
            <span>{connecting ? "Connecting" : "Disconnected"}</span>
          </div>
        </header>
        <section className="connect-hero">
          <p className="connect-eyebrow">Robot workspace</p>
          <h2>
            A workspace for <em>every</em> signal
          </h2>
          <p>
            Connect to a LiveKit room, discover a robot, and arrange live video
            and telemetry around the way you work. Open the key tab on the right
            edge to sign in.
          </p>
          <div className="connect-actions">
            <button
              className="pill-button"
              disabled={connecting}
              onClick={() => void signIn()}
            >
              Sign in
            </button>
          </div>
        </section>
      </div>
      <button
        ref={toggleRef}
        className="connect-edge-toggle"
        type="button"
        aria-label="Open connection settings"
        aria-controls="connect-drawer"
        aria-expanded={drawerOpen}
        data-hover-label="Credentials"
        title="Credentials"
        onClick={() => setDrawerOpen((open) => !open)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="7.25" cy="12" r="4.25" />
          <path d="M11.5 12H22m-3 0v3m-3-3v2" />
        </svg>
      </button>
      <aside
        id="connect-drawer"
        className={`connect-drawer${drawerOpen ? " open" : ""}`}
        aria-labelledby="connect-drawer-heading"
        aria-hidden={!drawerOpen}
        inert={!drawerOpen}
      >
        <div className="drawer-header">
          <div>
            <p className="drawer-kicker">LiveKit access</p>
            <h2 id="connect-drawer-heading">Connection settings</h2>
          </div>
          <button
            ref={closeRef}
            className="drawer-close"
            type="button"
            aria-label="Close connection settings"
            onClick={() => setDrawerOpen(false)}
          >
            ×
          </button>
        </div>
        <form
          className="drawer-form"
          onSubmit={(event) => {
            event.preventDefault();
            void connect();
          }}
        >
          <label className="drawer-field">
            <span>Password</span>
            <input
              type={reveal ? "text" : "password"}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              placeholder="Enter operator password"
            />
            <button
              className="drawer-reveal"
              type="button"
              aria-label={reveal ? "Hide password" : "Show password"}
              onClick={() => setReveal((value) => !value)}
            >
              {reveal ? "Hide" : "Show"}
            </button>
          </label>
          {error && (
            <p className="drawer-error" role="alert">
              {error}
            </p>
          )}
          <button className="drawer-primary" disabled={connecting}>
            {connecting ? "Connecting…" : "Connect to room"}
          </button>
        </form>
        <p className="drawer-note">
          The server selects the configured room. Only visualization layouts are
          saved locally.
        </p>
      </aside>
    </main>
  );
}
