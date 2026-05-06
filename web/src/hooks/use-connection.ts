import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSessionContext } from '@livekit/components-react';
import { toast } from 'sonner';

/**
 * Connects/disconnects the LiveKit session bound by the surrounding
 * `<SessionProvider>`, surfacing connect failures via a sonner toast and
 * redirecting to `/`.
 *
 * **Registration order matters.** Passive effect cleanups run in registration
 * order, so any hook that needs a live session during teardown (the
 * `acquire_control` release RPC, data-track unpublish, IMU subscription
 * abort, …) must be registered *before* this one. Call `useConnection()` last
 * in the component, after `useAcquireControl`, `useImu`/`useGyro`,
 * `useControlCmdTrack`, etc.
 */
export function useConnection() {
  const router = useRouter();

  const session = useSessionContext();
  useEffect(() => {
    session.start().catch((err: unknown) => {
      toast.error('Failed to connect to robot', {
        id: 'robot-connect-error',
        description: err instanceof Error ? err.message : String(err),
      });
      router.push('/');
    });

    return () => {
      session.end();
    };
  }, []);
}
