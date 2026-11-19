import { expect, it, vi } from 'vitest';
import {
  VoiceSession,
  type VoiceDeps,
  type VoiceParticipant,
  type VoiceRoom,
  type VoiceTextReader,
} from '../src/lib/voice/voice-session';
import { PROVENANCE_TOPIC, SET_ROBOT_RPC, TRANSCRIPTION_TOPIC } from '../src/lib/voice/voice-types';

type Handler = (reader: VoiceTextReader, sender: { identity: string }) => void;

class FakeRoom implements VoiceRoom {
  events: string[] = [];
  mic = false;
  connected = false;
  rpc: { destinationIdentity: string; method: string; payload: string }[] = [];
  rpcFails = false;
  private listeners = new Map<string, ((...args: never[]) => void)[]>();
  private streams = new Map<string, Handler>();
  remoteParticipants = new Map<string, VoiceParticipant>();
  localParticipant = {
    identity: 'hey-ros-user-1',
    setMicrophoneEnabled: async (enabled: boolean) => {
      this.mic = enabled;
      this.events.push(enabled ? 'mic-on' : 'mic-off');
    },
    performRpc: async (request: {
      destinationIdentity: string;
      method: string;
      payload: string;
    }) => {
      this.rpc.push(request);
      if (this.rpcFails) throw new Error('rpc failed');
      return request.payload;
    },
  };
  async connect() {
    this.connected = true;
    this.events.push('connect');
  }
  async disconnect() {
    this.connected = false;
    this.events.push('disconnect');
  }
  async startAudio() {}
  on(event: string, listener: (...args: never[]) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }
  registerTextStreamHandler(topic: string, handler: Handler) {
    this.streams.set(topic, handler);
  }
  emit(event: string, ...args: unknown[]) {
    for (const listener of this.listeners.get(event) ?? []) listener(...(args as never[]));
  }
  agent(state?: string) {
    const agent: VoiceParticipant = {
      identity: 'agent-1',
      isAgent: true,
      attributes: state ? { 'lk.agent.state': state } : {},
    };
    this.remoteParticipants.set(agent.identity, agent);
    this.emit('participantAttributesChanged', {}, agent);
    return agent;
  }
  async stream(topic: string, sender: string, chunks: string[], attributes = {}, id = 's1') {
    const reader = {
      info: { id, attributes },
      async *[Symbol.asyncIterator]() {
        yield* chunks;
      },
    };
    this.streams.get(topic)?.(reader, { identity: sender });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function setup(overrides: Partial<VoiceDeps> = {}) {
  const rooms: FakeRoom[] = [];
  const detached = vi.fn();
  const deps: VoiceDeps = {
    createRoom: () => {
      const room = new FakeRoom();
      rooms.push(room);
      return room;
    },
    requestSession: vi.fn(async (robot: string) => ({
      server_url: 'wss://example',
      token: 't',
      room_name: 'hey-ros-1',
      identity: 'hey-ros-user-1',
      robot,
    })),
    requestMicrophone: vi.fn(async () => {}),
    attachAudio: vi.fn(() => detached),
    agentTimeoutMs: 30,
    ...overrides,
  };
  const session = new VoiceSession(deps);
  const states: string[] = [];
  session.subscribe(() => {
    const state = session.snapshot().state;
    if (states.at(-1) !== state) states.push(state);
  });
  return { session, rooms, deps, states, detached };
}

it('walks idle → permission → connecting → listening → thinking → speaking → idle', async () => {
  const { session, rooms, states, detached, deps } = setup();
  await session.start('robot-a');
  const room = rooms[0];
  expect(room.events).toEqual(['connect', 'mic-on']);
  expect(session.snapshot().state).toBe('connecting');
  room.agent('initializing');
  expect(session.snapshot().state).toBe('connecting');
  for (const state of ['listening', 'thinking', 'speaking', 'listening']) room.agent(state);
  room.emit('trackSubscribed', { kind: 'audio' });
  expect(deps.attachAudio).toHaveBeenCalledTimes(1);
  await session.stop();
  expect(states).toEqual([
    'requesting_permission',
    'connecting',
    'listening',
    'thinking',
    'speaking',
    'listening',
    'idle',
  ]);
  // The microphone goes off before the connection is torn down.
  expect(room.events.slice(-2)).toEqual(['mic-off', 'disconnect']);
  expect(room.mic).toBe(false);
  expect(detached).toHaveBeenCalledTimes(1);
});

it('starts one session however many times the mic is clicked', async () => {
  const { session, rooms, deps } = setup();
  await Promise.all([session.start('robot-a'), session.start('robot-a'), session.start('robot-a')]);
  await session.start('robot-a');
  expect(deps.requestSession).toHaveBeenCalledTimes(1);
  expect(rooms).toHaveLength(1);
});

it('reports a denied or missing microphone without connecting', async () => {
  for (const [name, message] of [
    ['NotAllowedError', /denied/],
    ['NotFoundError', /No microphone/],
  ] as const) {
    const { session, rooms, deps } = setup({
      requestMicrophone: async () => {
        throw Object.assign(new Error('x'), { name });
      },
    });
    await session.start('robot-a');
    expect(session.snapshot()).toMatchObject({
      state: 'error',
      error: expect.stringMatching(message),
    });
    expect(deps.requestSession).not.toHaveBeenCalled();
    expect(rooms).toHaveLength(0);
    // The error is recoverable: the next click tries again.
    expect(session.active).toBe(false);
  }
});

it('needs a robot, and surfaces server refusals', async () => {
  const none = setup();
  await none.session.start('');
  expect(none.session.snapshot().error).toBe('Select a robot first.');
  expect(none.deps.requestMicrophone).not.toHaveBeenCalled();
  const refused = setup({
    requestSession: async () => {
      throw new Error('That robot is not in the room.');
    },
  });
  await refused.session.start('ghost');
  expect(refused.session.snapshot()).toMatchObject({
    state: 'error',
    error: 'That robot is not in the room.',
  });
});

it('gives up when no agent answers and releases the microphone', async () => {
  const { session, rooms } = setup();
  await session.start('robot-a');
  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(session.snapshot()).toMatchObject({
    state: 'error',
    error: expect.stringMatching(/agent worker/),
  });
  expect(rooms[0].events.slice(-2)).toEqual(['mic-off', 'disconnect']);
});

it('a stop during startup leaves nothing connected', async () => {
  let release!: () => void;
  const { session, rooms } = setup({
    requestMicrophone: () => new Promise<void>((resolve) => (release = resolve)),
  });
  const starting = session.start('robot-a');
  await session.stop();
  release();
  await starting;
  expect(session.snapshot().state).toBe('idle');
  expect(rooms).toHaveLength(0);
});

it('retargets the running agent over RPC when the robot changes', async () => {
  const { session, rooms } = setup();
  await session.start('robot-a');
  const room = rooms[0];
  room.agent('listening');
  await session.setRobot('robot-a');
  expect(room.rpc).toHaveLength(0);
  await session.setRobot('robot-b');
  expect(room.rpc).toEqual([
    expect.objectContaining({
      destinationIdentity: 'agent-1',
      method: SET_ROBOT_RPC,
      payload: '{"robot":"robot-b"}',
    }),
  ]);
  expect(session.snapshot()).toMatchObject({ robot: 'robot-b', state: 'listening' });
  expect(rooms).toHaveLength(1);
});

it('stops instead of answering for the old robot when a switch fails or the robot is cleared', async () => {
  const failed = setup();
  await failed.session.start('robot-a');
  failed.rooms[0].agent('listening');
  failed.rooms[0].rpcFails = true;
  await failed.session.setRobot('robot-b');
  expect(failed.session.snapshot()).toMatchObject({ state: 'error', robot: 'robot-a' });
  expect(failed.rooms[0].connected).toBe(false);
  const cleared = setup();
  await cleared.session.start('robot-a');
  cleared.rooms[0].agent('listening');
  await cleared.session.setRobot('');
  expect(cleared.session.snapshot().state).toBe('idle');
  expect(cleared.rooms[0].mic).toBe(false);
});

it('restarts for the new robot if the switch comes before the agent has joined', async () => {
  const { session, rooms, deps } = setup();
  await session.start('robot-a');
  await session.setRobot('robot-b');
  expect(rooms).toHaveLength(2);
  expect(rooms[0].connected).toBe(false);
  expect(deps.requestSession).toHaveBeenLastCalledWith('robot-b');
  expect(session.snapshot().robot).toBe('robot-b');
});

it('builds the transcript with the evidence behind each answer', async () => {
  const { session, rooms } = setup();
  await session.start('robot-a');
  const room = rooms[0];
  room.agent('listening');
  const user = { 'lk.segment_id': 'u1', 'lk.transcription_final': 'false' };
  await room.stream(TRANSCRIPTION_TOPIC, 'hey-ros-user-1', ['hey ros what'], user);
  expect(session.snapshot().transcript).toEqual([
    { id: 'user:u1', role: 'user', text: 'hey ros what', final: false },
  ]);
  await room.stream(
    TRANSCRIPTION_TOPIC,
    'hey-ros-user-1',
    ["Hey ROS, what's your battery level?"],
    {
      ...user,
      'lk.transcription_final': 'true',
    },
  );
  const rows = [
    {
      robot: 'robot-a',
      track: '/battery_state',
      field: 'percentage',
      display: '73 percent',
      age_ms: 180,
    },
  ];
  await room.stream(PROVENANCE_TOPIC, 'agent-1', [
    JSON.stringify({ tool: 'get_battery_status', rows }),
  ]);
  await room.stream(TRANSCRIPTION_TOPIC, 'agent-1', ['Robot A is at ', '73 percent battery.'], {
    'lk.segment_id': 'a1',
    'lk.transcription_final': 'false',
  });
  expect(session.snapshot().transcript).toEqual([
    { id: 'user:u1', role: 'user', text: "Hey ROS, what's your battery level?", final: true },
    {
      id: 'agent:a1',
      role: 'agent',
      text: 'Robot A is at 73 percent battery.',
      final: true,
      provenance: rows,
    },
  ]);
  // Evidence belongs to one answer; the next one starts clean.
  await room.stream(PROVENANCE_TOPIC, 'agent-1', ['{"rows":[],"error":"STALE"}']);
  await room.stream(PROVENANCE_TOPIC, 'agent-1', ['not json']);
  await room.stream(TRANSCRIPTION_TOPIC, 'agent-1', ["I don't have a recent reading."], {
    'lk.segment_id': 'a2',
  });
  expect(session.snapshot().transcript[2]).toEqual({
    id: 'agent:a2',
    role: 'agent',
    text: "I don't have a recent reading.",
    final: true,
    unavailable: 'STALE',
  });
});

it('ends with an error when the agent leaves or the room drops', async () => {
  for (const event of ['participantDisconnected', 'disconnected']) {
    const { session, rooms } = setup();
    await session.start('robot-a');
    const agent = rooms[0].agent('listening');
    rooms[0].emit(event, agent);
    expect(session.snapshot().state).toBe('error');
    expect(rooms[0].mic).toBe(false);
    // Events from the dead room no longer change anything.
    rooms[0].agent('speaking');
    expect(session.snapshot().state).toBe('error');
  }
});
