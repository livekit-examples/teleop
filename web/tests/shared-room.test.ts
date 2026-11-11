import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { connect, disconnect, credentials } = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  credentials: vi.fn(),
}));
vi.mock('../src/lib/teleop/livekit-transport', () => ({
  LiveKitTransport: class {
    connect(...args: unknown[]) {
      return connect(...args);
    }
    disconnect(...args: unknown[]) {
      return disconnect(...args);
    }
  },
}));
vi.mock('../src/lib/demo/types', () => ({ demoRequest: credentials }));
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  connect.mockReset().mockResolvedValue(undefined);
  disconnect.mockReset().mockResolvedValue(undefined);
  credentials.mockReset().mockResolvedValue({
    identity: 'viewer',
    token: 'token',
    proof: 'proof',
    server_url: 'ws://local',
  });
});
afterEach(() => vi.useRealTimers());

it('shares one tab connection across simulations and closes only after the last viewer releases it', async () => {
  const { acquireSharedRoom } = await import('../src/lib/demo/shared-room');
  const [first, second] = await Promise.all([acquireSharedRoom(), acquireSharedRoom()]);
  expect(first.transport).toBe(second.transport);
  expect(connect).toHaveBeenCalledTimes(1);
  expect(credentials).toHaveBeenCalledTimes(1);
  await first.transport.disconnect();
  first.release();
  await vi.advanceTimersByTimeAsync(300);
  expect(disconnect).not.toHaveBeenCalled();
  second.release();
  await vi.advanceTimersByTimeAsync(300);
  expect(disconnect).toHaveBeenCalledTimes(1);
});

it('reuses the connection through a quick route transition', async () => {
  const { acquireSharedRoom } = await import('../src/lib/demo/shared-room');
  const first = await acquireSharedRoom();
  first.release();
  const next = await acquireSharedRoom();
  await vi.advanceTimersByTimeAsync(300);
  expect(connect).toHaveBeenCalledTimes(1);
  expect(disconnect).not.toHaveBeenCalled();
  next.release();
  await vi.advanceTimersByTimeAsync(300);
});
