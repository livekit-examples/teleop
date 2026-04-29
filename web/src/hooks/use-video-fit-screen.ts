import { TrackReference } from '@livekit/components-react';
import { useLayoutEffect, useMemo, useState } from 'react';

function getViewportSize() {
  if (typeof window === 'undefined') {
    return { width: 0, height: 0 };
  }
  return { width: window.innerWidth, height: window.innerHeight };
}

/**
 * Calculates the width and height of a video track to fit within a container with given insets.
 */
export function useVideoFitScreen(
  insetX: number,
  insetY: number,
  isFullscreen: boolean,
  mainVideoTrack: TrackReference | null,
) {
  const [viewport, setViewport] = useState(getViewportSize);

  useLayoutEffect(() => {
    function onResize() {
      setViewport(getViewportSize());
    }

    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const { width, height } = useMemo(() => {
    if (!mainVideoTrack) return { width: 0, height: 0 };
    const { width: innerW, height: innerH } = viewport;
    if (isFullscreen) {
      return {
        width: innerW,
        height: innerH,
      };
    }

    const videoRatio =
      (mainVideoTrack.publication.dimensions?.width || 0) /
        (mainVideoTrack.publication.dimensions?.height || 0) || 1;

    const containerRatio = (innerW - insetX * 2) / (innerH - insetY * 2);

    if (containerRatio > videoRatio) {
      return {
        width: (innerH - insetY * 2) * videoRatio,
        height: innerH - insetY * 2,
      };
    }

    return {
      width: innerW - insetX * 2,
      height: (innerW - insetX * 2) / videoRatio,
    };
  }, [mainVideoTrack, isFullscreen, insetY, insetX, viewport]);

  return { width, height };
}
