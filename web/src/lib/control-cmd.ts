/** Matches `pan_tilt_topics::kControlCmdTrack` in pan_tilt_demo. */
export const CONTROL_CMD_TOPIC = 'control_cmd';

/** ~2 rad/s per API_README (internal ±1000 steps/s). */
export const MAX_CONTROL_RAD_PER_SEC = 2;

export function clampControlRadPerSec(n: number): number {
  return Math.max(-MAX_CONTROL_RAD_PER_SEC, Math.min(MAX_CONTROL_RAD_PER_SEC, n));
}

export function controlCmdJson(pan_vel: number, tilt_vel: number): string {
  return JSON.stringify({
    pan_vel: clampControlRadPerSec(pan_vel),
    tilt_vel: clampControlRadPerSec(tilt_vel),
  });
}
