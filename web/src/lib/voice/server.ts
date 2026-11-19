import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { RoomAgentDispatch, RoomConfiguration } from '@livekit/protocol';
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import type { VoiceCredentials } from './voice-types';

/** A failure with the HTTP status the route should return. */
export class VoiceError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Env = Record<string, string | undefined>;

// Same precedence as /api/credentials: `.env.local` wins over the process environment.
function readEnv(): Env {
  const path = join(process.cwd(), '.env.local');
  const local = existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {};
  return { ...process.env, ...local };
}

/** Off on the public deployment, and wherever HEY_ROS_ENABLED=0. */
export function voiceEnabled(env: Env = readEnv()) {
  return env.TELEOP_PUBLIC_DEPLOYMENT !== '1' && env.HEY_ROS_ENABLED !== '0';
}

// livekit-server-sdk 2.15 camel-cases the keys of attribute maps it reads over Twirp
// ("lk.portal.role" arrives as "lkPortalRole"), so accept either spelling.
function portalRole(attributes: Record<string, string> | undefined) {
  return attributes?.['lk.portal.role'] ?? attributes?.lkPortalRole;
}

const WINDOW_MS = 60_000;
const starts = new Map<string, number[]>();

/** A small in-process limit: each session start spends speech and model inference. */
export function allowStart(caller: string, limit: number, now = Date.now()) {
  const recent = (starts.get(caller) ?? []).filter((at) => now - at < WINDOW_MS);
  if (recent.length >= limit) {
    starts.set(caller, recent);
    return false;
  }
  recent.push(now);
  starts.set(caller, recent);
  if (starts.size > 5000) for (const key of starts.keys()) if (key !== caller) starts.delete(key);
  return true;
}
export function resetLimits() {
  starts.clear();
}

/**
 * Create one private voice session: a fresh room for this user and the agent only.
 *
 * The token itself dispatches the agent when it creates the room, so a repeated click cannot
 * add a second agent to a room, and the browser never names the robot room or its own identity.
 */
export async function createVoiceSession(
  robot: unknown,
  caller: string,
): Promise<VoiceCredentials> {
  const env = readEnv();
  if (!voiceEnabled(env)) throw new VoiceError(404, 'The voice assistant is disabled.');
  if (typeof robot !== 'string' || !robot || robot.length > 256)
    throw new VoiceError(400, 'Select a robot first.');
  const url = env.LIVEKIT_URL;
  const apiKey = env.LIVEKIT_API_KEY;
  const apiSecret = env.LIVEKIT_API_SECRET;
  const robotRoom = env.LIVEKIT_ROOM_NAME;
  if (!url || !apiKey || !apiSecret || !robotRoom)
    throw new VoiceError(500, 'Server misconfigured.');
  if (!allowStart(caller, Number(env.HEY_ROS_STARTS_PER_MINUTE) || 6))
    throw new VoiceError(429, 'Too many voice sessions. Wait a minute and try again.');

  // The robot must be a robot in the server's own room; the client's word is not enough.
  let present = false;
  try {
    const participants = await new RoomServiceClient(url, apiKey, apiSecret).listParticipants(
      robotRoom,
    );
    present = participants.some(
      (p) => p.identity === robot && portalRole(p.attributes) === 'robot',
    );
  } catch {
    throw new VoiceError(503, 'Could not reach the robot room.');
  }
  if (!present) throw new VoiceError(404, 'That robot is not in the room.');

  const session = randomBytes(8).toString('hex');
  const roomName = `hey-ros-${session}`;
  const identity = `hey-ros-user-${session}`;
  const at = new AccessToken(apiKey, apiSecret, { identity, ttl: '10m' });
  at.addGrant({
    roomJoin: true,
    room: roomName,
    canSubscribe: true,
    canPublish: true,
    canPublishSources: [TrackSource.MICROPHONE],
    // RPC (robot switching) travels as data.
    canPublishData: true,
  });
  at.roomConfig = new RoomConfiguration({
    // The user and the agent. Nobody else can join, with or without the room name.
    maxParticipants: 2,
    emptyTimeout: 30,
    departureTimeout: 10,
    agents: [
      new RoomAgentDispatch({
        agentName: env.HEY_ROS_AGENT_NAME || 'hey-ros',
        metadata: JSON.stringify({
          robot_room: robotRoom,
          robot_identity: robot,
          user_identity: identity,
        }),
      }),
    ],
  });
  return { server_url: url, token: await at.toJwt(), room_name: roomName, identity, robot };
}
