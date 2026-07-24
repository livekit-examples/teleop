import { useEffect, useState } from 'react';
import { useSessionContext } from '@livekit/components-react';
import { useRemoteDataTracks } from '@/hooks/use-data-tracks';
import { BATTERY_STATE_TOPIC, type BatteryStatePayload } from '@/lib/servo-state';

/**
 * Subscribes to the `battery_state` remote data track from the given robot participant.
 *
 * Uses {@link useRemoteDataTracks} to discover published tracks, then filters by
 * topic name (with or without the ROS leading slash) and publisher identity. Frames
 * are JSON-decoded as ROS2 `sensor_msgs/msg/BatteryState`; bare `NaN`/`Infinity`
 * tokens (ROS `.nan` for unmeasured fields) are sanitized to `null` before parsing,
 * since they are not valid JSON. Returns the latest payload, or undefined before
 * the first message.
 */
export function useBattery(robotIdentity: string): BatteryStatePayload | undefined {
  const session = useSessionContext();
  const [battery, setBattery] = useState<BatteryStatePayload | undefined>(undefined);
  const dataTracks = useRemoteDataTracks(session.room);

  useEffect(() => {
    const decoders: Array<() => void> = [];

    for (const track of dataTracks) {
      const name = track.info.name?.replace(/^\//, '');
      if (name !== BATTERY_STATE_TOPIC) continue;
      if (track.publisherIdentity !== robotIdentity) continue;

      const ac = new AbortController();
      console.log('[data_track] subscribed', {
        name: track.info.name,
        publisher: track.publisherIdentity,
        sid: track.info?.sid,
      });
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
            const text = new TextDecoder()
              .decode(value.payload)
              .replace(/\b-?(?:NaN|Infinity)\b/g, 'null');
            const parsed = JSON.parse(text) as BatteryStatePayload;
            setBattery(parsed);
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

  return battery;
}
