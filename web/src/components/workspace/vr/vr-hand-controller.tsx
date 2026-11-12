"use client";

import {
  PointerCursorModel,
  PointerRayModel,
  XRControllerModel,
  XRSpace,
  useRayPointer,
  useXR,
  useXRInputSourceStateContext,
} from "@react-three/xr";
import { Suspense, useEffect, useRef } from "react";
import type { Object3D } from "three";

/**
 * Shows a controller and its ray. A held grip moves a robot arm, so the
 * trigger does not select panel items while grip is held.
 */
export function VrHandController() {
  const controller = useXRInputSourceStateContext("controller");
  const session = useXR((state) => state.session);
  const raySpace = useRef<Object3D>(null);
  const pointer = useRayPointer(raySpace, controller, {
    makeDefault: true,
    minDistance: 0.2,
  });
  const gripHeld = useRef(false);
  const selectSuppressed = useRef(false);

  useEffect(() => {
    if (!session) return;
    const input = controller.inputSource;
    const ownEvent = (event: XRInputSourceEvent) => event.inputSource === input;
    const gripPressed = () =>
      gripHeld.current || input.gamepad?.buttons[1]?.pressed === true;

    const onSelectStart = (event: XRInputSourceEvent) => {
      if (!ownEvent(event)) return;
      if (gripPressed()) {
        selectSuppressed.current = true;
        return;
      }
      pointer.down({ timeStamp: event.timeStamp, button: 0 });
    };
    const onSelectEnd = (event: XRInputSourceEvent) => {
      if (!ownEvent(event)) return;
      if (selectSuppressed.current || gripPressed()) {
        selectSuppressed.current = false;
        if (pointer.getButtonsDown().size > 0)
          pointer.cancel({ timeStamp: event.timeStamp });
        return;
      }
      pointer.up({ timeStamp: event.timeStamp, button: 0 });
    };
    const onSqueezeStart = (event: XRInputSourceEvent) => {
      if (!ownEvent(event)) return;
      gripHeld.current = true;
      if (pointer.getButtonsDown().has(0)) {
        selectSuppressed.current = true;
        pointer.cancel({ timeStamp: event.timeStamp });
      }
    };
    const onSqueezeEnd = (event: XRInputSourceEvent) => {
      if (ownEvent(event)) gripHeld.current = false;
    };

    for (const event of controller.events) {
      if (event.type === "selectstart") onSelectStart(event);
      else if (event.type === "selectend") onSelectEnd(event);
      else if (event.type === "squeezestart") onSqueezeStart(event);
      else if (event.type === "squeezeend") onSqueezeEnd(event);
    }
    session.addEventListener("selectstart", onSelectStart);
    session.addEventListener("selectend", onSelectEnd);
    session.addEventListener("squeezestart", onSqueezeStart);
    session.addEventListener("squeezeend", onSqueezeEnd);
    return () => {
      pointer.cancel({ timeStamp: performance.now() });
      session.removeEventListener("selectstart", onSelectStart);
      session.removeEventListener("selectend", onSelectEnd);
      session.removeEventListener("squeezestart", onSqueezeStart);
      session.removeEventListener("squeezeend", onSqueezeEnd);
      gripHeld.current = false;
      selectSuppressed.current = false;
    };
  }, [controller.events, controller.inputSource, pointer, session]);

  return (
    <>
      <Suspense fallback={null}>
        <XRControllerModel />
      </Suspense>
      <XRSpace ref={raySpace} space="target-ray-space">
        <PointerRayModel pointer={pointer} />
        <PointerCursorModel pointer={pointer} />
      </XRSpace>
    </>
  );
}
