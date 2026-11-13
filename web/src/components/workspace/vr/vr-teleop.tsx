"use client";

import { operationPresentations } from "@/lib/teleop/control-profiles";

import { useFrame } from "@react-three/fiber";
import { useXR } from "@react-three/xr";
import { useEffect, useMemo, useRef } from "react";
import { controlChannels, controlKey } from "@/lib/teleop/controls";
import { vrInterfaces } from "@/lib/teleop/xr-bindings";
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
    // Use the VR presentation wherever an interface offers it. The choice is not saved, and the
    // previous one returns when the session ends.
    const previous: { key: string; operation: string; presentation: string }[] = [];
    for (const [equipmentId, equipment] of Object.entries(runtime.config?.control_interfaces ?? {})) {
      for (const [operation, op] of Object.entries(equipment.operations)) {
        if (!operationPresentations(op).includes("vr")) continue;
        const key = controlKey(equipmentId, op.control_channel ?? "primary");
        const current = runtime.controls.session(key);
        if (!current || current.presentation === "vr" || previous.some((entry) => entry.key === key)) continue;
        previous.push({ key, operation: current.operation, presentation: current.presentation });
        void runtime.controls.select(key, operation, "vr").then(runtime.notify);
      }
    }
    // Bind the hands when none is bound, so that grip works without a visit to the settings.
    const bound = runtime.layout?.controller_hands ?? {};
    if (runtime.layout && !bound.left && !bound.right) {
      const ids = vrInterfaces(runtime).map(([id]) => id);
      if (ids[0]) {
        const hands: Partial<Record<"left" | "right", string>> = { right: ids[0] };
        if (ids[1]) hands.left = ids[1];
        runtime.editLayout({ ...runtime.layout, controller_hands: hands });
      }
    }
    status("VR active. Release grip, then press it to establish a fresh reference.");
    const hidden = () => {
      if (session.visibilityState !== "visible") void runtime.controls.stopAll();
    };
    session.addEventListener("visibilitychange", hidden);
    return () => {
      session.removeEventListener("visibilitychange", hidden);
      runtime.xrActive = false;
      teleop.stopAll();
      for (const entry of previous) void runtime.controls.select(entry.key, entry.operation, entry.presentation).then(runtime.notify);
      status("VR session ended. Inputs disarmed.");
      runtime.notify();
    };
  }, [session, runtime, teleop, status]);

  // Arm the bound interfaces once, as soon as the operator holds control. After that, only the
  // operator disarms them, so a Disarm press stays disarmed for the rest of the session.
  const tried = useRef(new Set<string>());
  const revision = runtime.snapshot();
  useEffect(() => {
    if (!session) {
      tried.current.clear();
      return;
    }
    const { controls } = runtime;
    if (!controls.ownsControl) return;
    const bound = Object.values(runtime.layout?.controller_hands ?? {});
    for (const [equipmentId, equipment] of Object.entries(runtime.config?.control_interfaces ?? {})) {
      if (!bound.includes(equipmentId)) continue;
      const vrChannels = new Set(
        Object.values(equipment.operations)
          .filter((op) => operationPresentations(op).includes("vr"))
          .map((op) => op.control_channel ?? "primary"),
      );
      for (const channel of controlChannels(equipment)) {
        const key = controlKey(equipmentId, channel);
        const current = controls.session(key);
        if (tried.current.has(key) || !current || current.armed || current.switching || controls.reason(key)) continue;
        // A VR channel waits for the switch to the VR presentation.
        if (vrChannels.has(channel) && current.presentation !== "vr") continue;
        if (!vrChannels.has(channel) && channel !== "gripper") continue;
        tried.current.add(key);
        void controls.arm(key).then(runtime.notify);
      }
    }
  }, [session, runtime, revision]);

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
        // In the xr-standard mapping, axes 2 and 3 are the thumbstick X and Y.
        stick: source.gamepad?.axes[2] ?? 0,
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
