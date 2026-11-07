import { NextResponse } from 'next/server';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { randomInt } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { SCIENTIST_NAMES } from './scientist-names';

export const dynamic = 'force-dynamic' as const;

type Credentials = {
  url: string;
  apiKey: string;
  apiSecret: string;
  roomName: string;
  userPass: string;
};

// If `.env.local` exists, its values win over the process environment.
// Next.js alone does the opposite: it never overrides variables that are
// already set. Without the file, only the process environment is used.
function loadEnvLocal(): Record<string, string | undefined> {
  const path = join(process.cwd(), '.env.local');
  if (!existsSync(path)) return {};
  return parseEnv(readFileSync(path, 'utf8'));
}

function requiredEnv(name: string, envLocal: Record<string, string | undefined>): string {
  const value = envLocal[name] ?? process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function loadCredentials(): Credentials {
  const envLocal = loadEnvLocal();
  return {
    url: requiredEnv('LIVEKIT_URL', envLocal),
    apiKey: requiredEnv('LIVEKIT_API_KEY', envLocal),
    apiSecret: requiredEnv('LIVEKIT_API_SECRET', envLocal),
    roomName: requiredEnv('LIVEKIT_ROOM_NAME', envLocal),
    userPass: requiredEnv('LIVEKIT_USER_PASS', envLocal),
  };
}

// Module scope: evaluated once when the server process starts (not on each
// request). Set the LIVEKIT_* variables in `.env.local` or in the process
// environment. `.env.local` takes priority when it exists.
let cachedCredentials: Credentials | null = null;

function getCredentials(): Credentials {
  cachedCredentials ??= loadCredentials();
  return cachedCredentials;
}

// Short-lived operator token: minted per connection attempt, so it only needs
// to survive the initial Room.connect() handshake.
const TOKEN_TTL = '10m';

// Every connection gets its own identity, controller-<scientist>, in the
// style of Docker container names. The robot can then tell pages apart and
// give arm control to one of them. The robot accepts control only from
// identities with this prefix (see --controller-prefix).
const IDENTITY_PREFIX = 'controller-';
const IDENTITY_ATTEMPTS = 20;

function pick<T>(items: readonly T[]): T {
  return items[randomInt(items.length)];
}

// Two pages must not get the same identity. LiveKit would remove the older
// page from the room, and the robot would free its control. So pick a name
// that no participant in the room uses. If every name is in use, add a
// number to a random name.
async function newIdentity(credentials: Credentials): Promise<string> {
  let taken = new Set<string>();
  try {
    const rooms = new RoomServiceClient(credentials.url, credentials.apiKey, credentials.apiSecret);
    const participants = await rooms.listParticipants(credentials.roomName);
    taken = new Set(participants.map((participant) => participant.identity));
  } catch {
    // The room does not exist yet, or the lookup failed. Any name works.
  }
  const free = SCIENTIST_NAMES.map((name) => `${IDENTITY_PREFIX}${name}`).filter(
    (identity) => !taken.has(identity),
  );
  if (free.length > 0) return pick(free);

  const numbered = () => `${IDENTITY_PREFIX}${pick(SCIENTIST_NAMES)}-${randomInt(2, 100)}`;
  let identity = numbered();
  for (let attempt = 1; attempt < IDENTITY_ATTEMPTS && taken.has(identity); attempt += 1) {
    identity = numbered();
  }
  return identity;
}

export async function GET(request: Request) {
  let credentials: Credentials;
  try {
    credentials = getCredentials();
  } catch (error) {
    console.error('Misconfigured server credentials:', error);
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const password = authHeader.slice('Bearer '.length);
  if (!password || password !== credentials.userPass) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const at = new AccessToken(credentials.apiKey, credentials.apiSecret, {
    identity: await newIdentity(credentials),
    ttl: TOKEN_TTL,
  });
  at.addGrant({
    roomJoin: true,
    room: credentials.roomName,
    // The workspace advertises its operator capabilities via setAttributes().
    canUpdateOwnMetadata: true,
  });

  const token = await at.toJwt();
  const response = {
    server_url: credentials.url,
    token,
  };

  return NextResponse.json(response, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
