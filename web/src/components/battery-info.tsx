'use client';

import { cn } from '@/lib/utils';
import {
  POWER_SUPPLY_HEALTH,
  POWER_SUPPLY_STATUS,
  POWER_SUPPLY_TECHNOLOGY,
  type BatteryStatePayload,
} from '@/lib/servo-state';

/**
 * Unmeasured BatteryState fields arrive as NaN — as null, a bare token, or a string,
 * depending on how the bridge serializes it — so accept only finite numbers.
 */
function formatNumber(v: unknown, decimals: number, unit: string): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  return `${v.toFixed(decimals)}${unit}`;
}

function enumLabel(values: string[], v: unknown): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  return values[v] ?? `unknown (${v})`;
}

interface BatteryInfoProps {
  battery: BatteryStatePayload | undefined;
  className?: string;
}

/**
 * Battery telemetry readout for the ROS2 `sensor_msgs/msg/BatteryState` track.
 * Voltage is the headline value (the only field the rover currently measures);
 * the remaining fields render below with "—" where unmeasured.
 */
export function BatteryInfo({ battery, className }: BatteryInfoProps) {
  if (!battery) {
    return (
      <div className={cn('py-6 text-center opacity-50', className)}>waiting for battery data…</div>
    );
  }

  const percentage =
    typeof battery.percentage === 'number' && Number.isFinite(battery.percentage)
      ? battery.percentage * 100
      : undefined;

  return (
    <div className={cn('grid gap-3', className)}>
      {/* Hero value */}
      <div className="grid gap-0.5">
        <div className="opacity-50">Battery voltage</div>
        <div className="font-display text-3xl font-medium">
          {formatNumber(battery.voltage, 2, ' V')}
        </div>
      </div>

      {/* Secondary fields */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-0.5">
        <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
          <div className="opacity-50">Charge</div>
          <div className="text-right">{formatNumber(percentage, 0, '%')}</div>
          <div className="opacity-50">Current</div>
          <div className="text-right">{formatNumber(battery.current, 2, ' A')}</div>
          <div className="opacity-50">Temp</div>
          <div className="text-right">{formatNumber(battery.temperature, 1, ' °C')}</div>
          <div className="opacity-50">Present</div>
          <div className="text-right">
            {battery.present === undefined ? '—' : battery.present ? 'yes' : 'no'}
          </div>
        </div>
        <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
          <div className="opacity-50">Status</div>
          <div className="text-right">
            {enumLabel(POWER_SUPPLY_STATUS, battery.power_supply_status)}
          </div>
          <div className="opacity-50">Health</div>
          <div className="text-right">
            {enumLabel(POWER_SUPPLY_HEALTH, battery.power_supply_health)}
          </div>
          <div className="opacity-50">Tech</div>
          <div className="text-right">
            {enumLabel(POWER_SUPPLY_TECHNOLOGY, battery.power_supply_technology)}
          </div>
        </div>
      </div>
    </div>
  );
}
