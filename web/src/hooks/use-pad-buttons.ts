import { useCallback, useEffect, useState } from 'react';

export type PadDir = 'up' | 'down' | 'left' | 'right';

function addPadDir(prev: Set<PadDir>, d: PadDir): Set<PadDir> {
  const next = new Set(prev);
  next.add(d);
  return next;
}

function delPadDir(prev: Set<PadDir>, d: PadDir): Set<PadDir> {
  const next = new Set(prev);
  next.delete(d);
  return next;
}

/**
 * Tracks which on-screen directional pad buttons are held down.
 *
 * Returns `padHeld` (the set of active directions) and `padButtonHandlers(dir)`
 * which wires up `onPointerDown` / `onPointerUp` / `onPointerCancel` with pointer
 * capture for reliable drag-off handling. Clears all held directions on window blur
 * or when `disabled` becomes true.
 */
export function usePadButtons(disabled: boolean) {
  const [padHeld, setPadHeld] = useState<Set<PadDir>>(() => new Set());

  useEffect(() => {
    const clearPad = () => setPadHeld(new Set());
    window.addEventListener('blur', clearPad);
    return () => window.removeEventListener('blur', clearPad);
  }, []);

  useEffect(() => {
    if (!disabled) return;
    const id = requestAnimationFrame(() => setPadHeld(new Set()));
    return () => cancelAnimationFrame(id);
  }, [disabled]);

  const padButtonHandlers = useCallback(
    (dir: PadDir) =>
      disabled
        ? {}
        : {
            onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              setPadHeld((prev) => addPadDir(prev, dir));
            },
            onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => {
              setPadHeld((prev) => delPadDir(prev, dir));
              try {
                e.currentTarget.releasePointerCapture(e.pointerId);
              } catch {
                /* already released */
              }
            },
            onPointerCancel: () => {
              setPadHeld((prev) => delPadDir(prev, dir));
            },
          },
    [disabled],
  );

  return { padHeld, padButtonHandlers };
}
