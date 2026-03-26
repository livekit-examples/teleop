/** Matches `PanTiltController::kTicksPerRevolution` in pan_tilt_demo. */
export const SERVO_TICKS_PER_REV = 4096;

export const PAN_STATE_TOPIC = "state.pan";
export const TILT_STATE_TOPIC = "state.tilt";

/** Same wrapping as `PanTiltController::wrapTicks`. */
export function wrapServoTicks(rawTicks: number): number {
  let wrapped = rawTicks % SERVO_TICKS_PER_REV;
  if (wrapped < 0) {
    wrapped += SERVO_TICKS_PER_REV;
  }
  return wrapped;
}

/**
 * Map encoder ticks to degrees in [-180, 180] for UI scales (one full revolution).
 */
export function servoTicksToDegrees(positionTicks: number): number {
  const w = wrapServoTicks(positionTicks);
  return (w / SERVO_TICKS_PER_REV) * 360 - 180;
}

export type ServoStatePayload = {
  position_ticks?: number;
  valid?: boolean;
};
