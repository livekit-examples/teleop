import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from 'react';
import { Mode } from '@/lib/types';

const ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

const REPEAT_MS = 100;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}

/**
 * While arrow keys are held: adjust pitch (up/down) and yaw (left/right) once per REPEAT_MS.
 */
export function useArrowKeyDegrees(
  mode: Mode,
  setPitch: Dispatch<SetStateAction<number>>,
  setYaw: Dispatch<SetStateAction<number>>,
) {
  const heldRef = useRef(new Set<string>());
  const [keysDown, setKeysDown] = useState<string[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const clearIntervalIfIdle = () => {
      if (heldRef.current.size === 0 && intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    const tick = () => {
      let dp = 0;
      let dy = 0;
      if (heldRef.current.has('ArrowUp')) dp += 1;
      if (heldRef.current.has('ArrowDown')) dp -= 1;
      if (heldRef.current.has('ArrowRight')) dy += 1;
      if (heldRef.current.has('ArrowLeft')) dy -= 1;
      if (dp !== 0) setPitch((p) => p + dp);
      if (dy !== 0) setYaw((y) => y + dy);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (mode === 'view') return;
      if (!ARROW_KEYS.has(e.key)) return;
      if (isEditableTarget(e.target)) return;
      if (e.repeat) return;
      e.preventDefault();
      const k = e.key;
      if (heldRef.current.has(k)) return;
      heldRef.current.add(k);
      setKeysDown([...heldRef.current]);
      tick();
      if (intervalRef.current === null) {
        intervalRef.current = setInterval(tick, REPEAT_MS);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (!ARROW_KEYS.has(e.key)) return;
      if (!heldRef.current.has(e.key)) return;
      heldRef.current.delete(e.key);
      setKeysDown([...heldRef.current]);
      clearIntervalIfIdle();
    };

    const releaseAll = () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      heldRef.current.clear();
      setKeysDown([]);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', releaseAll);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', releaseAll);
      releaseAll();
    };
  }, [mode, setPitch, setYaw, setKeysDown]);

  return keysDown;
}
