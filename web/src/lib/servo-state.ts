/** Matches `PanTiltController::kTicksPerRevolution` in pan_tilt_demo. */
export const SERVO_TICKS_PER_REV = 4096;

export const PAN_STATE_TOPIC = 'state.pan';
export const TILT_STATE_TOPIC = 'state.tilt';
/** IMU telemetry data track published by the robot. */
export const IMU_DATA_RAW_TOPIC = '/imu/data_raw';
/** Odometry telemetry data track published by the robot (ROS2 `nav_msgs/msg/Odometry` as JSON). */
export const ODOM_TOPIC = 'odom';

/** JSON payload for `imu.data_raw`. */
export type GyroStatePayload = {
  gyro_x_dps?: number;
  gyro_y_dps?: number;
  gyro_z_dps?: number;
  angle_x_deg?: number;
  angle_y_deg?: number;
  angle_z_deg?: number;
  valid?: boolean;
};

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

export type Quaternion = {
  x?: number;
  y?: number;
  z?: number;
  w?: number;
};

/** JSON conversion of ROS2 `nav_msgs/msg/Odometry` (only the fields we consume). */
export type OdometryPayload = {
  header?: { frame_id?: string; stamp?: { sec?: number; nanosec?: number } };
  child_frame_id?: string;
  pose?: {
    covariance?: number[];
    pose?: {
      position?: { x?: number; y?: number; z?: number };
      orientation?: Quaternion;
    };
  };
  twist?: {
    covariance?: number[];
    twist?: {
      linear?: { x?: number; y?: number; z?: number };
      angular?: { x?: number; y?: number; z?: number };
    };
  };
};

/** JSON conversion of ROS2 `sensor_msgs/msg/Imu` (only the fields we consume). */
export type ImuPayload = {
  header?: { frame_id?: string; stamp?: { sec?: number; nanosec?: number } };
  orientation?: Quaternion;
  angular_velocity?: { x?: number; y?: number; z?: number };
  linear_acceleration?: { x?: number; y?: number; z?: number };
};

/** ROS header stamp to epoch milliseconds; undefined when unset (all zeros). */
export function rosStampToMs(stamp?: { sec?: number; nanosec?: number }): number | undefined {
  const sec = stamp?.sec ?? 0;
  const nanosec = stamp?.nanosec ?? 0;
  if (sec === 0 && nanosec === 0) return undefined;
  return sec * 1000 + nanosec / 1e6;
}

/**
 * Yaw (rotation about Z, ZYX convention) of a quaternion, in degrees within (-180, 180].
 */
export function quaternionToYawDegrees(q: Quaternion): number {
  const x = q.x ?? 0;
  const y = q.y ?? 0;
  const z = q.z ?? 0;
  const w = q.w ?? 1;
  const yawRad = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  return (yawRad * 180) / Math.PI;
}
