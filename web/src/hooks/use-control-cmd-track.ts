import { useCallback, useEffect, useRef } from 'react';
import { useLocalParticipant } from '@livekit/components-react';
import {
  CONTROL_CMD_FRAME_ENCODING,
  CONTROL_CMD_SCHEMA,
  CONTROL_CMD_TOPIC,
  controlCmdJson,
} from '@/lib/control-cmd';
import type { LocalParticipant } from 'livekit-client';

type LocalDataTrack = Awaited<ReturnType<LocalParticipant['publishDataTrack']>>;

async function pushFrame(track: LocalDataTrack, linear_x: number, angular_z: number) {
  const payload = new TextEncoder().encode(controlCmdJson(linear_x, angular_z));
  await track.tryPush({ payload });
}

/**
 * Publishes a `cmd_vel` local data track for sending drive commands.
 *
 * When `enabled` is true, publishes a data track named `cmd_vel` via the local
 * participant. Returns `pushControlCmd(linear_x, angular_z)` which JSON-encodes the
 * throttle/steering velocities (rev/s) and pushes a frame to the track. When `enabled`
 * flips to false or the component unmounts, the track is unpublished.
 */
export function useControlCmdTrack(enabled: boolean) {
  const { localParticipant } = useLocalParticipant();
  const trackRef = useRef<LocalDataTrack | null>(null);

  useEffect(() => {
    if (!enabled) {
      trackRef.current = null;
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const track = await localParticipant.publishDataTrack({
          name: CONTROL_CMD_TOPIC,
          schema: CONTROL_CMD_SCHEMA,
          frameEncoding: CONTROL_CMD_FRAME_ENCODING,
        });
        if (cancelled) {
          return;
        }
        trackRef.current = track;
        console.log('[data_track] published', {
          name: CONTROL_CMD_TOPIC,
          sid: track.info?.sid,
          schema: track.info?.schema,
          frameEncoding: track.info?.frameEncoding,
        });
      } catch (e) {
        console.warn('[cmd_vel] publishDataTrack failed:', e);
      }
    })();

    return () => {
      cancelled = true;
      trackRef.current = null;
    };
  }, [enabled, localParticipant]);

  const pushControlCmd = useCallback((linear_x: number, angular_z: number) => {
    const track = trackRef.current;
    if (!track?.isPublished()) return;
    void pushFrame(track, linear_x, angular_z).catch((err: unknown) => {
      // dropped / unpublished
      console.warn('[cmd_vel] pushFrame failed:', err);
    });
  }, []);

  return { pushControlCmd };
}
