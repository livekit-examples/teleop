export type DemoSimulation = {
  id: string;
  summary: string;
  icon: string;
  available: boolean;
  reason?: string;
};
export type DemoRun = {
  id: string;
  simulation_id: string;
  state: 'starting' | 'ready' | 'stopping' | 'stopped' | 'expired' | 'failed';
  created_at: number;
  ready_at?: number;
  expires_at?: number;
  reason?: string;
};
export type JointLimit = { min: number; max: number; max_velocity: number };
export type SimulationPolicy = {
  profile: 'joints.trajectory.v1';
  max_feedback_age_ms: number;
  interfaces: Record<string, Record<string, JointLimit>>;
};
export type DemoCredentials = {
  server_url: string;
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
