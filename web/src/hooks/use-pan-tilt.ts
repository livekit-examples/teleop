import { useEffect, useState } from "react";
import { useSessionContext } from "@livekit/components-react";
import { type RoomDataTrack, useDataTracks } from "@/hooks/use-data-tracks";
import {
  PAN_STATE_TOPIC,
  servoTicksToDegrees,
  TILT_STATE_TOPIC,
  type ServoStatePayload,
} from "@/lib/servo-state";
import { type RoomEventCallbacks } from "livekit-client";

type RemoteDataTrack = Parameters<RoomEventCallbacks["dataTrackPublished"]>[0];

function isRemoteDataTrack(t: RoomDataTrack): t is RemoteDataTrack {
  return !t.isLocal;
}

interface PanTilt {
  pan: number;
  tilt: number;
}

/**
 * Subscribes to `state.pan` / `state.tilt` remote data tracks and maps servo JSON
 * to pan/tilt degrees (see `servoTicksToDegrees`).
 */
export function usePanTilt(): PanTilt {
  const session = useSessionContext();
  const [pan, setPan] = useState(0);
  const [tilt, setTilt] = useState(0);
  const dataTracks = useDataTracks(session.room);

  useEffect(() => {
    const decoders: Array<() => void> = [];

    for (const track of dataTracks) {
      if (!isRemoteDataTrack(track)) continue;
      const name = track.info.name;
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
  }, [dataTracks, setPan, setTilt]);

  return { pan, tilt };
}
