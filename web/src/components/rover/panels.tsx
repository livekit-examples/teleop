'use client';

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { BatteryState, ImuSample } from './telemetry';

/** The rover HUD's read-outs: the heading ribbon, the IMU plot, the battery
 *  panel, and the pan/tilt dial. */

/* ------------------------------------------------------------- heading */

const HEADING_SPAN_DEG = 90;
const HEADING_STEP_DEG = 10;

/**
 * Heading as an audio-waveform ribbon: the centre bar is the current heading and
 * the absolute 10° grid scrolls behind it, tapering out at ±90°. The value is
 * unwrapped first so crossing ±180° scrolls the short way round.
 */
export function HeadingRibbon({
  value = 0,
  className = '',
}: {
  value?: number;
  className?: string;
}) {
  const previous = useRef(value);
  const [unwrapped, setUnwrapped] = useState(value);

  useEffect(() => {
    let delta = value - previous.current;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    previous.current = value;
    setUnwrapped((current) => current + delta);
  }, [value]);

  const bars = useMemo(() => {
    const first = Math.floor((unwrapped - HEADING_SPAN_DEG) / HEADING_STEP_DEG) - 1;
    const last = Math.ceil((unwrapped + HEADING_SPAN_DEG) / HEADING_STEP_DEG) + 1;
    return Array.from({ length: last - first + 1 }, (_, i) => {
      const tick = (first + i) * HEADING_STEP_DEG;
      const offset = tick - unwrapped;
      const strength = Math.cos(Math.min(1, Math.abs(offset) / HEADING_SPAN_DEG) * (Math.PI / 2));
      return {
        tick,
        left: 50 + (offset / (HEADING_SPAN_DEG * 2)) * 100,
        height: 4 + strength * 28,
        opacity: 0.08 + strength ** 1.25 * 0.92,
      };
    });
  }, [unwrapped]);

  return (
    <div
      role="img"
      aria-label={`Current heading ${value.toFixed(1)} degrees`}
      className={'relative px-2 py-1 select-none ' + className}
    >
      <div className="relative h-12 w-full overflow-hidden" aria-hidden>
        {bars.map((bar) => (
          <span
            key={bar.tick}
            className="bg-foreground absolute top-1/2 block w-px -translate-x-1/2 -translate-y-1/2 rounded-full transition-[left,height,opacity] duration-200 ease-out"
            style={{ left: `${bar.left}%`, height: bar.height, opacity: bar.opacity }}
          />
        ))}
        <span className="bg-foreground absolute top-1/2 left-1/2 z-10 block h-8 w-px -translate-x-1/2 -translate-y-1/2 rounded-full shadow-[0_0_10px_var(--foreground)]" />
      </div>
      <div className="bg-background/60 text-foreground absolute bottom-0 left-1/2 grid h-8 w-20 -translate-x-1/2 translate-y-full place-content-center font-mono">
        <span className="whitespace-pre">{`${value >= 0 ? ' ' : ''}${value.toFixed(1)}°`}</span>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- pan/tilt */

const clamp90 = (deg: number) => Math.max(-90, Math.min(90, deg));

function PanHemisphere({ deg }: { deg: number }) {
  const panRad = Math.PI * (1 - (clamp90(deg) + 90) / 180);
  return (
    <>
      <path
        d="M 8 25 A 14 14 0 0 1 36 25 L 8 25 Z"
        fill="currentColor"
        fillOpacity="0.06"
        stroke="currentColor"
        strokeOpacity="0.55"
      />
      <circle
        cx={22 + Math.cos(panRad) * 12}
        cy={25 - Math.sin(panRad) * 12}
        r="2.75"
        fill="var(--foreground)"
        stroke="white"
      />
      <text x="22" y="36" textAnchor="middle" fill="currentColor" fontSize="6">
        PAN
      </text>
    </>
  );
}

function TiltHemisphere({ deg, x }: { deg: number; x: number }) {
  const tiltRad = Math.PI / 2 - ((clamp90(deg) + 90) / 180) * Math.PI;
  const cx = x + 18;
  return (
    <>
      <path
        d={`M ${cx} 34 A 14 14 0 0 0 ${cx} 6 L ${cx} 34 Z`}
        fill="currentColor"
        fillOpacity="0.06"
        stroke="currentColor"
        strokeOpacity="0.55"
      />
      <circle
        cx={cx + Math.cos(tiltRad) * 12}
        cy={20 + Math.sin(tiltRad) * 12}
        r="2.75"
        fill="var(--chart-2)"
        stroke="white"
      />
      <text x={cx} y="39" textAnchor="middle" fill="currentColor" fontSize="6">
        TILT
      </text>
    </>
  );
}

/** Half-dials showing where the camera head is pointing. One-axis heads
 *  render only the joint `/joint_states` actually named. */
export function PanTiltDial({ pan, tilt }: { pan: number | null; tilt: number | null }) {
  const parts = [
    pan !== null ? `Pan ${pan.toFixed(2)}°` : null,
    tilt !== null ? `Tilt ${tilt.toFixed(2)}°` : null,
  ].filter((s): s is string => s !== null);
  const both = pan !== null && tilt !== null;

  return (
    <div
      className={
        'border-input bg-surface text-foreground h-10 rounded-lg border px-1 ' +
        (both ? 'w-20' : 'w-10')
      }
      title={parts.join(', ')}
      role="img"
      aria-label={parts.join(', ')}
    >
      <svg viewBox={both ? '0 0 80 40' : '0 0 40 40'} className="size-full" aria-hidden>
        {pan !== null && <PanHemisphere deg={pan} />}
        {tilt !== null && <TiltHemisphere deg={tilt} x={both ? 40 : 0} />}
      </svg>
    </div>
  );
}

/* -------------------------------------------------------------- IMU plot */

/** Trailing window shown on the x-axis. */
const WINDOW_MS = 10_000;
const X_TICK_MS = 2_000;

type Chart = {
  title: string;
  unit: string;
  decimals: number;
  series: { label: string; color: string; get: (s: ImuSample) => number }[];
};

// Angular velocity and linear acceleration are different scales, so each gets
// its own value axis.
const CHARTS: Chart[] = [
  {
    title: 'Angular velocity',
    unit: '°/s',
    decimals: 1,
    series: [
      { label: 'ωz', color: '#1fd5f9', get: (s) => s.angVelZ },
      { label: 'ωy', color: '#dc85ff', get: (s) => s.angVelY },
    ],
  },
  {
    title: 'Linear accel',
    unit: 'm/s²',
    decimals: 2,
    series: [
      { label: 'ax', color: '#1fd5f9', get: (s) => s.linAccX },
      { label: 'ay', color: '#dc85ff', get: (s) => s.linAccY },
    ],
  },
];

/** Smallest 1/2/5×10ⁿ step giving at most `target` gridlines over `range`. */
function niceStep(range: number, target: number): number {
  const raw = range / target;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5].find((m) => raw <= m * magnitude) ?? 10 * magnitude;
}

/**
 * Live IMU telemetry over a trailing 10-second window. Reads the sample buffer
 * on animation frames rather than re-rendering per message.
 */
export function ImuPlot({ samples }: { samples: RefObject<ImuSample[]> }) {
  return (
    <div className="grid gap-4">
      {CHARTS.map((chart) => (
        <ImuChart key={chart.title} chart={chart} samples={samples} />
      ))}
    </div>
  );
}

function ImuChart({ chart, samples }: { chart: Chart; samples: RefObject<ImuSample[]> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const valueRefs = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let raf = requestAnimationFrame(function draw() {
      raf = requestAnimationFrame(draw);
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.font = `10px ${getComputedStyle(canvas).fontFamily}`;

      const all = samples.current;
      if (all.length === 0) {
        ctx.fillStyle = '#666666';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('waiting for imu data…', rect.width / 2, rect.height / 2);
        for (const el of valueRefs.current) if (el) el.textContent = '—';
        return;
      }

      // Leave room for the x-axis labels below and the endpoint dot at the right.
      const plot = { x: 0, y: 4, w: rect.width - 8, h: rect.height - 22 };
      const tNow = all[all.length - 1].t;
      const t0 = tNow - WINDOW_MS;
      const from = all.findIndex((s) => s.t >= t0);
      // Keep one sample before the window so lines enter from the left edge.
      const visible = all.slice(Math.max(0, (from === -1 ? all.length - 1 : from) - 1));

      let min = Infinity;
      let max = -Infinity;
      for (const s of visible) {
        for (const serie of chart.series) {
          min = Math.min(min, serie.get(s));
          max = Math.max(max, serie.get(s));
        }
      }
      const pad = Math.max((max - min) * 0.1, 10 ** -chart.decimals * 5);
      min -= pad;
      max += pad;

      const xOf = (t: number) => plot.x + ((t - t0) / WINDOW_MS) * plot.w;
      const yOf = (v: number) => plot.y + plot.h - ((v - min) / (max - min)) * plot.h;

      // Gridlines at clean values, hairline and recessive.
      const step = niceStep(max - min, 4);
      const tickDecimals = Math.max(0, -Math.floor(Math.log10(step)));
      ctx.strokeStyle = '#202020';
      ctx.fillStyle = '#666666';
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

      ctx.textBaseline = 'top';
      for (let k = 0; k * X_TICK_MS <= WINDOW_MS; k++) {
        ctx.textAlign = k === 0 ? 'right' : 'center';
        ctx.fillText(
          k === 0 ? '0s' : `-${(k * X_TICK_MS) / 1000}s`,
          xOf(tNow - k * X_TICK_MS),
          plot.y + plot.h + 6,
        );
      }

      ctx.save();
      ctx.beginPath();
      ctx.rect(plot.x, plot.y, plot.w, plot.h);
      ctx.clip();
      const latest = all[all.length - 1];
      chart.series.forEach((serie, i) => {
        ctx.strokeStyle = serie.color;
        ctx.fillStyle = serie.color;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        visible.forEach((s, j) => {
          const [x, y] = [xOf(s.t), yOf(serie.get(s))];
          if (j === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(xOf(latest.t), yOf(serie.get(latest)), 3, 0, Math.PI * 2);
        ctx.fill();

        const el = valueRefs.current[i];
        if (el) el.textContent = serie.get(latest).toFixed(chart.decimals);
      });
      ctx.restore();
    });

    return () => cancelAnimationFrame(raf);
  }, [chart, samples]);

  return (
    <div className="grid gap-1">
      <div className="flex items-baseline justify-between">
        <div className="opacity-50">
          {chart.title} ({chart.unit})
        </div>
        <div className="flex gap-3">
          {chart.series.map((serie, i) => (
            <span key={serie.label} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="size-2 rounded-[2px]"
                style={{ background: serie.color }}
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

/* --------------------------------------------------------------- battery */

const POWER_SUPPLY_STATUS = ['unknown', 'charging', 'discharging', 'not charging', 'full'];
const POWER_SUPPLY_HEALTH = [
  'unknown',
  'good',
  'overheat',
  'dead',
  'overvoltage',
  'unspec failure',
  'cold',
  'watchdog expired',
  'safety timer expired',
];
const POWER_SUPPLY_TECHNOLOGY = ['unknown', 'NiMH', 'Li-ion', 'LiPo', 'LiFe', 'NiCd', 'LiMn'];

/** ROS sends unmeasured fields as NaN (which arrives as null), so only finite
 *  numbers count as a reading. */
function num(v: unknown, decimals: number, unit: string): string {
  return typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(decimals)}${unit}` : '—';
}

function enumLabel(values: string[], v: unknown): string {
  return typeof v === 'number' && Number.isFinite(v) ? (values[v] ?? `unknown (${v})`) : '—';
}

/** `sensor_msgs/msg/BatteryState` read-out. Voltage is the headline (often the
 *  only field the rover actually measures). */
export function BatteryInfo({ battery }: { battery: BatteryState | undefined }) {
  if (!battery) return <div className="py-6 text-center opacity-50">waiting for battery data…</div>;

  const percentage =
    typeof battery.percentage === 'number' && Number.isFinite(battery.percentage)
      ? battery.percentage * 100
      : undefined;

  const rows: [string, string][] = [
    ['Charge', num(percentage, 0, '%')],
    ['Current', num(battery.current, 2, ' A')],
    ['Temp', num(battery.temperature, 1, ' °C')],
    ['Present', battery.present === undefined ? '—' : battery.present ? 'yes' : 'no'],
    ['Status', enumLabel(POWER_SUPPLY_STATUS, battery.power_supply_status)],
    ['Health', enumLabel(POWER_SUPPLY_HEALTH, battery.power_supply_health)],
    ['Tech', enumLabel(POWER_SUPPLY_TECHNOLOGY, battery.power_supply_technology)],
  ];

  return (
    <div className="grid gap-3">
      <div className="grid gap-0.5">
        <div className="opacity-50">Battery voltage</div>
        <div className="font-display text-3xl font-medium">{num(battery.voltage, 2, ' V')}</div>
      </div>
      <div className="grid grid-cols-[auto_1fr_auto_1fr] gap-x-4 gap-y-0.5">
        {rows.map(([label, value]) => (
          <span key={label} className="contents">
            <span className="opacity-50">{label}</span>
            <span className="text-right">{value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
