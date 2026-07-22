import type { DataTrackFrameEncoding, DataTrackSchemaId } from 'livekit-client';

/** Matches the `<rover_id>.cmd_vel` schema in rover/API_README.md. */
export const CONTROL_CMD_TOPIC = 'cmd_vel';

/**
 * Schema identifier for `cmd_vel` JSON frames. The schema name supplies the ROS
 * message type the bridge should instantiate with local introspection.
 */
export const CONTROL_CMD_SCHEMA: DataTrackSchemaId = {
  name: 'geometry_msgs/msg/Twist',
  encoding: 'jsonSchema',
};

/** `cmd_vel` frame bytes are UTF-8 JSON decoded by the ROS bridge. */
export const CONTROL_CMD_FRAME_ENCODING: DataTrackFrameEncoding = 'json';

/** Max commanded wheel velocity magnitude in rev/s. */
export const MAX_CONTROL_RPS = 2;

export function clampControlRps(n: number): number {
  return Math.max(-MAX_CONTROL_RPS, Math.min(MAX_CONTROL_RPS, n));
}

/**
 * Builds the Twist-shaped `cmd_vel` JSON: throttle maps to `linear.x`,
 * steering maps to `angular.z`; the remaining axes are reserved and sent as 0.
 */
export function controlCmdJson(linear_x: number, angular_z: number): string {
  return JSON.stringify({
    angular: { x: 0, y: 0, z: clampControlRps(angular_z) },
    linear: { x: clampControlRps(linear_x), y: 0, z: 0 },
  });
}
