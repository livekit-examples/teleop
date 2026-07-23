import { useEffect, useState } from 'react';
import { useSessionContext } from '@livekit/components-react';
import { useRemoteDataTracks } from '@/hooks/use-data-tracks';
import { ODOM_TOPIC, quaternionToYawDegrees, type OdometryPayload } from '@/lib/servo-state';

interface Odom {
  /**
   * Heading from `pose.pose.orientation`, in degrees within [-180, 180), where a right
   * turn is positive (screen convention — sign-flipped from ROS's CCW-positive yaw).
   * Undefined until the first message.
   */
  yaw: number | undefined;
}

/**
 * Subscribes to the `odom` remote data track from the given robot participant.
 *
 * Uses {@link useRemoteDataTracks} to discover published tracks, then filters by
 * topic name (with or without the ROS leading slash) and publisher identity. Incoming
 * frames are JSON-decoded as ROS2 `nav_msgs/msg/Odometry` ({@link OdometryPayload});
 * the pose orientation quaternion is converted to a yaw angle in degrees via
 * {@link quaternionToYawDegrees}. Readers are torn down via `AbortController` on cleanup.
 */
export function useOdom(robotIdentity: string): Odom {
  const session = useSessionContext();
  const [yaw, setYaw] = useState<number | undefined>(undefined);
  const dataTracks = useRemoteDataTracks(session.room);

  useEffect(() => {
    const decoders: Array<() => void> = [];

    for (const track of dataTracks) {
      const name = track.info.name?.replace(/^\//, '');
      if (name !== ODOM_TOPIC) continue;
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
            const parsed = JSON.parse(text) as OdometryPayload;
            const orientation = parsed.pose?.pose?.orientation;
            if (!orientation) continue;
            // ROS yaw (REP-103) is CCW-positive; the scale treats a right turn as positive.
            setYaw(-quaternionToYawDegrees(orientation));
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

  return { yaw };
}
