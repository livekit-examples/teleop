import { rateDefaults } from "@/lib/teleop/streams";

export type RateDraft = { rate: string; warn: string; error: string };

export const emptyRates: RateDraft = { rate: "", warn: "", error: "" };

export function ratesFrom(
  item:
    | {
        expected_rate_hz?: number;
        warn_rate_hz?: number;
        error_rate_hz?: number;
      }
    | undefined,
): RateDraft {
  return {
    rate:
      item?.expected_rate_hz === undefined ? "" : String(item.expected_rate_hz),
    warn: item?.warn_rate_hz === undefined ? "" : String(item.warn_rate_hz),
    error: item?.error_rate_hz === undefined ? "" : String(item.error_rate_hz),
  };
}

/** Rate fields for a validated panel or series. Blank warn and error follow the expected rate. */
export function ratesToFields(draft: RateDraft) {
  const out: {
    expected_rate_hz?: number;
    warn_rate_hz?: number;
    error_rate_hz?: number;
  } = {};
  if (draft.rate) out.expected_rate_hz = Number(draft.rate);
  if (draft.rate && draft.warn) out.warn_rate_hz = Number(draft.warn);
  if (draft.rate && draft.error) out.error_rate_hz = Number(draft.error);
  return out;
}

/**
 * Expected, warn and error rates in Hz. Warn and error show a default taken from the expected
 * rate until the user types their own value. Clearing a box returns it to the default.
 */
export function RateFields({
  value,
  onChange,
}: {
  value: RateDraft;
  onChange(next: RateDraft): void;
}) {
  const expected = Number(value.rate);
  const defaults = expected > 0 ? rateDefaults(expected) : undefined;
  return (
    <div className="rate-fields">
      <span className="rate-fields-title">Sample rate, Hz (optional)</span>
      <label className="rate-healthy">
        Healthy
        <input
          type="number"
          min="0.001"
          step="any"
          value={value.rate}
          onChange={(event) => onChange({ ...value, rate: event.target.value })}
          placeholder="Unmonitored"
        />
      </label>
      <label className="rate-warn">
        Warn
        <input
          type="number"
          min="0.001"
          step="any"
          disabled={!defaults}
          value={value.warn || (defaults ? String(defaults.warn) : "")}
          onChange={(event) => onChange({ ...value, warn: event.target.value })}
        />
      </label>
      <label className="rate-stale">
        Stale
        <input
          type="number"
          min="0.001"
          step="any"
          disabled={!defaults}
          value={value.error || (defaults ? String(defaults.error) : "")}
          onChange={(event) =>
            onChange({ ...value, error: event.target.value })
          }
        />
      </label>
    </div>
  );
}
