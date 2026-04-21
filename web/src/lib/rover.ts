/**
 * Track names, payload types, and encoders for the rover LiveKit API.
 * @see `rover/API_README` — participant-agnostic rover protocol.
 */

export const IMU_TOPIC_SUFFIX = 'imu';
export const CONTROL_CMD_TOPIC_SUFFIX = 'control_cmd';
export const ARDUCAM_TRACK_SUFFIX = 'arducam';
export const ACQUIRE_CONTROL_METHOD = 'acquire_control';

export function roverImuTopic(roverId: string): string {
  return `${roverId}.${IMU_TOPIC_SUFFIX}`;
}

export function roverControlCmdTopic(roverId: string): string {
  return `${roverId}.${CONTROL_CMD_TOPIC_SUFFIX}`;
}

export function roverArducamTrackName(roverId: string): string {
  return `${roverId}.${ARDUCAM_TRACK_SUFFIX}`;
}

export interface ImuVec3 {
  x: number;
  y: number;
  z: number;
}

export interface ImuOrientationRad {
  roll: number;
  pitch: number;
  yaw: number;
}

/** JSON payload of `<rover_id>.imu`. */
export interface ImuPayload {
  orientation_rad: ImuOrientationRad;
  accel_mg: ImuVec3;
  gyro_dps: ImuVec3;
  mag_ut: ImuVec3;
  temperature_c: number;
}

/**
 * Max commanded throttle/steering in rev/s. The rover firmware accepts larger
 * values but this keeps the UI within a sane range.
 */
export const MAX_CONTROL_REV_PER_SEC = 1;

export function clampControlRevPerSec(n: number): number {
  return Math.max(-MAX_CONTROL_REV_PER_SEC, Math.min(MAX_CONTROL_REV_PER_SEC, n));
}

export function controlCmdJson(throttle_rps: number, steering_rps: number): string {
  return JSON.stringify({
    throttle_rps: clampControlRevPerSec(throttle_rps),
    steering_rps: clampControlRevPerSec(steering_rps),
  });
}

export const RAD_TO_DEG = 180 / Math.PI;
