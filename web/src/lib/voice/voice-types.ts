/** Shared between the voice session route, the browser controller and the mic UI. */

export const PROVENANCE_TOPIC = 'hey-ros.provenance';
export const TRANSCRIPTION_TOPIC = 'lk.transcription';
export const SET_ROBOT_RPC = 'hey_ros.set_robot';

export type VoiceState =
  | 'idle'
  | 'requesting_permission'
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'error';

export type VoiceCredentials = {
  server_url: string;
  token: string;
  room_name: string;
  identity: string;
  robot: string;
};

/** One reading the agent used, as sent on PROVENANCE_TOPIC. */
export type ProvenanceRow = {
  robot?: string;
  track: string;
  field: string;
  display?: string;
  age_ms: number;
};

export type TranscriptEntry = {
  id: string;
  role: 'user' | 'agent';
  text: string;
  final: boolean;
  /** Evidence for an agent answer: which tracks it read and how old the samples were. */
  provenance?: ProvenanceRow[];
  /** Set when a tool reported that the data was unavailable. */
  unavailable?: string;
};

export type VoiceSnapshot = {
  state: VoiceState;
  error: string;
  robot: string;
  transcript: TranscriptEntry[];
};
