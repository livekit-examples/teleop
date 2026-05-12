'use client';

import { cn } from '@/lib/utils';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ScaleValue } from './scale-value';

const DEGREE_RANGE = 360;
const DEGREE_INCREMENT = 45;

interface DegreeScaleHorizontalProps {
  value?: number;
  degreeRange?: number;
  degreeIncrement?: number;
  isFullscreen?: boolean;
  className?: string;
}

export function ScaleHorizontal({
  value = 0,
  degreeRange = DEGREE_RANGE,
  degreeIncrement = DEGREE_INCREMENT,
  isFullscreen = false,
  className,
}: DegreeScaleHorizontalProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [pxPerDeg, setPxPerDeg] = useState(2);

  const ticks = useMemo(() => {
    return Array.from(
      { length: degreeRange / degreeIncrement + 1 },
      (_, i) => i * degreeIncrement - degreeRange / 2,
    );
  }, [degreeRange, degreeIncrement]);

  useLayoutEffect(() => {
    const el = viewportRef.current;

    if (!el) return;

    const update = () => setPxPerDeg(el.clientWidth / degreeRange);
    const ro = new ResizeObserver(update);

    update();
    ro.observe(el);

    return () => ro.disconnect();
  }, [degreeRange]);

  const stripWidth = degreeRange * pxPerDeg;

  return (
    <div className={cn('relative w-[700px] select-none', className)}>
      {isFullscreen && (
        <div className="bg-surface-2 border-input absolute inset-x-0 top-0 h-10 rounded-b-lg border border-t-transparent" />
      )}
      {/* Horizontal scale — strip translates so current value stays centered */}
      <div className="h-10 w-full">
        <div
          ref={viewportRef}
          data-slot="scale"
          className="relative h-full w-full overflow-hidden mask-[linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]"
        >
          <div
            className="absolute bottom-0 left-1/2 h-full transition-transform duration-200 ease-out will-change-transform"
            style={{
              width: stripWidth,
              transform: `translateX(${-(value + 180) * pxPerDeg}px)`,
            }}
          >
            {ticks.map((deg) => {
              const isZero = deg === 0;
              const x = (deg + 180) * pxPerDeg;

              return (
                <div
                  key={deg}
                  className="absolute bottom-0 flex grow -translate-x-1/2 flex-col items-center justify-end gap-1"
                  style={{ left: x }}
                >
                  <span className="text-foreground shrink-0 font-mono text-xs leading-6 whitespace-pre">
                    {deg >= 0 ? ` ${deg}°` : `${deg}°`}
                  </span>
                  <div className={cn(`bg-input w-0.5`, isZero ? 'h-3' : 'h-1.5')} />
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {/* Horizontal value */}
      <ScaleValue
        value={value}
        orientation="horizontal"
        className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 translate-y-full"
      />
    </div>
  );
}
