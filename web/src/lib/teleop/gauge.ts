/** Default range for gauges saved without an explicit min/max. */
export const GAUGE_DEFAULT_MIN = 0;
export const GAUGE_DEFAULT_MAX = 100;
/** The gauge arc opens at the bottom: it starts at 135° and sweeps 270° clockwise (screen angles). */
export const GAUGE_START_DEG = 135;
export const GAUGE_SWEEP_DEG = 270;

/** Where `value` sits on the arc, clamped to 0–1. A non-finite value or empty range gives 0. */
export function gaugeFraction(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min)
    return 0;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

/** Whether `value` falls outside the gauge range, and on which side. */
export function gaugeOverflow(value: number, min: number, max: number): 'under' | 'over' | undefined {
  if (value < min) return 'under';
  if (value > max) return 'over';
}

/** Suggested colors when "Color by value" is first switched on (LiveKit serious and success). */
export const GAUGE_DEFAULT_MIN_COLOR = '#ff7566';
export const GAUGE_DEFAULT_MAX_COLOR = '#23de6b';
export const HEX_COLOR = /^#[0-9a-f]{6}$/i;

type Lch = [l: number, c: number, h: number];

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** #rrggbb → OKLCH (Björn Ottosson's OKLab, in polar form; hue in radians). */
function hexToOklch(hex: string): Lch {
  const [r, g, b] = [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), Math.atan2(B, A)];
}

/** OKLCH → linear sRGB; components may fall outside 0–1 when the color is out of gamut. */
function oklchToLinear([L, C, h]: Lch): [number, number, number] {
  const A = C * Math.cos(h);
  const B = C * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (rgb: number[]) => rgb.every((c) => c >= -1e-4 && c <= 1 + 1e-4);

/** OKLCH → #rrggbb. Out-of-gamut colors lose chroma (not hue) until they fit, as CSS does. */
function oklchToHex([L, C, h]: Lch): string {
  let rgb = oklchToLinear([L, C, h]);
  if (!inGamut(rgb)) {
    let low = 0;
    let high = C;
    for (let i = 0; i < 16; i++) {
      const mid = (low + high) / 2;
      if (inGamut(oklchToLinear([L, mid, h]))) low = mid;
      else high = mid;
    }
    rgb = oklchToLinear([L, low, h]);
  }
  return `#${rgb
    .map((c) =>
      Math.round(Math.min(1, Math.max(0, toGamma(Math.min(1, Math.max(0, c))))) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/**
 * The color at `fraction` (0–1) between two #rrggbb colors, blended in OKLCH along the shorter
 * hue arc. A gray end takes the other end's hue, so gray → cyan does not swing through other hues.
 */
export function gaugeColor(fraction: number, minColor: string, maxColor: string): string {
  const t = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
  if (t === 0) return minColor.toLowerCase();
  if (t === 1) return maxColor.toLowerCase();
  const [l0, c0, h0raw] = hexToOklch(minColor);
  const [l1, c1, h1raw] = hexToOklch(maxColor);
  const gray = 0.02;
  const h0 = c0 < gray ? h1raw : h0raw;
  const h1 = c1 < gray ? h0 : h1raw;
  let dh = h1 - h0;
  if (dh > Math.PI) dh -= 2 * Math.PI;
  if (dh < -Math.PI) dh += 2 * Math.PI;
  return oklchToHex([l0 + (l1 - l0) * t, c0 + (c1 - c0) * t, h0 + dh * t]);
}

/** The panel's color range, when "Color by value" is on. */
export function gaugeColors(settings: { min_color?: string; max_color?: string }) {
  return settings.min_color && settings.max_color
    ? { min: settings.min_color, max: settings.max_color }
    : undefined;
}
