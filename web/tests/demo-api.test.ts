import { afterEach, beforeEach, expect, it, vi } from 'vitest';
let visitor: string | undefined;
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => (visitor ? { value: visitor } : undefined) }),
}));
const upstream = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', upstream);
  vi.stubEnv('SIM_SUPERVISOR_URL', 'https://service.modal.run');
  vi.stubEnv('SIM_SUPERVISOR_KEY', 'test-server-secret');
  visitor = 'a'.repeat(32);
  upstream.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
const route = async (method: string, path: string[], headers: Record<string, string> = {}) => {
  const { GET } = await import('../src/app/api/demo/[...path]/route');
  return GET(
    new Request('http://localhost:3001/api/demo/' + path.join('/'), {
      method,
      headers: { host: '127.0.0.1:3001', ...headers },
      ...(method === 'POST'
        ? {
            body: JSON.stringify({
              simulation_id: 'trossen-wxai',
              request_id: 'request-aaaaaaaaaa',
            }),
          }
        : {}),
    }),
    { params: Promise.resolve({ path }) },
  );
};
it('uses the incoming host for same-origin protection and forwards the stable visitor', async () => {
  upstream.mockResolvedValue(
    new Response(JSON.stringify({ id: 'b'.repeat(32), state: 'starting' }), { status: 202 }),
  );
  const response = await route('POST', ['simulations', 'vacuum', 'watch'], {
    origin: 'http://127.0.0.1:3001',
  });
  expect(response.status).toBe(202);
  expect(upstream.mock.calls[0][1].headers).toMatchObject({
    Authorization: 'Bearer test-server-secret',
    'X-Demo-Owner': visitor,
  });
  expect(response.headers.get('cache-control')).toBe('no-store');
});
it('rejects foreign origins and missing visitor identity before contacting the service', async () => {
  expect(
    (await route('POST', ['simulations', 'vacuum', 'watch'], { origin: 'http://evil.test' }))
      .status,
  ).toBe(403);
  visitor = undefined;
  expect(
    (await route('POST', ['simulations', 'vacuum', 'watch'], { origin: 'http://127.0.0.1:3001' }))
      .status,
  ).toBe(401);
  expect(upstream).not.toHaveBeenCalled();
});
it('cannot proxy worker callbacks, launcher cleanup, or arbitrary room credentials', async () => {
  expect((await route('POST', ['workers', 'a'.repeat(32), 'events'])).status).toBe(404);
  expect((await route('DELETE', ['launchers', 'a'.repeat(32), 'sessions'])).status).toBe(404);
  expect((await route('POST', ['rooms', 'direct', 'credentials'])).status).toBe(404);
  expect((await route('DELETE', ['instances', 'a'.repeat(32)])).status).toBe(404);
  expect(upstream).not.toHaveBeenCalled();
});
it('forwards a queue target and proof without exposing the supervisor key', async () => {
  const { GET } = await import('../src/app/api/demo/[...path]/route');
  upstream.mockResolvedValue(new Response(JSON.stringify({ queue: [] })));
  const response = await GET(
    new Request('http://localhost/api/demo/queue?instance=' + 'a'.repeat(32), {
      headers: { 'X-Sim-Proof': 'signed-proof' },
    }),
    { params: Promise.resolve({ path: ['queue'] }) },
  );
  expect(upstream.mock.calls[0][0]).toBe(
    'https://service.modal.run/queue?instance=' + 'a'.repeat(32),
  );
  expect(upstream.mock.calls[0][1].headers['X-Sim-Proof']).toBe('signed-proof');
  expect(await response.text()).not.toContain('test-server-secret');
});
it('establishes an HTTP-only visitor cookie when reading the catalog', async () => {
  visitor = undefined;
  upstream.mockResolvedValue(new Response('[]'));
  const response = await route('GET', ['simulations']);
  expect(response.headers.get('set-cookie')).toContain('HttpOnly');
  expect(await response.json()).toEqual({ enabled: true, simulations: [] });
});

it('identifies an older Modal API when its shared launch route is missing', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    upstream.mockResolvedValue(new Response('{"detail":"Not Found"}', { status: 404 }));
    const response = await route('POST', ['simulations', 'vacuum', 'watch'], {
      origin: 'http://127.0.0.1:3001',
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: 'simulation_api_mismatch',
      error: expect.stringContaining('not available on this deployment'),
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('SIM_SUPERVISOR_URL'), {
      route: 'simulations/vacuum/watch',
      status: 404,
    });
  } finally {
    log.mockRestore();
  }
});

it('keeps a missing instance distinct from an incompatible service and reads JSON errors', async () => {
  upstream.mockResolvedValue(new Response('{"detail":"Instance not found."}', { status: 404 }));
  const response = await route('GET', ['instances', 'a'.repeat(32)]);
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: 'Instance not found.' });
});
