import { useEffect } from 'react';

export function useVideoFitContainer(mainVideoEl: HTMLVideoElement | null) {
  useEffect(() => {
    if (!mainVideoEl) return;

    const container = mainVideoEl.parentElement;
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const containerAspectRatio = width / height;
        const videoAspectRatio = mainVideoEl.width / mainVideoEl.height;

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
  }, [mainVideoEl]);
}
