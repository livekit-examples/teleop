import { useEffect, useState } from 'react';

export function useGamepadConnected() {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const sync = () => {
      setConnected(navigator.getGamepads().some((g) => g !== null));
    };

    sync();
    window.addEventListener('gamepadconnected', sync);
    window.addEventListener('gamepaddisconnected', sync);
    return () => {
      window.removeEventListener('gamepadconnected', sync);
      window.removeEventListener('gamepaddisconnected', sync);
    };
  }, []);

  return connected;
}
