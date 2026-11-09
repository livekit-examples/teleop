export type MediaKind = 'data' | 'video' | 'audio';
export type FieldPath = (string | number)[];
export type Visualization =
  | 'plot'
  | 'value'
  | 'boolean'
  | 'state'
  | 'joints'
  | 'raw'
  | 'video'
  | 'audio';
export type Status =
  | 'not_requested'
  | 'starting'
  | 'healthy'
  | 'stale'
  | 'unmonitored'
  | 'unavailable'
  | 'invalid'
  | 'unsupported'
  | 'excluded';
export type Participant = { identity: string; name?: string; attributes: Record<string, string> };
export type Publication = {
  id: string;
  robot: string;
  kind: MediaKind;
  name: string;
  msgType?: string;
  encoding?: string;
  error?: string;
  /** Optional definition supplied by a supported transport, never inferred from an ID. */
  schema?: { fields: { path: FieldPath; type: string; enum?: Record<string, string> }[] };
};
export type Operation = {
  profile: string;
  control_channel?: string;
  joint_names?: string[];
  command: { track_name: string; msg_type: string; format: 'json' };
  /** All listed tracks are required; discovery defaults an omitted list to []. */
  feedback_tracks: string[];
  presentations: string[];
};
export type ControlInterface = {
  label: string;
  frame_id?: string;
  joint_names?: string[];
  operations: Record<string, Operation>;
};
export type RobotConfig = {
  schema_version: 1;
  label: string;
  default_video_rate_hz: number;
  exclude_data_tracks: string[];
  exclude_video_tracks: string[];
  exclude_audio_tracks: string[];
  control: { scope: 'robot'; ownership: 'portal_active_operator' };
  control_interfaces: Record<string, ControlInterface>;
};
export type Source = {
  kind: MediaKind;
  track_name: string;
  field_path: FieldPath;
  expected_msg_type?: string;
  joint_names?: string[];
};
export type PanelSettings = {
  expected_rate_hz?: number;
  window_seconds?: number;
  enum_labels?: Record<string, string>;
  image_layout?: 'mono' | 'stereo_sbs';
  eye?: 'left' | 'right';
  volume?: number;
  muted?: boolean;
};
export type Panel = {
  visualization: Visualization;
  label: string;
  visible: boolean;
  source: Source;
  settings: PanelSettings;
};
export type PlacementNode =
  | { type: 'group'; id: string; panels: string[]; active: string; weight: number }
  | { type: 'split'; children: PlacementNode[]; weight: number };
export type Placement = {
  version: 1;
  orientation: 'HORIZONTAL' | 'VERTICAL';
  root: PlacementNode;
  floating: { node: PlacementNode; x: number; y: number; width: number; height: number }[];
};
export type Layout = {
  layout_schema_version: 1 | 2;
  label: string;
  robot_identity: string;
  panels: Record<string, Panel>;
  panel_order: string[];
  control_preferences: Record<string, { operation: string; presentation: string }>;
  control_channel_preferences?: Record<
    string,
    Record<string, { operation: string; presentation: string }>
  >;
  controller_hands?: Partial<Record<'left' | 'right', string>>;
  workspace?: Placement;
};
export type Clock = { now(): number; delay(ms: number): Promise<void> };
export const browserClock: Clock = {
  now: () => performance.now(),
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};
export type TransportEvent = 'changed' | 'connected' | 'interrupted' | 'disconnected';
export type CommandWriter = {
  push(value: unknown): void;
  flush(): Promise<void>;
  close(): Promise<void>;
};
export interface Transport {
  readonly identity: string;
  readonly fixture: boolean;
  participants(): Participant[];
  publications(): Publication[];
  onEvent(listener: (event: TransportEvent) => void): () => void;
  rpc(robot: string, method: string, payload: string, timeout: number): Promise<string>;
  read(publication: Publication, signal: AbortSignal): AsyncIterable<Uint8Array>;
  subscribeMedia(publication: Publication, enabled: boolean): void;
  attach(publication: Publication, element: HTMLMediaElement): () => void;
  restrictCommands(robot: string): void;
  publish(operation: Operation): Promise<CommandWriter>;
  disconnect(): Promise<void>;
}
export const endpointKey = (kind: MediaKind, name: string) => JSON.stringify([kind, name]);
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
export function own<T>(map: Record<string, T> | undefined, key: string): T | undefined {
  return map && Object.hasOwn(map, key) ? map[key] : undefined;
}
export const compatibleRobot = (p: Participant) =>
  p.attributes['lk.portal.role'] === 'robot' && p.attributes['lk.portal.version'] === '3';
