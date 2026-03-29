import {
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';

const REPEAT_MS = 100;

/**
 * Primary-button press: first step immediately, then every REPEAT_MS until release.
 * Keyboard (Enter/Space): single step per key press (no auto-repeat here).
 */
export function useRepeatStep(step: () => void) {
  const stepRef = useRef(step);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useLayoutEffect(() => {
    stepRef.current = step;
  }, [step]);

  const clear = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => () => clear(), [clear]);

  const onPointerDown = useCallback(
    (e: PointerEvent) => {
      if (e.button !== 0) return;
      stepRef.current();
      clear();
      intervalRef.current = setInterval(() => {
        stepRef.current();
      }, REPEAT_MS);
    },
    [clear],
  );

  const onPointerStop = useCallback(() => {
    clear();
  }, [clear]);

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.repeat) return;
    e.preventDefault();
    stepRef.current();
  }, []);

  return {
    onPointerDown,
    onPointerUp: onPointerStop,
    onPointerLeave: onPointerStop,
    onPointerCancel: onPointerStop,
    onKeyDown,
  };
}
