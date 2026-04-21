"use client";

import { cn } from "@/lib/utils";

export interface DebugRow {
  label: string;
  /**
   * When a finite number, formatted with `precision` decimal places; when null
   * or undefined, rendered as an em-dash; strings pass through unchanged.
   */
  value: number | string | null | undefined;
  unit?: string;
  /** Decimal places for numeric values. Defaults to 2. */
  precision?: number;
}

interface DebugPanelProps {
  rows: DebugRow[];
  className?: string;
}

function formatValue({ value, unit, precision = 2 }: DebugRow): string {
  let formatted: string;
  if (value === null || value === undefined) {
    formatted = "—";
  } else if (typeof value === "number") {
    formatted = Number.isFinite(value) ? value.toFixed(precision) : "—";
  } else {
    formatted = value;
  }
  return unit ? `${formatted} ${unit}` : formatted;
}

export function DebugPanel({ rows, className }: DebugPanelProps) {
  return (
    <div
      className={cn(
        "bg-background/30 text-foreground border-input w-full rounded-lg border font-mono text-xs backdrop-blur-lg",
        className,
      )}
    >
      <table className="w-full">
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.label}
              className="border-input/50 border-b last:border-b-0"
            >
              <th scope="row" className="px-3 py-1 text-left font-normal">
                {row.label}
              </th>
              <td className="px-3 py-1 text-right whitespace-nowrap">
                {formatValue(row)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
