import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSessionContext } from '@livekit/components-react';
import { toast } from 'sonner';

export function useConnection() {
  const router = useRouter();

  const session = useSessionContext();
  // Declare the connection lifecycle effect first so its cleanup runs *last*
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
