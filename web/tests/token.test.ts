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
      'LIVEKIT_USER_PASS=test-password',
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
const request = (password?: string) =>
  new Request('http://localhost:3000/api/credentials', {
    headers: password ? { Authorization: `Bearer ${password}` } : {},
  });

it('uses .env.local over inherited settings and signs a ten-minute token for that room', async () => {
  vi.stubEnv('LIVEKIT_ROOM_NAME', 'wrong-room');
  vi.stubEnv('LIVEKIT_USER_PASS', 'wrong-password');
  const { GET } = await import('../src/app/api/credentials/route');
  const response = await GET(request('test-password'));
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

it('requires the configured password', async () => {
  const { GET } = await import('../src/app/api/credentials/route');
  expect((await GET(request())).status).toBe(401);
  expect((await GET(request('incorrect'))).status).toBe(403);
});
