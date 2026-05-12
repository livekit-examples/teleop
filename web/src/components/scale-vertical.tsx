'use client';

import { cn } from '@/lib/utils';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';

import { ScaleValue } from './scale-value';

const DEGREE_RANGE = 360;
const DEGREE_INCREMENT = 45;

interface DegreeScaleVerticalProps {
  value?: number;
  degreeRange?: number;
  degreeIncrement?: number;
  isFullscreen?: boolean;
  className?: string;
}
export function ScaleVertical({
  value = 0,
  degreeRange = DEGREE_RANGE,
  degreeIncrement = DEGREE_INCREMENT,
  isFullscreen = false,
  className,
}: DegreeScaleVerticalProps) {
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

    const update = () => setPxPerDeg(el.clientHeight / degreeRange);
    const ro = new ResizeObserver(update);

    update();
    ro.observe(el);

    return () => ro.disconnect();
  }, [degreeRange]);

  const stripHeight = degreeRange * pxPerDeg;

  return (
    <div className={cn('relative h-[500px] select-none', className)}>
      {isFullscreen && (
        <div className="bg-surface-2 border-input absolute inset-y-0 left-0 w-12 rounded-r-lg border border-l-transparent" />
      )}
      {/* Vertical scale — strip translates so current value stays centered */}
      <div className="h-full w-12">
        <div
          ref={viewportRef}
          data-slot="scale"
          className="relative h-full w-full overflow-hidden mask-[linear-gradient(to_bottom,transparent,black_8%,black_92%,transparent)]"
        >
          <div
            className="absolute top-1/2 left-0 w-full transition-transform duration-200 ease-out will-change-transform"
            style={{
              height: stripHeight,
              transform: `translateY(${-(180 - value) * pxPerDeg}px)`,
            }}
          >
            {ticks.map((deg) => {
              const isZero = deg === 0;
              const y = (180 - deg) * pxPerDeg;
              return (
                <div
                  key={deg}
                  className="absolute right-0 flex -translate-y-1/2 items-center justify-end gap-1"
                  style={{ top: y }}
                >
                  <span className="text-foreground shrink-0 text-right font-mono text-xs leading-6 whitespace-nowrap">
                    {deg}°
                  </span>
                  <div className={cn(`bg-input h-0.5`, isZero ? 'w-3' : 'w-1.5')} />
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {/* Vertical value */}
      <ScaleValue
        value={value}
        orientation="vertical"
        className="absolute top-1/2 -right-0.5 translate-x-full -translate-y-1/2"
      />
    </div>
  );
}
