import { expect, it } from 'vitest';
import { LiveKitTransport } from '../src/lib/teleop/livekit-transport';
import type { Publication } from '../src/lib/teleop/types';

it('reads SDK data tracks by exact name and rejects an old publication after replacement', async () => {
  const transport = Object.create(LiveKitTransport.prototype) as LiveKitTransport;
  const payload = new TextEncoder().encode('{"position":[0.2]}');
  Object.defineProperty(transport, 'room', {
    value: {
      remoteParticipants: new Map([
        [
          'robot',
          {
            dataTracks: new Map([
              [
                '/arm/joint_states',
                {
                  info: { sid: 'current-sid' },
                  subscribe: () =>
                    new ReadableStream({
                      start(controller) {
                        controller.enqueue({ payload });
                      },
                    }),
                },
              ],
            ]),
          },
        ],
      ]),
    },
  });
  const publication: Publication = {
    id: 'current-sid',
    robot: 'robot',
    kind: 'data',
    name: '/arm/joint_states',
  };
  const stream = transport.read(publication, new AbortController().signal);
  expect((await stream.next()).value).toEqual(payload);
  await stream.return();
  const stale = transport.read({ ...publication, id: 'old-sid' }, new AbortController().signal);
  await expect(stale.next()).rejects.toThrow('no longer available');
});
