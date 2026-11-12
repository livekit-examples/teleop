import { describe, expect, it } from 'vitest';
import { validatePanel } from '../src/lib/teleop/layout';
import { panelSeries, seriesSelector } from '../src/lib/teleop/selectors';

const plot = {
  visualization: 'plot',
  label: 'Dynamics',
  visible: true,
  source: { kind: 'data', track_name: '/speed_mph', field_path: ['value'] },
  settings: { window_seconds: 30 },
};
const series = [
  { label: 'Speed', track_name: '/speed_mph', field_path: ['value'], expected_rate_hz: 20 },
  { label: 'Accel', track_name: '/longitudinal_acceleration_g', field_path: ['g'] },
  { label: 'Yaw', track_name: '/yaw_rate_deg', field_path: ['deg'], expected_rate_hz: 10 },
];

describe('numeric plot series', () => {
  it('accepts several series from different tracks', () => {
    const panel = validatePanel({ ...plot, series });
    expect(panelSeries(panel).map((s) => s.track_name)).toEqual(series.map((s) => s.track_name));
  });
  it('draws the source of a plot saved without series', () => {
    const panel = validatePanel({ ...plot, settings: { expected_rate_hz: 5 } });
    expect(panelSeries(panel)).toEqual([
      { label: 'Dynamics', track_name: '/speed_mph', field_path: ['value'], expected_rate_hz: 5 },
    ]);
  });
  it('rejects series on other visualizations, bad paths, and a mismatched first track', () => {
    expect(() => validatePanel({ ...plot, visualization: 'value', series })).toThrow(
      'Only numeric plots',
    );
    expect(() => validatePanel({ ...plot, series: [] })).toThrow('1 to');
    expect(() => validatePanel({ ...plot, series: [{ ...series[0], field_path: 'value' }] })).toThrow(
      'Field path',
    );
    expect(() => validatePanel({ ...plot, series: [series[1]] })).toThrow('first series');
    expect(() => validatePanel({ ...plot, series: [{ ...series[0], script: 'x' }] })).toThrow(
      'Unsupported',
    );
  });
  it('selects each series from its own field path', () => {
    const panel = validatePanel({ ...plot, series });
    expect(seriesSelector(panel, 1)({ g: 0.4 })).toBe(0.4);
    expect(() => seriesSelector(panel, 2)({ deg: 'x' })).toThrow('finite number');
  });
});
