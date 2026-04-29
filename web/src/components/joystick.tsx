'use client';

import { cn } from '@/lib/utils';
import { ChevronUp, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import { animate, motion, useMotionValue, useTransform } from 'motion/react';
import { ComponentProps, useEffect } from 'react';

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

/** Ignore small analog noise around center. */
function deadzone(v: number, threshold = 0.12): number {
  return Math.abs(v) < threshold ? 0 : v;
}

/** First connected gamepad left stick: axis0 = horizontal, axis1 = vertical (MDN: − up, + down). */
function readGamepadStick(): { gx: number; gy: number } {
  const pads = navigator.getGamepads();
  for (let i = 0; i < pads.length; i++) {
    const gp = pads[i];
    if (gp?.connected) {
      return {
        gx: deadzone(gp.axes[0] ?? 0),
        gy: deadzone(gp.axes[1] ?? 0),
      };
    }
  }
  return { gx: 0, gy: 0 };
}

function DirectionButton({
  className,
  isActive,
  ...props
}: ComponentProps<'button'> & { isActive: boolean }) {
  return (
    <button
      {...props}
      className={cn(
        'not-disabled:hover:bg-muted ring-ring grid touch-manipulation place-content-center outline-none select-none not-disabled:cursor-pointer focus-visible:ring-1',
        isActive && 'bg-muted',
        className,
      )}
    />
  );
}

interface JoystickProps {
  mode: Mode;
  disabled?: boolean;
  className?: string;
  /** Emits desired angular velocities (rad/s) for `control_cmd` while active. */
  onVelocities?: (pan_vel: number, tilt_vel: number) => void;
}

export function Joystick({ mode, disabled, className, onVelocities }: JoystickProps) {
  const dragX = useMotionValue(0);
  const dragY = useMotionValue(0);
  const gx = useMotionValue(0);
  const gy = useMotionValue(0);
  const padX = useTransform(gx, (g) => g * MAX_OFFSET);
  const padY = useTransform(gy, (g) => g * MAX_OFFSET);
  const keysDown = useArrowKey(mode);
  const { padHeld, padButtonHandlers } = usePadButtons(!!disabled);

  useEffect(() => {
    if (disabled) {
      gx.set(0);
      gy.set(0);
      return;
    }

    let id = 0;
    const loop = () => {
      const { gx: nextGx, gy: nextGy } = readGamepadStick();
      gx.set(nextGx);
      gy.set(nextGy);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [disabled, gx, gy]);

  useEffect(() => {
    if (disabled || !onVelocities) return;

    const tick = () => {
      const nx = clampNorm(dragX.get() / MAX_OFFSET);
      const ny = clampNorm(dragY.get() / MAX_OFFSET);
      let kx = 0;
      let ky = 0;

      if (keysDown.includes('ArrowLeft') || padHeld.has('left')) kx -= 1;
      if (keysDown.includes('ArrowRight') || padHeld.has('right')) kx += 1;
      if (keysDown.includes('ArrowUp') || padHeld.has('up')) ky -= 1;
      if (keysDown.includes('ArrowDown') || padHeld.has('down')) ky += 1;

      const gxr = gx.get();
      const gyr = gy.get();
      const cx = clampNorm(nx + kx + gxr);
      const cy = clampNorm(ny + ky + gyr);
      // API: pan_vel positive = left, tilt_vel positive = up (inverted + half gain)
      const pan_vel = cx * CONTROL_GAIN;
      const tilt_vel = cy * CONTROL_GAIN;

      onVelocities(pan_vel, tilt_vel);
    };

    const id = setInterval(tick, RATE_MS);
    return () => clearInterval(id);
  }, [disabled, keysDown, padHeld, dragX, dragY, gx, gy, onVelocities]);

  const onDragEnd = () => {
    animate(dragX, 0, spring);
    animate(dragY, 0, spring);
  };

  return (
    <div className={cn('bg-surface relative size-20 rounded-lg', className)}>
      <div
        className={cn(
          'bg-input/30 text-foreground border-foreground/50 absolute inset-0 grid grid-cols-[auto_40px_auto] grid-rows-[auto_40px_auto] rounded-lg border opacity-100 transition-[colors,opacity]',
          disabled && 'cursor-not-allowed opacity-30',
        )}
      >
        <div />
        <DirectionButton
          type="button"
          disabled={disabled}
          {...padButtonHandlers('up')}
          isActive={keysDown.includes('ArrowUp') || padHeld.has('up')}
        >
          <ChevronUp size={16} />
        </DirectionButton>
        <div />

        <DirectionButton
          type="button"
          disabled={disabled}
          {...padButtonHandlers('left')}
          isActive={keysDown.includes('ArrowLeft') || padHeld.has('left')}
        >
          <ChevronLeft size={16} />
        </DirectionButton>
        <div className="relative">
          <motion.div
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
            style={{ x: padX, y: padY }}
          >
            <motion.div
              drag={!disabled}
              style={{ x: dragX, y: dragY }}
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
                'bg-primary-foreground/50 border-foreground pointer-events-auto size-10 cursor-grab touch-none rounded-full border transition-colors will-change-transform active:cursor-grabbing',
                disabled && 'pointer-events-none',
              )}
            />
          </motion.div>
        </div>
        <DirectionButton
          type="button"
          disabled={disabled}
          {...padButtonHandlers('right')}
          isActive={keysDown.includes('ArrowRight') || padHeld.has('right')}
        >
          <ChevronRight size={16} />
        </DirectionButton>

        <div />
        <DirectionButton
          type="button"
          disabled={disabled}
          {...padButtonHandlers('down')}
          isActive={keysDown.includes('ArrowDown') || padHeld.has('down')}
        >
          <ChevronDown size={16} />
        </DirectionButton>
        <div />
      </div>
    </div>
  );
}
