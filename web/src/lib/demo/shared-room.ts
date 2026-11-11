'use client';
import { LiveKitTransport } from '../teleop/livekit-transport';
import { demoRequest, type SharedRoomCredentials } from './types';

// Runtimes own their subscriptions; this module owns the one tab connection.
class SharedTransport extends LiveKitTransport {
  override async disconnect() {}
  async close() {
    await super.disconnect();
  }
}

let connection:
  | Promise<{ transport: SharedTransport; credentials: SharedRoomCredentials }>
  | undefined;
let leases = 0;
let closing: ReturnType<typeof setTimeout> | undefined;

export async function acquireSharedRoom() {
  clearTimeout(closing);
  leases++;
  connection ??= (async () => {
    const credentials = await demoRequest<SharedRoomCredentials>('credentials', {
      method: 'POST',
      body: '{}',
    });
    const transport = new SharedTransport('operator', true);
    try {
      await transport.connect(credentials.server_url, credentials.token);
      return { transport, credentials };
    } catch (error) {
      await transport.close();
      throw error;
    }
  })();
  try {
    const room = await connection;
    let released = false;
    return {
      ...room,
      release() {
        if (released) return;
        released = true;
        if (--leases === 0)
          closing = setTimeout(() => {
            connection = undefined;
            void room.transport.close();
          }, 250);
      },
    };
  } catch (error) {
    leases--;
    connection = undefined;
    throw error;
  }
}
