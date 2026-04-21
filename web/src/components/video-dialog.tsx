import { Track } from "livekit-client";
import { cn } from "@/lib/utils";
import { Dialog } from "@/components/dialog";
import { VideoTrack, useTracks } from "@livekit/components-react";
import { useVideoFitScreen } from "@/hooks/use-video-fit-screen";

interface VideoDialogProps {
  insetX?: number;
  insetY?: number;
  isFullscreen?: boolean;
  className?: string;
}

export function VideoDialog({
  isFullscreen = false,
  insetX = 0,
  insetY = 0,
  className,
}: VideoDialogProps) {
  const [mainVideoTrack] = useTracks([Track.Source.Camera]);

  const { width, height } = useVideoFitScreen(
    insetX,
    insetY,
    isFullscreen,
    mainVideoTrack,
  );

  if (!mainVideoTrack) return null;

  return (
    <div
      className={cn(
        "fixed inset-0 flex items-center justify-center",
        className,
      )}
    >
      <Dialog className="grow flex items-center justify-center">
        <VideoTrack
          width={width}
          height={height}
          trackRef={mainVideoTrack}
          className={cn(
            "rounded-md starting:opacity-0 transition-opacity opacity-100",
            isFullscreen && "fixed inset-0 object-cover z-40 w-dvw h-dvh",
          )}
        />
      </Dialog>
    </div>
  );
}
