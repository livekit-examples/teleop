import { useEffect, useRef, type RefObject } from 'react';
import { useSessionContext } from '@livekit/components-react';
import { useRemoteDataTracks } from '@/hooks/use-data-tracks';
import { IMU_DATA_RAW_TOPIC, rosStampToMs, type ImuPayload } from '@/lib/servo-state';

export interface ImuSample {
  /** Message timestamp, epoch ms (header stamp when set, else receive time). */
  t: number;
  /** Angular velocity about Z / Y, in °/s (converted from ROS rad/s). */
  angVelZ: number;
  angVelY: number;
  /** Linear acceleration along X / Y, in m/s². */
  linAccX: number;
  linAccY: number;
}

/** Oldest sample retained in the rolling buffer. */
const MAX_AGE_MS = 60_000;
const RAD_TO_DEG = 180 / Math.PI;

/**
 * Subscribes to the `imu/data_raw` remote data track from the given robot participant
 * and accumulates ROS2 `sensor_msgs/msg/Imu` messages into a rolling sample buffer.
 *
 * Samples live in a mutable ref (not state) so consumers can poll on animation frames
 * without a React re-render per message. Messages lacking `angular_velocity` and
 * `linear_acceleration` (e.g. the pan/tilt robot's custom gyro payload on the same
 * topic) are ignored. Readers are torn down via `AbortController` on cleanup; the
 * buffer survives track churn so a brief republish doesn't wipe history.
 */
export function useImuHistory(robotIdentity: string): RefObject<ImuSample[]> {
  const session = useSessionContext();
  const samplesRef = useRef<ImuSample[]>([]);
  const dataTracks = useRemoteDataTracks(session.room);

  useEffect(() => {
    const decoders: Array<() => void> = [];

    for (const track of dataTracks) {
      const name = track.info.name?.replace(/^\//, '');
      if (name !== IMU_DATA_RAW_TOPIC.replace(/^\//, '')) continue;
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
            const text = new TextDecoder().decode(value.payload);
            const parsed = JSON.parse(text) as ImuPayload;
            const angVel = parsed.angular_velocity;
            const linAcc = parsed.linear_acceleration;
            if (!angVel && !linAcc) continue;
            const t = rosStampToMs(parsed.header?.stamp) ?? Date.now();
            const buf = samplesRef.current;
            buf.push({
              t,
              angVelZ: (angVel?.z ?? 0) * RAD_TO_DEG,
              angVelY: (angVel?.y ?? 0) * RAD_TO_DEG,
              linAccX: linAcc?.x ?? 0,
              linAccY: linAcc?.y ?? 0,
            });
            const cutoff = t - MAX_AGE_MS;
            while (buf.length > 0 && buf[0].t < cutoff) buf.shift();
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

  return samplesRef;
}
