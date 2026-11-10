"use client";

import { useFrame } from "@react-three/fiber";
import { useXR } from "@react-three/xr";
import { useEffect, useMemo } from "react";
import { XrTeleop, type XrHandSample } from "@/lib/teleop/xr";
import { useRuntime } from "../context";

/**
 * Moves the robot with the controllers. Hold grip to follow the controller pose, and release
 * grip to stop. The rules are in `XrTeleop`. This component only reads the XR frame.
 */
export function VrTeleopDriver({ status }: { status(message: string): void }) {
  const runtime = useRuntime();
  const session = useXR((state) => state.session);
  const teleop = useMemo(() => new XrTeleop(runtime, status), [runtime, status]);

  useEffect(() => {
    if (!session) return;
    runtime.xrActive = true;
    // The desktop Controls panel is out of sight in a headset. The VR Controls panel stands in for it.
    runtime.controls.setVisible(true);
    status("VR active. Release grip, then press it to establish a fresh reference.");
    const hidden = () => {
      if (session.visibilityState !== "visible") void runtime.controls.stopAll();
    };
    session.addEventListener("visibilitychange", hidden);
    return () => {
      session.removeEventListener("visibilitychange", hidden);
      runtime.xrActive = false;
      teleop.stopAll();
      status("VR session ended. Inputs disarmed.");
      runtime.notify();
    };
  }, [session, runtime, teleop, status]);

  useFrame((state, _delta, frame) => {
    if (!session || !frame) return;
    const reference = state.gl.xr.getReferenceSpace();
    if (!reference) return;
    const hands: XrHandSample[] = [];
    for (const source of session.inputSources) {
      if (source.handedness !== "left" && source.handedness !== "right") continue;
      hands.push({
        handedness: source.handedness,
        grip: source.gamepad?.buttons[1]?.pressed ?? false,
        pose: () => {
          const pose = source.gripSpace ? frame.getPose(source.gripSpace, reference) : null;
          return pose ? { position: pose.transform.position, orientation: pose.transform.orientation } : null;
        },
      });
    }
    teleop.update(performance.now(), hands);
  });
  return null;
}
