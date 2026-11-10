'use client';

import {
  GAUGE_DEFAULT_MAX,
  GAUGE_DEFAULT_MIN,
  GAUGE_START_DEG,
  GAUGE_SWEEP_DEG,
  gaugeColor,
  gaugeColors,
  gaugeFraction,
  gaugeOverflow,
} from '@/lib/teleop/gauge';
import type { Panel } from '@/lib/teleop/types';

const CX = 100;
const CY = 100;
const R = 80;
const STROKE = 14;
/** Colored fills are drawn as short arc segments, since SVG has no gradient along a path. */
const SEGMENT_DEG = 2;

const point = (deg: number) => {
  const rad = (deg * Math.PI) / 180;
  return [CX + R * Math.cos(rad), CY + R * Math.sin(rad)] as const;
};
/** SVG path for the arc between two screen angles (degrees, clockwise). */
const arc = (from: number, to: number) => {
  const [x0, y0] = point(from);
  const [x1, y1] = point(to);
  const large = to - from > 180 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${R} ${R} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};
const angle = (fraction: number) => GAUGE_START_DEG + GAUGE_SWEEP_DEG * fraction;
const format = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 4 });

/** The filled arc blended from the min color up to the value's color, with round ends. */
function ColoredFill({ fraction, min, max }: { fraction: number; min: string; max: string }) {
  const count = Math.max(1, Math.ceil((GAUGE_SWEEP_DEG * fraction) / SEGMENT_DEG));
  const tip = gaugeColor(fraction, min, max);
  const [x0, y0] = point(angle(0));
  const [x1, y1] = point(angle(fraction));
  return (
    <g className="gauge-fill-colored" style={{ filter: `drop-shadow(0 0 4px ${tip}73)` }}>
      {Array.from({ length: count }, (_, i) => {
        const from = (fraction * i) / count;
        const to = (fraction * (i + 1)) / count;
        return (
          <path
            key={i}
            d={arc(angle(from), Math.min(angle(to) + 0.4, angle(fraction)))}
            stroke={gaugeColor((from + to) / 2, min, max)}
          />
        );
      })}
      <circle cx={x0} cy={y0} r={STROKE / 2} fill={gaugeColor(0, min, max)} />
      <circle cx={x1} cy={y1} r={STROKE / 2} fill={tip} />
    </g>
  );
}

export function Gauge({ panel, value, dim }: { panel: Panel; value: unknown; dim: boolean }) {
  const min = panel.settings.min ?? GAUGE_DEFAULT_MIN;
  const max = panel.settings.max ?? GAUGE_DEFAULT_MAX;
  const colors = gaugeColors(panel.settings);
  const known = typeof value === 'number' && Number.isFinite(value);
  const fraction = known ? gaugeFraction(value, min, max) : 0;
  const overflow = known ? gaugeOverflow(value, min, max) : undefined;
  const [minX, minY] = point(angle(0));
  const [maxX, maxY] = point(angle(1));
  const classes = ['gauge', dim && 'is-dim', overflow && 'is-overflow', colors && 'is-colored'];
  return (
    <div className={classes.filter(Boolean).join(' ')}>
      <svg
        viewBox="0 0 200 182"
        role="meter"
        aria-label={panel.label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={known ? value : undefined}
      >
        <path className="gauge-track" d={arc(angle(0), angle(1))} />
        {fraction > 0 &&
          (colors ? (
            <ColoredFill fraction={fraction} min={colors.min} max={colors.max} />
          ) : (
            <path className="gauge-fill" d={arc(angle(0), angle(fraction))} />
          ))}
        <text className="gauge-value" x={CX} y={CY + 4}>
          {known ? format(value) : '—'}
        </text>
        {overflow && (
          <text className="gauge-overflow" x={CX} y={CY + 30}>
            {overflow === 'over' ? '▲ over max' : '▼ under min'}
          </text>
        )}
        <text className="gauge-bound" x={minX} y={minY + 20}>
          {format(min)}
        </text>
        <text className="gauge-bound" x={maxX} y={maxY + 20}>
          {format(max)}
        </text>
      </svg>
    </div>
  );
}
