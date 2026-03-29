import { useEffect, useRef, useState } from 'react';
import { Mode } from '@/lib/types';

const ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}

/**
 * Tracks which arrow keys are currently held down.
 *
 * Listens for `keydown` / `keyup` on the window and maintains a set of held arrow
 * keys. Ignores events when `mode` is `'view'`, when the target is an editable
 * element, or on key-repeat. All keys are released on window blur or unmount.
 */
export function useArrowKey(mode: Mode) {
  const heldRef = useRef(new Set<string>());
  const [keysDown, setKeysDown] = useState<string[]>([]);

  useEffect(() => {
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
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (!ARROW_KEYS.has(e.key)) return;
      if (!heldRef.current.has(e.key)) return;
      heldRef.current.delete(e.key);
      setKeysDown([...heldRef.current]);
    };

    const releaseAll = () => {
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
  }, [mode, setKeysDown]);

  return keysDown;
}
