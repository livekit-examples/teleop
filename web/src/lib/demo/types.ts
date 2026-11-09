export type DemoSimulation = {
  id: string;
  summary: string;
  icon: string;
  available: boolean;
  duration_seconds?: number;
  fps?: number;
  reason?: string;
};
export type DemoRun = {
  id: string;
  simulation_id: string;
  state: 'queued' | 'starting' | 'ready' | 'stopping' | 'stopped' | 'expired' | 'failed';
  created_at: number;
  queued_at?: number;
  queue_expires_at?: number;
  queue_position?: number | null;
  queue_length?: number | null;
  estimated_wait_seconds?: number | null;
  duration_seconds?: number;
  fps?: number;
  ready_at?: number;
  expires_at?: number;
  reason?: string;
};
export type JointLimit = { min: number; max: number; max_velocity: number };
export type LegacySimulationPolicy = {
  profile: 'joints.trajectory.v1';
  max_feedback_age_ms: number;
  interfaces: Record<string, Record<string, JointLimit>>;
};
export type PositionCapability = {
  profile: 'joints.trajectory.v1' | 'gripper.position.v1';
  control_channel: string;
  joint_names: string[];
  units: 'm' | 'rad';
  joints: Record<string, JointLimit>;
  coordinate_label?: string;
  open_position?: number;
  closed_position?: number;
};
export type PositionSimulationPolicy = {
  version: 2;
  max_feedback_age_ms: number;
  operations: Record<string, Record<string, PositionCapability>>;
};
export type RacingPolicy = {
  version: 1;
  kind: 'rc.ackermann.v1';
  interface_id: 'base';
  operation_id: 'drive';
  command_track: '/ackermann_cmd';
  profile: 'base.ackermann_drive.v1';
  control_channel: 'primary';
  min_speed: number;
  max_speed: number;
  max_steering_angle: number;
  max_steering_rate: number;
  steering_input_exponent?: number;
  max_acceleration: number;
  max_braking: number;
  command_timeout_ms: number;
  input_interval_ms: number;
  neutral: 'brake_and_center';
  state_track: '/vehicle_state';
};
export type SimulationPolicy = LegacySimulationPolicy | PositionSimulationPolicy | RacingPolicy;
export type DemoCredentials = {
  server_url: string;
  room_name: string;
  duration_seconds: number;
  token: string;
  robot_identity: string;
  expires_at: number;
  mode: 'preview' | 'control';
  policy: SimulationPolicy | null;
};
export async function demoRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/demo/${path}`, {
    ...init,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'The simulation request failed.');
  return data;
}
