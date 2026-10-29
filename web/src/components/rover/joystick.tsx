'use client';

import { useEffect, useRef, useState, type ComponentProps, type PointerEvent } from 'react';
import { ChevronUp, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import { animate, motion, useMotionValue, useTransform } from 'motion/react';
import { MAX_CONTROL_RPS } from './commands';

/**
 * One analog stick. Drag the knob, hold the on-screen arrows, press the arrow
 * keys, or push a gamepad stick — every source is summed and emitted at a fixed
 * rate as a pair of velocities.
 */

/** size-20 (80px) frame, size-10 (40px) knob — max travel from centre. */
const MAX_OFFSET = (100 - 32) / 2;
/** ~20 Hz, matching the rover's documented publish rate. */
const RATE_MS = 50;
const KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'] as const;
type Key = (typeof KEYS)[number];
const SPRING = { type: 'spring' as const, stiffness: 420, damping: 15 };

const clampNorm = (n: number) => Math.max(-1, Math.min(1, n));
/** Ignore analog noise around a stick's centre. */
const deadzone = (v: number) => (Math.abs(v) < 0.12 ? 0 : v);

/** Arrow keys currently held. Ignored while `active` is false, in a text field,
 *  or on key-repeat; everything releases on window blur. */
function useHeldKeys(active: boolean): Set<Key> {
  const [held, setHeld] = useState<Set<Key>>(() => new Set());

  useEffect(() => {
    const isKey = (k: string): k is Key => (KEYS as readonly string[]).includes(k);
    const editable = (t: EventTarget | null) =>
      t instanceof HTMLElement &&
      (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

    const down = (e: KeyboardEvent) => {
      if (!active || e.repeat || !isKey(e.key) || editable(e.target)) return;
      e.preventDefault();
      setHeld((prev) => (prev.has(e.key as Key) ? prev : new Set(prev).add(e.key as Key)));
    };
    const up = (e: KeyboardEvent) => {
      if (!isKey(e.key)) return;
      setHeld((prev) => {
        if (!prev.has(e.key as Key)) return prev;
        const next = new Set(prev);
        next.delete(e.key as Key);
        return next;
      });
    };
    const releaseAll = () => setHeld(new Set());

    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', releaseAll);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', releaseAll);
      releaseAll();
    };
  }, [active]);

  return held;
}

type Dir = 'up' | 'down' | 'left' | 'right';
const DIR_KEY: Record<Dir, Key> = {
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
};

export function Joystick({
  active,
  className,
  velocityGain = MAX_CONTROL_RPS * 0.5,
  keyboard = true,
  gamepadStick = 'left',
  horizontal = true,
  vertical = true,
  onVelocities,
}: {
  /** Inputs are only read while this is true. */
  active: boolean;
  className?: string;
  /** Magnitude emitted at full deflection. */
  velocityGain?: number;
  /** Enable window arrow keys for this joystick. */
  keyboard?: boolean;
  /** Which gamepad stick to read, or false for none. */
  gamepadStick?: 'left' | 'right' | false;
  /** When false, that axis is held at 0 and its arrows/drag/gamepad are ignored. */
  horizontal?: boolean;
  vertical?: boolean;
  /** Vertical then horizontal velocity; up and left are positive. */
  onVelocities: (vertical: number, horizontal: number) => void;
}) {
  const dragX = useMotionValue(0);
  const dragY = useMotionValue(0);
  const padX = useMotionValue(0);
  const padY = useMotionValue(0);
  const knobX = useTransform(padX, (g) => g * MAX_OFFSET);
  const knobY = useTransform(padY, (g) => g * MAX_OFFSET);
  const keysDown = useHeldKeys(active && keyboard);
  const [pressed, setPressed] = useState<Set<Dir>>(() => new Set());

  useEffect(() => {
    if (!horizontal) {
      dragX.set(0);
      padX.set(0);
    }
    if (!vertical) {
      dragY.set(0);
      padY.set(0);
    }
  }, [horizontal, vertical, dragX, dragY, padX, padY]);

  // Gamepad axes are polled, not evented.
  useEffect(() => {
    if (!active || gamepadStick === false) {
      padX.set(0);
      padY.set(0);
      return;
    }
    const axis = gamepadStick === 'right' ? 2 : 0;
    let raf = requestAnimationFrame(function poll() {
      const pad = navigator.getGamepads().find((g) => g?.connected);
      padX.set(horizontal ? deadzone(pad?.axes[axis] ?? 0) : 0);
      padY.set(vertical ? deadzone(pad?.axes[axis + 1] ?? 0) : 0);
      raf = requestAnimationFrame(poll);
    });
    return () => cancelAnimationFrame(raf);
  }, [active, gamepadStick, horizontal, vertical, padX, padY]);

  const emit = useRef(onVelocities);
  emit.current = onVelocities;

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      const down = (dir: Dir) => (pressed.has(dir) || keysDown.has(DIR_KEY[dir]) ? 1 : 0);
      const x = horizontal
        ? clampNorm(dragX.get() / MAX_OFFSET + down('right') - down('left') + padX.get())
        : 0;
      const y = vertical
        ? clampNorm(dragY.get() / MAX_OFFSET + down('down') - down('up') + padY.get())
        : 0;
      // Up and left are positive; the consumer maps them to its own axes.
      emit.current(-y * velocityGain, -x * velocityGain);
    }, RATE_MS);
    return () => clearInterval(id);
  }, [active, keysDown, pressed, dragX, dragY, padX, padY, velocityGain, horizontal, vertical]);

  const hold = (dir: Dir, held: boolean) =>
    setPressed((prev) => {
      const next = new Set(prev);
      if (held) next.add(dir);
      else next.delete(dir);
      return next;
    });

  useEffect(() => {
    const clear = () => setPressed(new Set());
    window.addEventListener('blur', clear);
    return () => window.removeEventListener('blur', clear);
  }, []);

  const arrow = (dir: Dir, icon: ComponentProps<'button'>['children'], enabled: boolean) => (
    <button
      type="button"
      disabled={!enabled}
      onPointerDown={(e: PointerEvent<HTMLButtonElement>) => {
        if (!enabled) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        hold(dir, true);
      }}
      onPointerUp={() => hold(dir, false)}
      onPointerCancel={() => hold(dir, false)}
      className={
        'ring-ring hover:bg-foreground/10 grid cursor-pointer touch-manipulation place-content-center outline-none select-none focus-visible:ring-1 disabled:pointer-events-none disabled:opacity-30 ' +
        (enabled && (pressed.has(dir) || keysDown.has(DIR_KEY[dir])) ? 'bg-foreground/10' : '')
      }
    >
      {icon}
    </button>
  );

  return (
    <div className={'relative size-20 rounded-lg ' + (className ?? '')}>
      <div className="border-input bg-surface text-foreground absolute inset-0 grid grid-cols-[auto_40px_auto] grid-rows-[auto_40px_auto] rounded-lg border">
        <div />
        {arrow('up', <ChevronUp size={16} />, vertical)}
        <div />

        {arrow('left', <ChevronLeft size={16} />, horizontal)}
        <div className="relative">
          <motion.div
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
            style={{ x: knobX, y: knobY }}
          >
            <motion.div
              drag
              style={{ x: dragX, y: dragY }}
              dragConstraints={{
                left: horizontal ? -MAX_OFFSET : 0,
                right: horizontal ? MAX_OFFSET : 0,
                top: vertical ? -MAX_OFFSET : 0,
                bottom: vertical ? MAX_OFFSET : 0,
              }}
              dragElastic={0.02}
              dragMomentum={false}
              onDragEnd={() => {
                animate(dragX, 0, SPRING);
                animate(dragY, 0, SPRING);
              }}
              className="border-input bg-surface pointer-events-auto size-10 cursor-grab touch-none rounded-full border will-change-transform active:cursor-grabbing"
            />
          </motion.div>
        </div>
        {arrow('right', <ChevronRight size={16} />, horizontal)}

        <div />
        {arrow('down', <ChevronDown size={16} />, vertical)}
        <div />
      </div>
    </div>
  );
}
