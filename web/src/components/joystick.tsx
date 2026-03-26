'use client';

import { cn } from '@/lib/utils';
import { ChevronUp, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import { animate, motion, useMotionValue } from 'motion/react';
import { type Dispatch, type SetStateAction, useEffect, useRef } from 'react';

import { useRepeatStep } from '@/hooks/use-repeat-step';
import { useArrowKeyDegrees } from '@/hooks/use-arrow-key-degrees';
import { Mode } from '@/lib/types';

/** size-20 (80px) container, size-8 (32px) knob — max travel from center */
const MAX_OFFSET = (100 - 32) / 2;
const MAX_DEG_PER_TICK = 1;
const RATE_MS = 20;

const spring = { type: 'spring' as const, stiffness: 420, damping: 15 };

function clampDeg(n: number): number {
  return Math.max(-180, Math.min(180, n));
}

function clampNorm(n: number): number {
  return Math.max(-1, Math.min(1, n));
}

interface JoystickProps {
  mode: Mode;
  setYaw: Dispatch<SetStateAction<number>>;
  setPitch: Dispatch<SetStateAction<number>>;
  disabled?: boolean;
  className?: string;
}

export function Joystick({ mode, setYaw, setPitch, disabled, className }: JoystickProps) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const keysDown = useArrowKeyDegrees(mode, setPitch, setYaw);

  const clearRateLoop = () => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const tick = () => {
    const nx = clampNorm(x.get() / MAX_OFFSET);
    const ny = clampNorm(y.get() / MAX_OFFSET);
    const dYaw = nx * MAX_DEG_PER_TICK;
    const dPitch = -ny * MAX_DEG_PER_TICK;
    if (dYaw === 0 && dPitch === 0) return;
    setYaw((y) => clampDeg(y + dYaw));
    setPitch((p) => clampDeg(p + dPitch));
  };

  const onDragStart = () => {
    clearRateLoop();
    tick();
    intervalRef.current = setInterval(tick, RATE_MS);
  };

  const onDragEnd = () => {
    clearRateLoop();
    animate(x, 0, spring);
    animate(y, 0, spring);
  };

  useEffect(() => () => clearRateLoop(), []);

  const repeatPitchUp = useRepeatStep(() => setPitch((p) => clampDeg(p + 1)));
  const repeatPitchDown = useRepeatStep(() => setPitch((p) => clampDeg(p - 1)));
  const repeatYawLeft = useRepeatStep(() => setYaw((y) => clampDeg(y - 1)));
  const repeatYawRight = useRepeatStep(() => setYaw((y) => clampDeg(y + 1)));

  return (
    <div className={cn('size-20 relative rounded-lg', className)}>
      <div
        className={cn(
          'grid inset-0 absolute rounded-lg border grid-cols-[auto_auto_auto] grid-rows-[auto_auto_auto] text-accent-foreground transition-colors',
          disabled
            ? 'cursor-not-allowed border-accent-foreground/10 bg-accent-foreground/5'
            : 'border-accent-foreground/20 bg-accent-foreground/10',
        )}
      >
        <div />
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'grid place-content-center disabled:opacity-20 not-disabled:cursor-pointer not-disabled:hover:bg-accent-foreground/10',
            keysDown.includes('ArrowUp') && 'bg-accent-foreground/20',
          )}
          {...repeatPitchUp}
        >
          <ChevronUp size={16} />
        </button>
        <div />

        <button
          type="button"
          disabled={disabled}
          className={cn(
            'grid place-content-center disabled:opacity-20 not-disabled:cursor-pointer not-disabled:hover:bg-accent-foreground/10',
            keysDown.includes('ArrowLeft') && 'bg-accent-foreground/20',
          )}
          {...repeatYawLeft}
        >
          <ChevronLeft size={16} />
        </button>
        <div className="relative">
          <motion.div
            drag={!disabled}
            style={{ x, y }}
            dragConstraints={{
              left: -MAX_OFFSET,
              right: MAX_OFFSET,
              top: -MAX_OFFSET,
              bottom: MAX_OFFSET,
            }}
            dragElastic={0.02}
            dragMomentum={false}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            className={cn(
              'absolute left-1/2 top-1/2 -ml-4 -mt-4 size-8 cursor-grab bg-accent-foreground touch-none rounded-full border transition-colors will-change-transform active:cursor-grabbing',
              disabled && 'pointer-events-none opacity-20',
            )}
          />
        </div>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'grid place-content-center disabled:opacity-20 not-disabled:cursor-pointer not-disabled:hover:bg-accent-foreground/10',
            keysDown.includes('ArrowRight') && 'bg-accent-foreground/20',
          )}
          {...repeatYawRight}
        >
          <ChevronRight size={16} />
        </button>

        <div />
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'grid place-content-center disabled:opacity-20 not-disabled:cursor-pointer not-disabled:hover:bg-accent-foreground/10',
            keysDown.includes('ArrowDown') && 'bg-accent-foreground/20',
          )}
          {...repeatPitchDown}
        >
          <ChevronDown size={16} />
        </button>
        <div />
      </div>
    </div>
  );
}
