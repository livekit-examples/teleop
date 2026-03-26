import { useEffect, type Dispatch, type SetStateAction } from "react";
import { type RoomDataTrack } from "@/hooks/use-data-tracks";
import {
  PAN_STATE_TOPIC,
  servoTicksToDegrees,
  TILT_STATE_TOPIC,
  type ServoStatePayload,
} from "@/lib/servo-state";
import { type RoomEventCallbacks } from "livekit-client";

type RemoteDataTrack = Parameters<
  RoomEventCallbacks["dataTrackPublished"]
>[0];

function isRemoteDataTrack(t: RoomDataTrack): t is RemoteDataTrack {
  return !t.isLocal;
}

/**
 * Subscribes to `state.pan` / `state.tilt` remote data tracks and maps servo JSON
 * to yaw/pitch degrees (see `servoTicksToDegrees`).
 */
export function useServoTelemetryFromDataTracks(
  dataTracks: RoomDataTrack[],
  setYaw: Dispatch<SetStateAction<number>>,
  setPitch: Dispatch<SetStateAction<number>>,
): void {
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
              setYaw(deg);
            } else if (name === TILT_STATE_TOPIC) {
              setPitch(deg);
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
  }, [dataTracks, setYaw, setPitch]);
}
