"use client";

import {
  Suspense,
  createContext,
  lazy,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { WorkspaceRuntime } from "@/lib/teleop/runtime";
import { useRuntime } from "./context";
import { useMediaHosts } from "./media";
import type { VrController } from "./vr/vr-stage";

// three.js and the XR packages load only in a browser that can start a headset session.
const VrStage = lazy(() => import("./vr/vr-stage"));

type Immersive = {
  /** The browser can start an immersive-vr session. */
  supported: boolean;
  active: boolean;
  /** The last message about the session, such as why it could not start. */
  status: string;
  enter(): void;
  exit(): void;
};

const ImmersiveContext = createContext<Immersive>({
  supported: false,
  active: false,
  status: "",
  enter: () => {},
  exit: () => {},
});

export const useImmersiveVr = () => useContext(ImmersiveContext);

/** Owns the immersive session state, and mounts the VR scene when the browser supports it. */
export function ImmersiveVrProvider({ runtime, children }: { runtime: WorkspaceRuntime; children: ReactNode }) {
  const hosts = useMediaHosts();
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState("");
  const controller = useRef<VrController | null>(null);
  useEffect(() => {
    let alive = true;
    void navigator.xr
      ?.isSessionSupported("immersive-vr")
      .then((yes) => {
        if (alive) setSupported(yes);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const register = useCallback((next: VrController | null) => {
    controller.current = next;
  }, []);
  const value = useMemo<Immersive>(
    () => ({
      supported,
      active,
      status,
      enter: () => {
        setStatus("");
        controller.current
          ?.enter()
          .catch((error: Error) => setStatus(`Could not start immersive VR: ${error.message}`));
      },
      exit: () => controller.current?.exit(),
    }),
    [supported, active, status],
  );
  return (
    <ImmersiveContext.Provider value={value}>
      {children}
      {supported && (
        <Suspense fallback={null}>
          <VrStage runtime={runtime} hosts={hosts} register={register} onActive={setActive} onStatus={setStatus} />
        </Suspense>
      )}
    </ImmersiveContext.Provider>
  );
}

/** A headset. Drawn here because the icon set has no VR headset. */
function HeadsetIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h13A2.5 2.5 0 0 1 21 8.5v6a2.5 2.5 0 0 1-2.5 2.5h-2.6a2 2 0 0 1-1.7-.96l-.4-.64a1.4 1.4 0 0 0-2.4 0l-.4.64A2 2 0 0 1 8.1 17H5.5A2.5 2.5 0 0 1 3 14.5z" />
      <path d="M1 10.5v3M23 10.5v3" />
    </svg>
  );
}

/** Enter or leave the immersive view. It looks like the Add visualization button. */
export function ImmersiveVrButton() {
  const runtime = useRuntime();
  const vr = useImmersiveVr();
  const blocked = !vr.supported
    ? "Immersive VR is unavailable in this browser."
    : runtime.discovery !== "ready"
      ? "Select a robot first."
      : "";
  return (
    <button
      className="primary immersive-vr"
      disabled={!vr.active && !!blocked}
      title={blocked || undefined}
      onClick={vr.active ? vr.exit : vr.enter}
    >
      <HeadsetIcon />
      {vr.active ? "Exit VR" : "Immersive VR"}
    </button>
  );
}
