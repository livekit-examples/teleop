import { useEffect } from 'react';

/**
 * Keeps a `<video>` element fitted within its parent container while preserving
 * aspect ratio.
 *
 * Attaches a `ResizeObserver` to the video's parent element and toggles between
 * `width: 100%` and `height: 100%` based on which dimension is the constraining
 * axis, using the video's intrinsic `videoWidth` / `videoHeight`.
 */
export function useVideoFitContainer(mainVideoEl: HTMLVideoElement | null, isFullscreen: boolean) {
  useEffect(() => {
    if (!mainVideoEl) return;

    if (isFullscreen) {
      mainVideoEl.style.width = '100%';
      mainVideoEl.style.height = '100%';
      return;
    }

    const container = mainVideoEl.parentElement;
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const containerAspectRatio = width / height;
        const videoAspectRatio = mainVideoEl.videoWidth / mainVideoEl.videoHeight;

        if (containerAspectRatio > videoAspectRatio) {
          mainVideoEl.style.width = 'auto';
          mainVideoEl.style.height = '100%';
        } else {
          mainVideoEl.style.width = '100%';
          mainVideoEl.style.height = 'auto';
        }
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [mainVideoEl, isFullscreen]);
}
