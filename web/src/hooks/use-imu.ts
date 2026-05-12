import { useEffect, useState } from 'react';
import { useSessionContext } from '@livekit/components-react';
import { useRemoteDataTracks } from '@/hooks/use-data-tracks';
import { roverImuTopic, type ImuPayload } from '@/lib/rover';

/**
 * Subscribes to the `<rover_id>.imu` remote data track.
 *
 * Filters discovered tracks by topic name (which already encodes the rover_id),
 * opens a reader on each match, and JSON-decodes frames into {@link ImuPayload}.
 * Readers are torn down via `AbortController` on track-list change or unmount.
 */
export function useImu(roverId: string): ImuPayload | null {
  const session = useSessionContext();
  const [imu, setImu] = useState<ImuPayload | null>(null);
  const dataTracks = useRemoteDataTracks(session.room);
  const topic = roverImuTopic(roverId);

  useEffect(() => {
    const decoders: Array<() => void> = [];

    for (const track of dataTracks) {
      if (track.info.name !== topic) continue;

      const ac = new AbortController();
      // IMU streams at the serial bus rate (~100+ Hz); default bufferSize of 16
      // fills faster than React can drain in dev mode.
      const stream = track.subscribe({ signal: ac.signal, bufferSize: 256 });
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
            const parsed = JSON.parse(text) as ImuPayload;
            setImu(parsed);
          }
        } catch {
          // Aborted or parse error — ignore
        }
      })();
    }

    return () => {
      for (const stop of decoders) stop();
    };
  }, [dataTracks, topic]);

  return imu;
}
