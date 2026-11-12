'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_WIDTH = 384;
const MIN_WIDTH = 320;
const MAX_WIDTH = 760;
/** Keep at least this much of the page visible beside the panel. */
const MIN_PAGE = 420;
const STORAGE_KEY = 'fleet.panelWidth';

function clamp(width: number) {
  const max = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, window.innerWidth - MIN_PAGE));
  return Math.round(Math.min(max, Math.max(MIN_WIDTH, width)));
}

/**
 * Hosts the right-hand side panels (robot details, attribute reference) and lets the
 * user drag the left edge to resize them. Arrow keys resize too; double-click resets.
 * The width is remembered in this browser.
 */
export function PanelFrame({ children }: { children: React.ReactNode }) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; width: number; id: number } | null>(null);

  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(STORAGE_KEY));
      if (saved) setWidth(clamp(saved));
    } catch {
      /* Storage blocked: use the default width. */
    }
    const onResize = () => setWidth((w) => clamp(w));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const commit = useCallback((next: number) => {
    const value = clamp(next);
    setWidth(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      /* Not remembered; still applied. */
    }
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, width, id: e.pointerId };
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    // The panel sits on the right, so dragging left makes it wider.
    setWidth(clamp(d.width + (d.x - e.clientX)));
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = null;
    setDragging(false);
    commit(d.width + (d.x - e.clientX));
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 64 : 16;
    if (e.key === 'ArrowLeft') commit(width + step);
    else if (e.key === 'ArrowRight') commit(width - step);
    else if (e.key === 'Home') commit(MIN_WIDTH);
    else if (e.key === 'End') commit(MAX_WIDTH);
    else return;
    e.preventDefault();
  };

  return (
    <div
      className={`fleet-panel-frame ${dragging ? 'dragging' : ''}`}
      style={{ '--panel-width': `${width}px` } as React.CSSProperties}
    >
      <div
        className="fleet-panel-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        aria-valuenow={width}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        tabIndex={0}
        title="Drag to resize · double-click to reset"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => commit(DEFAULT_WIDTH)}
        onKeyDown={onKeyDown}
      />
      {children}
    </div>
  );
}
