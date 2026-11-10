"use client";

import { Canvas } from "@react-three/fiber";
import { XR, createXRStore, useXR } from "@react-three/xr";
import { useEffect, useState } from "react";
import type { WorkspaceRuntime } from "@/lib/teleop/runtime";
import { RuntimeContext, useRuntime } from "../context";
import { THEME, VrCanvasPanel, button, dot, text, type Painter } from "./canvas-panel";
import { VrControlsPanel, type ControlsTab } from "./vr-controls";
import { VrCameraRow, VrMainCamera, cameraRowTop, useVrCameras } from "./vr-cameras";
import { VrHandController } from "./vr-hand-controller";
import { VrTeleopDriver } from "./vr-teleop";
import { VrVisualizationsPanel } from "./vr-visualizations";

export type VrController = { enter(): Promise<void>; exit(): void };

export const vrStore = createXRStore({
  emulate: false,
  offerSession: false,
  domOverlay: false,
  controller: { left: VrHandController, right: VrHandController },
  hand: false,
  gaze: false,
  transientPointer: false,
  // The view uses no scene understanding. Leaving these out keeps the headset
  // from asking for spatial data.
  anchors: false,
  hitTest: false,
  meshDetection: false,
  planeDetection: false,
});

type Hosts = Map<string, { video: HTMLVideoElement }>;

/** The bar above the main camera: robot, connection and operator, as in the desktop session bar. */
function StatusBar() {
  const runtime = useRuntime();
  const connected = runtime.connection === "connected";
  const owner = runtime.controls.owner;
  const paint = (p: Painter) => {
    p.ctx.beginPath();
    p.ctx.roundRect(2, 2, p.width - 4, p.height - 4, 20);
    p.ctx.fillStyle = "rgba(7, 7, 7, 0.96)";
    p.ctx.fill();
    p.ctx.strokeStyle = THEME.line2;
    p.ctx.lineWidth = 3;
    p.ctx.stroke();
    const mid = p.height / 2 + 1;
    text(p, "TELEOP", 40, mid, { size: 26, weight: 600, mono: true, color: THEME.accent });
    text(p, runtime.config?.label ?? "No robot selected", 160, mid, { size: 32, weight: 600, color: THEME.fg0, maxWidth: 440 });
    p.ctx.fillStyle = "rgba(255, 255, 255, 0.16)";
    p.ctx.fillRect(640, 30, 2, p.height - 60);
    dot(p, 680, mid, connected ? THEME.success : runtime.connection === "reconnecting" ? THEME.moderate : THEME.fg4, 12);
    text(p, `${runtime.connection} · ${runtime.discovery}`, 706, mid, { size: 28, mono: true, color: THEME.fg1, maxWidth: 270 });
    p.ctx.fillStyle = "rgba(255, 255, 255, 0.16)";
    p.ctx.fillRect(990, 30, 2, p.height - 60);
    text(p, owner ? `Operator: ${owner}` : "Viewing · no active operator", 1016, mid, {
      size: 28,
      weight: 600,
      color: owner ? THEME.success : THEME.fg3,
      maxWidth: 440,
    });
  };
  return <VrCanvasPanel position={[0, 2.37, -1.8]} width={2.6} canvasWidth={1500} canvasHeight={128} paint={paint} />;
}

/** The buttons under the main camera: add a visualization, and leave VR. */
function Toolbar({ top, onAdd }: { top: number; onAdd(): void }) {
  const paint = (p: Painter) => {
    const half = (p.width - 14) / 2;
    button(p, { x: 0, y: 0, w: half, h: p.height }, "add", "+  Add visualization", { kind: "primary", onClick: onAdd, size: 32 });
    button(p, { x: half + 14, y: 0, w: half, h: p.height }, "exit", "Exit VR", {
      kind: "danger",
      onClick: () => void vrStore.getState().session?.end(),
      size: 32,
    });
  };
  return <VrCanvasPanel position={[0.69, top - 0.065, -1.8]} width={0.84} canvasWidth={1008} canvasHeight={156} paint={paint} />;
}

function Scene({ hosts, onStatus }: { hosts: Hosts; onStatus(message: string): void }) {
  const runtime = useRuntime();
  const session = useXR((state) => state.session);
  const cameras = useVrCameras(runtime, hosts);
  const [tab, setTab] = useState<ControlsTab>("controls");
  // Nothing draws, and no stream is requested, while the page is not in a headset.
  if (!session) return null;
  return (
    <>
      <color attach="background" args={["#030303"]} />
      {/* Controller models use lit materials. Panels use unlit materials, so these lights change only the models. */}
      <ambientLight intensity={1.5} />
      <directionalLight position={[0.5, 3, 1]} intensity={2.5} />
      <VrMainCamera cameras={cameras} />
      <VrCameraRow cameras={cameras} />
      <StatusBar />
      <Toolbar top={cameraRowTop(cameras)} onAdd={() => setTab("topics")} />
      <VrVisualizationsPanel hosts={hosts} position={[-2.15, 1.55, -1.45]} rotation={[0, 0.95, 0]} onAdd={() => setTab("topics")} />
      <VrControlsPanel tab={tab} setTab={setTab} position={[2.05, 1.55, -1.45]} rotation={[0, -0.8, 0]} />
      <VrTeleopDriver status={onStatus} />
    </>
  );
}

/**
 * The immersive scene. The canvas stays in the page, hidden, so that the headset can start a
 * session from a button click. The scene draws only while a session runs.
 */
export default function VrStage({
  runtime,
  hosts,
  register,
  onActive,
  onStatus,
}: {
  runtime: WorkspaceRuntime;
  hosts: Hosts;
  register(controller: VrController | null): void;
  onActive(active: boolean): void;
  onStatus(message: string): void;
}) {
  useEffect(() => {
    register({
      enter: async () => {
        await vrStore.enterVR();
      },
      exit: () => void vrStore.getState().session?.end(),
    });
    const stop = vrStore.subscribe((state) => onActive(!!state.session));
    return () => {
      stop();
      register(null);
    };
  }, [register, onActive]);
  return (
    <div className="vr-stage" aria-hidden="true">
      <Canvas gl={{ antialias: false, alpha: true }}>
        <XR store={vrStore}>
          <RuntimeContext.Provider value={runtime}>
            <Scene hosts={hosts} onStatus={onStatus} />
          </RuntimeContext.Provider>
        </XR>
      </Canvas>
    </div>
  );
}
