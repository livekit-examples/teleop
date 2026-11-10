import { defaultHandSettings, type HandSettings } from './hand-teleop';

const KEY = 'teleop.hand-tracking.settings';
let current: HandSettings = load();
const listeners = new Set<() => void>();

function load(): HandSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<HandSettings>;
    return {
      frame: saved.frame === 'base' ? 'base' : 'tool',
      rotate: saved.rotate === 'off' ? 'off' : 'full',
      scale: Number.isFinite(saved.scale) && saved.scale! > 0 ? Math.min(saved.scale!, 3) : 1,
      swapSides: saved.swapSides === true,
      hfovDeg:
        Number.isFinite(saved.hfovDeg) && saved.hfovDeg! > 20 && saved.hfovDeg! < 140
          ? saved.hfovDeg!
          : defaultHandSettings.hfovDeg,
    };
  } catch {
    return { ...defaultHandSettings };
  }
}

export const handSettings = () => current;
export const serverHandSettings = () => defaultHandSettings;
export function setHandSettings(change: Partial<HandSettings>) {
  current = { ...current, ...change };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Storage can be blocked. The settings then last until the page closes.
  }
  listeners.forEach((listener) => listener());
}
export const subscribeHandSettings = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
