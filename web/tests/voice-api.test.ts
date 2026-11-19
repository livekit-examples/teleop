import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TokenVerifier } from 'livekit-server-sdk';

const SECRET = 'test-secret-that-is-long-enough-for-hs256';
vi.mock('node:fs', () => ({
  existsSync: () => true,
  readFileSync: () =>
    [
      'LIVEKIT_URL=wss://example.livekit.cloud',
      'LIVEKIT_API_KEY=devkey',
      `LIVEKIT_API_SECRET=${SECRET}`,
      'LIVEKIT_ROOM_NAME=robo-sims-space',
    ].join('\n'),
}));
const listed = vi.fn();
vi.mock('livekit-server-sdk', async (original) => ({
  ...(await original<typeof import('livekit-server-sdk')>()),
  RoomServiceClient: class {
    listParticipants = listed;
  },
}));

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://localhost:3000/api/voice/session', {
    method: 'POST',
    headers: { origin: 'http://localhost:3000', host: 'localhost:3000', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

beforeEach(() => {
  vi.resetModules();
  listed.mockReset().mockResolvedValue([
    { identity: 'robot-a', attributes: { 'lk.portal.role': 'robot' } },
    { identity: 'controller-curie', attributes: { 'lk.portal.role': 'operator' } },
    // The server SDK returns attribute keys camel-cased.
    { identity: 'robot-b', attributes: { lkPortalRole: 'robot' } },
    { identity: 'controller-salk', attributes: { lkPortalRole: 'operator' } },
  ]);
});
afterEach(() => vi.unstubAllEnvs());

it('mints a private voice room whose token dispatches the agent with server-chosen scope', async () => {
  const { POST } = await import('../src/app/api/voice/session/route');
  const response = await POST(post({ robot: 'robot-a', room: 'evil', identity: 'evil' }));
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  const data = await response.json();
  expect(data.room_name).toMatch(/^hey-ros-[a-f0-9]{16}$/);
  expect(data.identity).toBe(data.room_name.replace('hey-ros-', 'hey-ros-user-'));
  expect(listed).toHaveBeenCalledWith('robo-sims-space');
  const claims = await new TokenVerifier('devkey', SECRET).verify(data.token);
  expect(claims.sub).toBe(data.identity);
  expect(claims.video).toMatchObject({
    room: data.room_name,
    roomJoin: true,
    canSubscribe: true,
    canPublishSources: ['microphone'],
  });
  // The voice token gives no access to the robot room.
  expect(claims.video?.room).not.toBe('robo-sims-space');
  const config = claims.roomConfig as unknown as {
    maxParticipants: number;
    agents: { agentName: string; metadata: string }[];
  };
  expect(config.maxParticipants).toBe(2);
  expect(config.agents).toHaveLength(1);
  expect(config.agents[0].agentName).toBe('hey-ros');
  expect(JSON.parse(config.agents[0].metadata)).toEqual({
    robot_room: 'robo-sims-space',
    robot_identity: 'robot-a',
    user_identity: data.identity,
  });
});

it('gives every session its own room, so two users never share audio', async () => {
  const { POST } = await import('../src/app/api/voice/session/route');
  const a = await (await POST(post({ robot: 'robot-a' }))).json();
  const b = await (await POST(post({ robot: 'robot-a' }))).json();
  expect(a.room_name).not.toBe(b.room_name);
  expect(a.identity).not.toBe(b.identity);
});

it('refuses robots that are not robots in the server room', async () => {
  const { POST } = await import('../src/app/api/voice/session/route');
  expect((await POST(post({ robot: 'controller-curie' }))).status).toBe(404);
  expect((await POST(post({ robot: 'controller-salk' }))).status).toBe(404);
  expect((await POST(post({ robot: 'robot-b' }))).status).toBe(200);
  expect((await POST(post({ robot: 'ghost' }))).status).toBe(404);
  expect((await POST(post({ robot: '' }))).status).toBe(400);
  expect((await POST(post({ robot: 7 }))).status).toBe(400);
  expect((await POST(post('not json'))).status).toBe(400);
  listed.mockRejectedValue(new Error('down'));
  expect((await POST(post({ robot: 'robot-a' }))).status).toBe(503);
});

it('requires a same-origin request', async () => {
  const { POST } = await import('../src/app/api/voice/session/route');
  expect((await POST(post({ robot: 'robot-a' }, { origin: 'https://evil.example' }))).status).toBe(
    403,
  );
  const bare = new Request('http://localhost:3000/api/voice/session', {
    method: 'POST',
    headers: { host: 'localhost:3000' },
    body: '{"robot":"robot-a"}',
  });
  expect((await POST(bare)).status).toBe(403);
  expect(listed).not.toHaveBeenCalled();
});

it('limits session starts per caller', async () => {
  const { POST } = await import('../src/app/api/voice/session/route');
  const statuses = [];
  for (let i = 0; i < 8; i++) statuses.push((await POST(post({ robot: 'robot-a' }))).status);
  expect(statuses).toEqual([200, 200, 200, 200, 200, 200, 429, 429]);
  const other = await POST(post({ robot: 'robot-a' }, { 'x-forwarded-for': '203.0.113.9' }));
  expect(other.status).toBe(200);
});

it('is off on the public deployment and when disabled', async () => {
  vi.stubEnv('TELEOP_PUBLIC_DEPLOYMENT', '1');
  let route = await import('../src/app/api/voice/session/route');
  expect(await (await route.GET()).json()).toEqual({ enabled: false });
  expect((await route.POST(post({ robot: 'robot-a' }))).status).toBe(404);
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.stubEnv('HEY_ROS_ENABLED', '0');
  route = await import('../src/app/api/voice/session/route');
  expect(await (await route.GET()).json()).toEqual({ enabled: false });
  vi.unstubAllEnvs();
  vi.resetModules();
  route = await import('../src/app/api/voice/session/route');
  expect(await (await route.GET()).json()).toEqual({ enabled: true });
});
