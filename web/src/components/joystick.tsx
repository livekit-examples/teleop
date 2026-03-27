'use client';

import { cn } from '@/lib/utils';
import { ChevronUp, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import { animate, motion, useMotionValue } from 'motion/react';
import { useEffect } from 'react';

import { useArrowKey } from '@/hooks/use-arrow-key';
import { usePadButtons } from '@/hooks/use-pad-buttons';
import { MAX_CONTROL_RAD_PER_SEC } from '@/lib/control-cmd';
import { Mode } from '@/lib/types';

/** size-20 (80px) container, size-8 (32px) knob — max travel from center */
const MAX_OFFSET = (100 - 32) / 2;
/** ~20 Hz to match API_README publish rate guidance */
const RATE_MS = 50;

/** Inverted stick/keys vs previous mapping; 50% of full-scale rad/s. */
const CONTROL_GAIN = MAX_CONTROL_RAD_PER_SEC * 0.5;

const spring = { type: 'spring' as const, stiffness: 420, damping: 15 };

function clampNorm(n: number): number {
  return Math.max(-1, Math.min(1, n));
}

interface JoystickProps {
  mode: Mode;
  disabled?: boolean;
  className?: string;
  /** Emits desired angular velocities (rad/s) for `control_cmd` while active. */
  onVelocities?: (pan_vel: number, tilt_vel: number) => void;
}

export function Joystick({ mode, disabled, className, onVelocities }: JoystickProps) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const keysDown = useArrowKey(mode);
  const { padHeld, padButtonHandlers } = usePadButtons(!!disabled);

  useEffect(() => {
    if (disabled || !onVelocities) return;

    const tick = () => {
      const nx = clampNorm(x.get() / MAX_OFFSET);
      const ny = clampNorm(y.get() / MAX_OFFSET);
      let kx = 0;
      let ky = 0;
      if (keysDown.includes('ArrowLeft') || padHeld.has('left')) kx -= 1;
      if (keysDown.includes('ArrowRight') || padHeld.has('right')) kx += 1;
      if (keysDown.includes('ArrowUp') || padHeld.has('up')) ky -= 1;
      if (keysDown.includes('ArrowDown') || padHeld.has('down')) ky += 1;
      const cx = clampNorm(nx + kx);
      const cy = clampNorm(ny + ky);
      // API: pan_vel positive = left, tilt_vel positive = up (inverted + half gain)
      const pan_vel = cx * CONTROL_GAIN;
      const tilt_vel = cy * CONTROL_GAIN;
      onVelocities(pan_vel, tilt_vel);
    };

    const id = setInterval(tick, RATE_MS);
    return () => clearInterval(id);
  }, [disabled, onVelocities, keysDown, padHeld, x, y]);

  const onDragEnd = () => {
    animate(x, 0, spring);
    animate(y, 0, spring);
  };

  return (
    <div className={cn('relative size-20 rounded-lg', className)}>
      <div
        className={cn(
          'text-accent-foreground absolute inset-0 grid grid-cols-[auto_auto_auto] grid-rows-[auto_auto_auto] rounded-lg border transition-colors',
          disabled
            ? 'border-accent-foreground/10 bg-accent-foreground/5 cursor-not-allowed'
            : 'border-accent-foreground/20 bg-accent-foreground/10',
        )}
      >
        <div />
        <button
          type="button"
          disabled={disabled}
          {...padButtonHandlers('up')}
          className={cn(
            'not-disabled:hover:bg-accent-foreground/10 ring-ring grid touch-manipulation place-content-center outline-none select-none not-disabled:cursor-pointer focus-visible:ring-1 disabled:opacity-20',
            (keysDown.includes('ArrowUp') || padHeld.has('up')) && 'bg-accent-foreground/20',
          )}
        >
          <ChevronUp size={16} />
        </button>
        <div />

        <button
          type="button"
          disabled={disabled}
          {...padButtonHandlers('left')}
          className={cn(
            'not-disabled:hover:bg-accent-foreground/10 ring-ring grid touch-manipulation place-content-center outline-none select-none not-disabled:cursor-pointer focus-visible:ring-1 disabled:opacity-20',
            (keysDown.includes('ArrowLeft') || padHeld.has('left')) && 'bg-accent-foreground/20',
          )}
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
            onDragEnd={onDragEnd}
            className={cn(
              'bg-accent-foreground absolute top-1/2 left-1/2 -mt-4 -ml-4 size-8 cursor-grab touch-none rounded-full border transition-colors will-change-transform active:cursor-grabbing',
              disabled && 'pointer-events-none opacity-20',
            )}
          />
        </div>
        <button
          type="button"
          disabled={disabled}
          {...padButtonHandlers('right')}
          className={cn(
            'not-disabled:hover:bg-accent-foreground/10 ring-ring grid touch-manipulation place-content-center outline-none select-none not-disabled:cursor-pointer focus-visible:ring-1 disabled:opacity-20',
            (keysDown.includes('ArrowRight') || padHeld.has('right')) && 'bg-accent-foreground/20',
          )}
        >
          <ChevronRight size={16} />
        </button>

        <div />
        <button
          type="button"
          disabled={disabled}
          {...padButtonHandlers('down')}
          className={cn(
            'not-disabled:hover:bg-accent-foreground/10 ring-ring grid touch-manipulation place-content-center outline-none select-none not-disabled:cursor-pointer focus-visible:ring-1 disabled:opacity-20',
            (keysDown.includes('ArrowDown') || padHeld.has('down')) && 'bg-accent-foreground/20',
          )}
        >
          <ChevronDown size={16} />
        </button>
        <div />
      </div>
    </div>
  );
}
