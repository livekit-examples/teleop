import { useCallback, useEffect, useRef } from "react";
import { useLocalParticipant } from "@livekit/components-react";
import { CONTROL_CMD_TOPIC, controlCmdJson } from "@/lib/control-cmd";
import type { LocalParticipant } from "livekit-client";

type LocalDataTrack = Awaited<ReturnType<LocalParticipant["publishDataTrack"]>>;

async function pushFrame(track: LocalDataTrack, pan_vel: number, tilt_vel: number) {
  const payload = new TextEncoder().encode(controlCmdJson(pan_vel, tilt_vel));
  await track.tryPush({ payload });
}

export function useControlCmdTrack(enabled: boolean) {
  const { localParticipant } = useLocalParticipant();
  const trackRef = useRef<LocalDataTrack | null>(null);

  useEffect(() => {
    if (!enabled) {
      const t = trackRef.current;
      trackRef.current = null;
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const track = await localParticipant.publishDataTrack({
          name: CONTROL_CMD_TOPIC,
        });
        if (cancelled) {
          return;
        }
        trackRef.current = track;
      } catch (e) {
        console.warn("[control_cmd] publishDataTrack failed:", e);
      }
    })();

    return () => {
      cancelled = true;
      const t = trackRef.current;
      trackRef.current = null;
    };
  }, [enabled, localParticipant]);

  const pushControlCmd = useCallback((pan_vel: number, tilt_vel: number) => {
    const track = trackRef.current;
    if (!track?.isPublished()) return;
    void pushFrame(track, pan_vel, tilt_vel).catch((err: unknown) => {
      // dropped / unpublished
      console.warn("[control_cmd] pushFrame failed:", err);
    });
  }, []);

  return { pushControlCmd };
}
