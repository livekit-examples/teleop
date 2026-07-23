'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { cn } from '@/lib/utils';
import type { ImuSample } from '@/hooks/use-imu-history';

/** Trailing time window shown on the x-axis. */
const WINDOW_MS = 10_000;
const X_TICK_MS = 2_000;
/** Effective panel surface: `--card` (15% accent) composited over `--background`. */
const SURFACE = '#0b262b';

type SeriesSpec = {
  label: string;
  /** Theme token carrying the series color, with a resolved fallback. */
  cssVar: string;
  fallback: string;
  get: (s: ImuSample) => number;
};

type ChartSpec = {
  title: string;
  unit: string;
  decimals: number;
  series: SeriesSpec[];
};

/*
 * Color follows the entity: the first series of each chart is chart-1, the Y
 * axis always chart-2. One value axis per chart — angular velocity and linear
 * acceleration are different scales, so they get separate charts.
 */
const CHARTS: ChartSpec[] = [
  {
    title: 'Angular velocity',
    unit: '°/s',
    decimals: 1,
    series: [
      { label: 'ωz', cssVar: '--chart-1', fallback: '#20d5f9', get: (s) => s.angVelZ },
      { label: 'ωy', cssVar: '--chart-2', fallback: '#ba1ff9', get: (s) => s.angVelY },
    ],
  },
  {
    title: 'Linear accel',
    unit: 'm/s²',
    decimals: 2,
    series: [
      { label: 'ax', cssVar: '--chart-1', fallback: '#20d5f9', get: (s) => s.linAccX },
      { label: 'ay', cssVar: '--chart-2', fallback: '#ba1ff9', get: (s) => s.linAccY },
    ],
  },
];

function cssColor(el: HTMLElement, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v && !v.includes('var(') ? v : fallback;
}

/** Smallest 1/2/5×10ⁿ step giving at most `target` intervals over `range`. */
function niceStep(range: number, target: number): number {
  const raw = range / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5]) {
    if (raw <= m * mag) return m * mag;
  }
  return 10 * mag;
}

function formatValue(v: number, decimals: number): string {
  return v.toFixed(decimals);
}

function SeriesChart({
  spec,
  samplesRef,
}: {
  spec: ChartSpec;
  samplesRef: RefObject<ImuSample[]>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const valueRefs = useRef<Array<HTMLSpanElement | null>>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const hover = { x: 0, y: 0, active: false };
    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      hover.x = e.clientX - rect.left;
      hover.y = e.clientY - rect.top;
      hover.active = true;
    };
    const onPointerLeave = () => {
      hover.active = false;
    };
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', onPointerLeave);

    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);

      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const dpr = window.devicePixelRatio || 1;
      const pxW = Math.round(rect.width * dpr);
      const pxH = Math.round(rect.height * dpr);
      if (canvas.width !== pxW || canvas.height !== pxH) {
        canvas.width = pxW;
        canvas.height = pxH;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);

      const gridColor = cssColor(canvas, '--border', 'rgba(32,213,249,0.25)');
      const mutedInk = cssColor(canvas, '--muted-foreground', '#17889f');
      const primaryInk = cssColor(canvas, '--card-foreground', '#20d5f9');
      const font = `10px ${getComputedStyle(canvas).fontFamily}`;
      ctx.font = font;

      const all = samplesRef.current;
      if (all.length === 0) {
        ctx.fillStyle = mutedInk;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('waiting for imu data…', rect.width / 2, rect.height / 2);
        for (const el of valueRefs.current) {
          if (el) el.textContent = '—';
        }
        return;
      }

      // Plot area: room for x-axis labels below, endpoint dot at the right edge
      const plot = { x: 0, y: 4, w: rect.width - 8, h: rect.height - 22 };
      const tNow = all[all.length - 1].t;
      const t0 = tNow - WINDOW_MS;
      let start = all.findIndex((s) => s.t >= t0);
      if (start === -1) start = all.length - 1;
      // Keep one sample before the window so lines enter from the left edge
      const visible = all.slice(Math.max(0, start - 1));

      let min = Infinity;
      let max = -Infinity;
      for (const s of visible) {
        for (const serie of spec.series) {
          const v = serie.get(s);
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
      const pad = Math.max((max - min) * 0.1, 10 ** -spec.decimals * 5);
      min -= pad;
      max += pad;

      const xOf = (t: number) => plot.x + ((t - t0) / WINDOW_MS) * plot.w;
      const yOf = (v: number) => plot.y + plot.h - ((v - min) / (max - min)) * plot.h;

      // Horizontal gridlines at clean values, hairline, recessive
      const step = niceStep(max - min, 4);
      const tickDecimals = Math.max(0, -Math.floor(Math.log10(step)));
      ctx.strokeStyle = gridColor;
      ctx.fillStyle = mutedInk;
      ctx.lineWidth = 1;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      for (let v = Math.ceil(min / step) * step; v <= max; v += step) {
        const y = Math.round(yOf(v)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(plot.x, y);
        ctx.lineTo(plot.x + plot.w, y);
        ctx.stroke();
        ctx.fillText(v.toFixed(tickDecimals), plot.x + 4, y - 2);
      }

      // X-axis tick labels (relative seconds)
      ctx.textBaseline = 'top';
      for (let k = 0; k * X_TICK_MS <= WINDOW_MS; k++) {
        const x = xOf(tNow - k * X_TICK_MS);
        ctx.textAlign = k === 0 ? 'right' : 'center';
        ctx.fillText(k === 0 ? '0s' : `-${(k * X_TICK_MS) / 1000}s`, x, plot.y + plot.h + 6);
      }

      // Series lines: 2px, round join/cap, clipped to the plot area
      ctx.save();
      ctx.beginPath();
      ctx.rect(plot.x, plot.y, plot.w, plot.h);
      ctx.clip();
      for (const serie of spec.series) {
        const color = cssColor(canvas, serie.cssVar, serie.fallback);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        visible.forEach((s, i) => {
          const x = xOf(s.t);
          const y = yOf(serie.get(s));
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }
      ctx.restore();

      // Endpoint markers: ≥8px dot with a 2px surface ring
      const latest = all[all.length - 1];
      spec.series.forEach((serie, i) => {
        const color = cssColor(canvas, serie.cssVar, serie.fallback);
        const x = xOf(latest.t);
        const y = Math.min(Math.max(yOf(serie.get(latest)), plot.y), plot.y + plot.h);
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.strokeStyle = SURFACE;
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();

        const el = valueRefs.current[i];
        if (el) el.textContent = formatValue(serie.get(latest), spec.decimals);
      });

      // Hover: crosshair + tooltip with per-series values at the nearest sample
      if (hover.active && hover.x >= plot.x && hover.x <= plot.x + plot.w) {
        const tHover = t0 + ((hover.x - plot.x) / plot.w) * WINDOW_MS;
        let nearest = visible[0];
        for (const s of visible) {
          if (Math.abs(s.t - tHover) < Math.abs(nearest.t - tHover)) nearest = s;
        }

        const cx = Math.round(xOf(nearest.t)) + 0.5;
        ctx.strokeStyle = mutedInk;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, plot.y);
        ctx.lineTo(cx, plot.y + plot.h);
        ctx.stroke();

        const rows = spec.series.map(
          (serie) => [serie.label, formatValue(serie.get(nearest), spec.decimals)] as const,
        );
        const timeLabel = `${((nearest.t - tNow) / 1000).toFixed(1)}s`;
        const rowH = 14;
        const padBox = 6;
        const swatch = 6;
        let boxW = ctx.measureText(timeLabel).width;
        for (const [label, value] of rows) {
          boxW = Math.max(boxW, swatch + 4 + ctx.measureText(`${label} ${value}`).width);
        }
        boxW += padBox * 2;
        const boxH = padBox * 2 + rowH * (rows.length + 1) - 4;
        let bx = cx + 10;
        if (bx + boxW > plot.x + plot.w) bx = cx - 10 - boxW;
        const by = Math.min(Math.max(hover.y - boxH / 2, plot.y), plot.y + plot.h - boxH);

        ctx.fillStyle = 'rgba(11, 38, 43, 0.95)';
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(bx, by, boxW, boxH, 4);
        ctx.fill();
        ctx.stroke();

        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = mutedInk;
        ctx.fillText(timeLabel, bx + padBox, by + padBox);
        rows.forEach(([label, value], i) => {
          const ry = by + padBox + rowH * (i + 1);
          const color = cssColor(canvas, spec.series[i].cssVar, spec.series[i].fallback);
          ctx.fillStyle = color;
          ctx.fillRect(bx + padBox, ry + 2, swatch, swatch);
          ctx.fillStyle = primaryInk;
          ctx.fillText(`${label} ${value}`, bx + padBox + swatch + 4, ry);
        });
      }
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
    };
  }, [spec, samplesRef]);

  return (
    <div className="grid gap-1">
      {/* Title + legend with live values (identity via swatch; text stays in ink tokens) */}
      <div className="flex items-baseline justify-between">
        <div className="opacity-50">
          {spec.title} ({spec.unit})
        </div>
        <div className="flex gap-3">
          {spec.series.map((serie, i) => (
            <span key={serie.label} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="size-2 rounded-[2px]"
                style={{ background: `var(${serie.cssVar}, ${serie.fallback})` }}
              />
              <span className="opacity-50">{serie.label}</span>
              <span
                ref={(el) => {
                  valueRefs.current[i] = el;
                }}
                className="inline-block w-12 text-right tabular-nums"
              >
                —
              </span>
            </span>
          ))}
        </div>
      </div>
      <canvas ref={canvasRef} className="h-[110px] w-full" />
    </div>
  );
}

interface ImuPlotProps {
  samplesRef: RefObject<ImuSample[]>;
  className?: string;
}

/**
 * Live IMU telemetry plot: angular velocity (Z/Y, °/s) and linear acceleration
 * (Z/Y, m/s²) against message timestamp, over a trailing {@link WINDOW_MS} window.
 * Reads samples from the {@link useImuHistory} buffer on animation frames.
 */
export function ImuPlot({ samplesRef, className }: ImuPlotProps) {
  return (
    <div className={cn('grid gap-4', className)}>
      {CHARTS.map((spec) => (
        <SeriesChart key={spec.title} spec={spec} samplesRef={samplesRef} />
      ))}
    </div>
  );
}
