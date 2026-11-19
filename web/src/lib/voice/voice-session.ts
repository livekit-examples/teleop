import {
  PROVENANCE_TOPIC,
  SET_ROBOT_RPC,
  TRANSCRIPTION_TOPIC,
  type ProvenanceRow,
  type TranscriptEntry,
  type VoiceCredentials,
  type VoiceSnapshot,
  type VoiceState,
} from './voice-types';

/**
 * The slice of a LiveKit room this controller needs. `livekit-client`'s Room satisfies it; tests
 * pass a fake, so the state machine runs without a browser or a server.
 */
export type VoiceParticipant = {
  identity: string;
  isAgent?: boolean;
  attributes: Record<string, string>;
};
export type VoiceTextReader = AsyncIterable<string> & {
  info: { id: string; attributes?: Record<string, string> };
};
export type VoiceRoom = {
  localParticipant: {
    identity: string;
    setMicrophoneEnabled(enabled: boolean): Promise<unknown>;
    performRpc(request: {
      destinationIdentity: string;
      method: string;
      payload: string;
      responseTimeout?: number;
    }): Promise<string>;
  };
  remoteParticipants: Map<string, VoiceParticipant>;
  connect(url: string, token: string): Promise<unknown>;
  disconnect(): Promise<unknown>;
  startAudio(): Promise<unknown>;
  on(event: string, listener: (...args: never[]) => void): unknown;
  registerTextStreamHandler(
    topic: string,
    handler: (reader: VoiceTextReader, sender: { identity: string }) => void,
  ): void;
};
export type VoiceDeps = {
  createRoom(): VoiceRoom;
  /** POST /api/voice/session. Rejects with a message fit for the user. */
  requestSession(robot: string): Promise<VoiceCredentials>;
  /** Ask for the microphone before anything is connected. Rejects with a DOMException. */
  requestMicrophone(): Promise<void>;
  /** Play a subscribed agent audio track; returns the detach function. */
  attachAudio(track: unknown): () => void;
  agentTimeoutMs?: number;
};

const MAX_TRANSCRIPT = 40;
const AGENT_STATES: Record<string, VoiceState> = {
  listening: 'listening',
  thinking: 'thinking',
  speaking: 'speaking',
};

function microphoneMessage(error: unknown) {
  const name = (error as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Microphone access was denied. Allow it in the browser to talk to Hey ROS.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return 'No microphone was found.';
  return 'The microphone could not be started.';
}

/** One user's voice conversation with Hey ROS, in a private room separate from the robot room. */
export class VoiceSession {
  private value: VoiceSnapshot = { state: 'idle', error: '', robot: '', transcript: [] };
  private listeners = new Set<() => void>();
  private room?: VoiceRoom;
  private detach: (() => void)[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private pending: { rows: ProvenanceRow[]; unavailable?: string } = { rows: [] };
  // Every start and stop gets a new attempt number; stale async work checks it and backs out.
  private attempt = 0;

  constructor(private deps: VoiceDeps) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.value;
  get active() {
    return this.value.state !== 'idle' && this.value.state !== 'error';
  }

  private set(patch: Partial<VoiceSnapshot>) {
    this.value = { ...this.value, ...patch };
    for (const listener of this.listeners) listener();
  }

  /** Start, or do nothing if a session is already starting or running: one click, one agent. */
  async start(robot: string) {
    if (this.active) return;
    if (!robot) {
      this.set({ state: 'error', error: 'Select a robot first.' });
      return;
    }
    const attempt = ++this.attempt;
    const current = () => attempt === this.attempt;
    this.pending = { rows: [] };
    this.set({ state: 'requesting_permission', error: '', robot, transcript: [] });
    try {
      await this.deps.requestMicrophone();
    } catch (error) {
      if (current()) this.set({ state: 'error', error: microphoneMessage(error) });
      return;
    }
    if (!current()) return;
    this.set({ state: 'connecting' });
    let room: VoiceRoom | undefined;
    try {
      const credentials = await this.deps.requestSession(robot);
      if (!current()) return;
      room = this.deps.createRoom();
      this.room = room;
      this.bind(room, attempt);
      await room.connect(credentials.server_url, credentials.token);
      if (!current()) return void room.disconnect();
      await room.startAudio().catch(() => {});
      await room.localParticipant.setMicrophoneEnabled(true);
      if (!current()) return void room.disconnect();
    } catch (error) {
      if (!current()) return;
      await this.teardown();
      const denied = ['NotAllowedError', 'NotFoundError'].includes((error as Error)?.name);
      this.set({
        state: 'error',
        error: denied
          ? microphoneMessage(error)
          : (error as Error)?.message || 'Could not start the voice session.',
      });
      return;
    }
    this.timer = setTimeout(() => {
      if (!current() || this.value.state !== 'connecting') return;
      void this.teardown();
      this.set({
        state: 'error',
        error: 'Hey ROS did not answer. Check that the agent worker is running.',
      });
    }, this.deps.agentTimeoutMs ?? 20_000);
    this.syncAgent(room);
  }

  /** End the session. The microphone stops first, before any network teardown. */
  async stop() {
    this.attempt++;
    await this.teardown();
    this.set({ state: 'idle', error: '' });
  }

  toggle(robot: string) {
    return this.active ? this.stop() : this.start(robot);
  }

  /** Point the running agent at another robot. Old-robot data is dropped on the agent first. */
  async setRobot(robot: string) {
    if (!this.active || robot === this.value.robot) return;
    if (!robot) return this.stop();
    const room = this.room;
    const agent = room && this.agent(room);
    // Not connected yet: restart cleanly for the new robot rather than answer for the old one.
    if (!room || !agent || this.value.state === 'connecting') {
      await this.stop();
      return this.start(robot);
    }
    const attempt = this.attempt;
    try {
      await room.localParticipant.performRpc({
        destinationIdentity: agent.identity,
        method: SET_ROBOT_RPC,
        payload: JSON.stringify({ robot }),
        responseTimeout: 5000,
      });
      if (attempt === this.attempt) this.set({ robot });
    } catch {
      if (attempt !== this.attempt) return;
      this.attempt++;
      await this.teardown();
      this.set({ state: 'error', error: `Hey ROS could not switch to ${robot}. Start it again.` });
    }
  }

  private agent(room: VoiceRoom) {
    return [...room.remoteParticipants.values()].find(
      (p) => p.isAgent || 'lk.agent.state' in p.attributes,
    );
  }

  private syncAgent(room: VoiceRoom | undefined) {
    if (!room || room !== this.room || !this.active) return;
    const next = AGENT_STATES[this.agent(room)?.attributes['lk.agent.state'] ?? ''];
    if (!next || next === this.value.state) return;
    clearTimeout(this.timer);
    this.set({ state: next });
  }

  private bind(room: VoiceRoom, attempt: number) {
    const current = () => attempt === this.attempt;
    const sync = () => current() && this.syncAgent(room);
    room.on('participantConnected', sync);
    room.on('participantAttributesChanged', sync);
    room.on('trackSubscribed', ((track: { kind?: string }) => {
      if (current() && track.kind === 'audio') this.detach.push(this.deps.attachAudio(track));
    }) as never);
    const ended = (message: string) => {
      if (!current() || !this.active) return;
      this.attempt++;
      void this.teardown();
      this.set({ state: 'error', error: message });
    };
    room.on('participantDisconnected', ((participant: VoiceParticipant) => {
      if (participant.isAgent || 'lk.agent.state' in participant.attributes)
        ended('Hey ROS left the session. Start it again.');
    }) as never);
    room.on('disconnected', () => ended('The voice session was disconnected.'));
    room.on('reconnecting', () => current() && this.active && this.set({ state: 'connecting' }));
    room.on('reconnected', sync);
    room.registerTextStreamHandler(TRANSCRIPTION_TOPIC, (reader, sender) => {
      if (current()) void this.readTranscript(room, reader, sender.identity, current);
    });
    room.registerTextStreamHandler(PROVENANCE_TOPIC, (reader) => {
      if (current()) void this.readProvenance(reader, current);
    });
  }

  private async readTranscript(
    room: VoiceRoom,
    reader: VoiceTextReader,
    sender: string,
    current: () => boolean,
  ) {
    const attributes = reader.info.attributes ?? {};
    const role = sender === room.localParticipant.identity ? 'user' : 'agent';
    const id = `${role}:${attributes['lk.segment_id'] || reader.info.id}`;
    let text = '';
    const write = (final: boolean) => {
      if (!current() || !text.trim()) return;
      const transcript = [...this.value.transcript];
      const at = transcript.findIndex((entry) => entry.id === id);
      const entry: TranscriptEntry = { ...transcript[at], id, role, text: text.trim(), final };
      if (at < 0 && role === 'agent' && (this.pending.rows.length || this.pending.unavailable)) {
        // The tools ran just before this answer: show what it was grounded in.
        if (this.pending.rows.length) entry.provenance = this.pending.rows;
        entry.unavailable = this.pending.unavailable;
        this.pending = { rows: [] };
      }
      if (at < 0) transcript.push(entry);
      else transcript[at] = entry;
      this.set({ transcript: transcript.slice(-MAX_TRANSCRIPT) });
    };
    try {
      // The agent replaces a segment with its final text under the same segment id.
      for await (const chunk of reader) {
        text += chunk;
        write(false);
      }
    } catch {
      /* A dropped stream keeps whatever text arrived. */
    }
    // Agent speech is one delta stream that ends with the turn; user speech is resent whole,
    // marked final on its last version.
    write(role === 'agent' || attributes['lk.transcription_final'] === 'true');
  }

  private async readProvenance(reader: VoiceTextReader, current: () => boolean) {
    let text = '';
    try {
      for await (const chunk of reader) text += chunk;
      const body = JSON.parse(text) as { rows?: ProvenanceRow[]; error?: string | null };
      if (!current()) return;
      const rows = (Array.isArray(body.rows) ? body.rows : []).filter(
        (row) => row && typeof row.track === 'string' && typeof row.age_ms === 'number',
      );
      this.pending = {
        rows: [...this.pending.rows, ...rows].slice(-8),
        unavailable: body.error ?? this.pending.unavailable,
      };
    } catch {
      /* Provenance is supplementary; a bad message is dropped. */
    }
  }

  private async teardown() {
    clearTimeout(this.timer);
    const room = this.room;
    this.room = undefined;
    for (const detach of this.detach.splice(0)) detach();
    if (!room) return;
    await room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
    await room.disconnect().catch(() => {});
  }
}
