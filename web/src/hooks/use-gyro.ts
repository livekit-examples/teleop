import { useEffect, useState } from "react";
import { useSessionContext } from "@livekit/components-react";
import { useRemoteDataTracks } from "@/hooks/use-data-tracks";
import { GYRO_STATE_TOPIC, type GyroStatePayload } from "@/lib/servo-state";

const initialGyro: GyroStatePayload = {};

/**
 * Subscribes to `state.gyro` remote data track (JSON gyro + integrated angles).
 * Filters by `robotIdentity` to avoid subscribing to identically-named tracks
 * from other participants.
 */
export function useGyro(robotIdentity: string): GyroStatePayload {
  const session = useSessionContext();
  const [gyro, setGyro] = useState<GyroStatePayload>(initialGyro);
  const dataTracks = useRemoteDataTracks(session.room);

  useEffect(() => {
    const decoders: Array<() => void> = [];

    for (const track of dataTracks) {
      if (track.info.name !== GYRO_STATE_TOPIC) continue;
      if (track.publisherIdentity !== robotIdentity) continue;

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
            const parsed = JSON.parse(text) as GyroStatePayload;
            setGyro(parsed);
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

  return gyro;
}
