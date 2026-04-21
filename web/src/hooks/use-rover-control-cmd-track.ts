import { useCallback, useEffect, useRef } from "react";
import { useLocalParticipant } from "@livekit/components-react";
import { controlCmdJson, roverControlCmdTopic } from "@/lib/rover";
import type { LocalParticipant } from "livekit-client";

type LocalDataTrack = Awaited<ReturnType<LocalParticipant["publishDataTrack"]>>;

async function pushFrame(track: LocalDataTrack, throttle_rps: number, steering_rps: number) {
  const json = controlCmdJson(throttle_rps, steering_rps);
  const payload = new TextEncoder().encode(json);
  await track.tryPush({ payload });
}

/**
 * Publishes `<rover_id>.control_cmd` and returns a pusher for throttle/steering frames.
 *
 * When `enabled` is true, publishes a data track named `<rover_id>.control_cmd` via
 * the local participant. Returns `pushControlCmd(throttle_rps, steering_rps)` which
 * JSON-encodes and pushes a frame. When `enabled` flips false or the component
 * unmounts, the track ref is cleared.
 */
export function useRoverControlCmdTrack(roverId: string, enabled: boolean) {
  const { localParticipant } = useLocalParticipant();
  const trackRef = useRef<LocalDataTrack | null>(null);
  const topic = roverControlCmdTopic(roverId);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let publishedTrack: LocalDataTrack | null = null;

    void (async () => {
      try {
        const track = await localParticipant.publishDataTrack({ name: topic });
        publishedTrack = track;
        if (cancelled) {
          void track.unpublish().catch(() => {});
          return;
        }
        trackRef.current = track;
      } catch (e) {
        console.warn("[control_cmd] publishDataTrack failed:", e);
      }
    })();

    return () => {
      cancelled = true;
      trackRef.current = null;
      if (publishedTrack) {
        void publishedTrack.unpublish().catch(() => {});
      }
    };
  }, [enabled, localParticipant, topic]);

  const pushControlCmd = useCallback((throttle_rps: number, steering_rps: number) => {
    const track = trackRef.current;
    if (!track?.isPublished()) return;
    void pushFrame(track, throttle_rps, steering_rps).catch((err: unknown) => {
      console.warn("[control_cmd] pushFrame failed:", err);
    });
  }, []);

  return { pushControlCmd };
}
