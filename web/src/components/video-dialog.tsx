import { useMemo } from 'react';
import { Track } from 'livekit-client';
import { cn } from '@/lib/utils';
import { Dialog } from '@/components/dialog';
import { VideoTrack, useTracks } from '@livekit/components-react';
import { useVideoFitScreen } from '@/hooks/use-video-fit-screen';

interface VideoDialogProps {
  insetX?: number;
  insetY?: number;
  isFullscreen?: boolean;
  participantIdentity?: string;
  showTrackInfo?: boolean;
  source?: Track.Source;
  trackName?: string;
  className?: string;
}

export function VideoDialog({
  isFullscreen = false,
  insetX = 0,
  insetY = 0,
  participantIdentity,
  showTrackInfo = false,
  source = Track.Source.Camera,
  trackName,
  className,
}: VideoDialogProps) {
  const videoTracks = useTracks([source], { onlySubscribed: true });
  const mainVideoTrack = useMemo(() => {
    return videoTracks.find((trackRef) => {
      if (participantIdentity && trackRef.participant.identity !== participantIdentity) {
        return false;
      }
      if (trackName && trackRef.publication.trackName !== trackName) {
        return false;
      }
      return true;
    });
  }, [participantIdentity, trackName, videoTracks]);

  const { width, height } = useVideoFitScreen(insetX, insetY, isFullscreen, mainVideoTrack ?? null);

  const expectedTrackLabel = trackName ?? source;
  const dimensions = mainVideoTrack?.publication.dimensions;
  const trackInfo =
    mainVideoTrack &&
    [
      mainVideoTrack.publication.trackName,
      mainVideoTrack.publication.mimeType,
      dimensions && `${dimensions.width}x${dimensions.height}`,
    ]
      .filter(Boolean)
      .join(' | ');

  return (
    <div className={cn('fixed inset-0 flex items-center justify-center', className)}>
      <Dialog className="flex grow items-center justify-center">
        {mainVideoTrack ? (
          <div className="relative">
            <VideoTrack
              width={width}
              height={height}
              trackRef={mainVideoTrack}
              className={cn(
                'rounded-md opacity-100 transition-opacity starting:opacity-0',
                isFullscreen && 'fixed inset-0 z-40 h-dvh w-dvw object-cover',
              )}
            />
            {showTrackInfo && trackInfo && (
              <div className="bg-background/70 text-foreground absolute bottom-2 left-2 rounded px-2 py-1 font-mono text-xs backdrop-blur">
                {trackInfo}
              </div>
            )}
          </div>
        ) : (
          <div className="bg-background/60 text-muted-foreground rounded border px-4 py-3 font-mono text-xs uppercase">
            Waiting for {expectedTrackLabel}
          </div>
        )}
      </Dialog>
    </div>
  );
}
