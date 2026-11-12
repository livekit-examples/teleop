import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { TokenVerifier } from 'livekit-server-sdk';

vi.mock('node:fs', () => ({
  existsSync: () => true,
  readFileSync: () =>
    [
      'LIVEKIT_URL=wss://example.livekit.cloud',
      'LIVEKIT_API_KEY=devkey',
      'LIVEKIT_API_SECRET=test-secret-that-is-long-enough-for-hs256',
      'LIVEKIT_ROOM_NAME=robo-sims-space',
    ].join('\n'),
}));
vi.mock('livekit-server-sdk', async (original) => ({
  ...(await original<typeof import('livekit-server-sdk')>()),
  RoomServiceClient: class {
    async listParticipants() {
      return [{ identity: 'controller-curie' }];
    }
  },
}));

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllEnvs());
it('uses .env.local over inherited settings and signs a ten-minute token for that room', async () => {
  vi.stubEnv('LIVEKIT_ROOM_NAME', 'wrong-room');
  const { GET } = await import('../src/app/api/credentials/route');
  const response = await GET();
  expect(response.status).toBe(200);
  const data = await response.json();
  const claims = await new TokenVerifier(
    'devkey',
    'test-secret-that-is-long-enough-for-hs256',
  ).verify(data.token);
  expect(claims.video).toMatchObject({
    room: 'robo-sims-space',
    roomJoin: true,
    canUpdateOwnMetadata: true,
  });
  expect(claims.sub).toMatch(/^controller-[a-z]+$/);
  expect(claims.sub).not.toBe('controller-curie');
  expect(claims.exp! - claims.nbf!).toBe(600);
  expect(data.server_url).toBe('wss://example.livekit.cloud');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(data).not.toHaveProperty('apiSecret');
});

it('public deployments cannot mint direct-room tokens', async () => {
  vi.stubEnv('TELEOP_PUBLIC_DEPLOYMENT', '1');
  const { GET } = await import('../src/app/api/credentials/route');
  const response = await GET();
  expect(response.status).toBe(404);
  expect(await response.json()).not.toHaveProperty('token');
});
