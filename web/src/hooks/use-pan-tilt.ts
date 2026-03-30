import { useEffect, useState } from 'react';
import { useSessionContext } from '@livekit/components-react';
import { useRemoteDataTracks } from '@/hooks/use-data-tracks';
import {
  PAN_STATE_TOPIC,
  servoTicksToDegrees,
  TILT_STATE_TOPIC,
  type ServoStatePayload,
} from '@/lib/servo-state';

interface PanTilt {
  pan: number;
  tilt: number;
}

/**
 * Subscribes to `state.pan` and `state.tilt` remote data tracks from the given robot.
 *
 * Uses {@link useRemoteDataTracks} to discover published tracks, then filters by
 * publisher identity and topic name. For each matching track a `ReadableStream`
 * reader is opened; incoming JSON frames are decoded into {@link ServoStatePayload},
 * converted from encoder ticks to degrees via {@link servoTicksToDegrees}, and stored
 * as `pan` / `tilt` state. Readers are torn down via `AbortController` on cleanup.
 */
export function usePanTilt(robotIdentity: string): PanTilt {
  const session = useSessionContext();
  const [pan, setPan] = useState(0);
  const [tilt, setTilt] = useState(0);
  const dataTracks = useRemoteDataTracks(session.room);

  useEffect(() => {
    const decoders: Array<() => void> = [];

    for (const track of dataTracks) {
      const name = track.info.name;
      if (track.publisherIdentity !== robotIdentity) continue;
      if (name !== PAN_STATE_TOPIC && name !== TILT_STATE_TOPIC) continue;

      const ac = new AbortController();
      const stream = track.subscribe({ signal: ac.signal });
      const reader = stream.getReader();
      decoders.push(() => {
        ac.abort();
        reader.releaseLock();
      });

      void (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = new TextDecoder().decode(value.payload);
            const parsed = JSON.parse(text) as ServoStatePayload;
            if (parsed.valid === false || parsed.position_ticks === undefined) {
              continue;
            }
            const deg = servoTicksToDegrees(parsed.position_ticks);
            if (name === PAN_STATE_TOPIC) {
              setPan(deg);
            } else if (name === TILT_STATE_TOPIC) {
              setTilt(deg);
            }
          }
        } catch {
          // Aborted or parse error — ignore
        }
      })();
    }

    return () => {
      for (const stop of decoders) stop();
    };
  }, [dataTracks, robotIdentity]);

  return { pan, tilt };
}
