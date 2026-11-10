import { useSyncExternalStore } from "react";

export const MAX_VR_EYE_OFFSET_CM = 12;
export const DEFAULT_VR_EYE_OFFSET_CM = 10;
export const VR_EYE_OFFSET_STEP_CM = 0.25;

// The headset keeps its alignment across visits, so the offset lives in this browser's localStorage.
const KEY = "lk_vr_eye_offset_cm";
const listeners = new Set<() => void>();

const clamp = (value: number) =>
  Math.min(MAX_VR_EYE_OFFSET_CM, Math.max(0, Math.round(value / VR_EYE_OFFSET_STEP_CM) * VR_EYE_OFFSET_STEP_CM));

function load() {
  try {
    const stored = typeof window === "undefined" ? null : window.localStorage.getItem(KEY);
    const value = stored === null ? NaN : Number(stored);
    return Number.isFinite(value) ? clamp(value) : DEFAULT_VR_EYE_OFFSET_CM;
  } catch {
    return DEFAULT_VR_EYE_OFFSET_CM;
  }
}

let offset = load();

/** How far each eye's half of a stereo picture moves toward its own eye, in centimeters. */
export function useVrEyeOffsetCm() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => offset,
    () => DEFAULT_VR_EYE_OFFSET_CM,
  );
}

export function setVrEyeOffsetCm(value: number) {
  if (!Number.isFinite(value)) return;
  const next = clamp(value);
  if (next === offset) return;
  offset = next;
  try {
    window.localStorage.setItem(KEY, String(next));
  } catch {
    // Storage can be blocked. The offset then lasts until the page reloads.
  }
  for (const listener of listeners) listener();
}
