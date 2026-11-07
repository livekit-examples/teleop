'use client';

import { useEffect, useRef, useState } from 'react';
import { startXR } from '@/lib/teleop/xr';
import { useRuntime } from './context';
import { useMediaHosts } from './media';

export function XrControls({ supported }: { supported: boolean }) {
  const runtime = useRuntime();
  const hosts = useMediaHosts();
  const end = useRef<(() => void) | undefined>(undefined);
  const [status, setStatus] = useState('');
  const [active, setActive] = useState(false);
  useEffect(() => () => end.current?.(), []);
  const bind = async (hand: 'left' | 'right', id: string) => {
    end.current?.();
    await runtime.controls.stopAll();
    if (!runtime.layout) return;
    const hands = { ...runtime.layout.controller_hands };
    if (id) hands[hand] = id;
    else delete hands[hand];
    if (id && hands[hand === 'left' ? 'right' : 'left'] === id)
      delete hands[hand === 'left' ? 'right' : 'left'];
    runtime.editLayout({ ...runtime.layout, controller_hands: hands });
  };
  const ready = Object.values(runtime.layout?.controller_hands ?? {}).some(
    (id) =>
      runtime.controls.session(id)?.armed && runtime.controls.session(id)?.presentation === 'vr',
  );
  return (
    <section className="control-card">
      <h3>VR controller bindings</h3>
      {(['left', 'right'] as const).map((hand) => (
        <label key={hand}>
          {hand} hand
          <select
            value={runtime.layout?.controller_hands?.[hand] ?? ''}
            onChange={(event) => void bind(hand, event.target.value)}
          >
            <option value="">Unassigned</option>
            {Object.entries(runtime.config?.control_interfaces ?? {}).map(([id, equipment]) => (
              <option key={id} value={id}>
                {equipment.label}
              </option>
            ))}
          </select>
        </label>
      ))}
      <button
        disabled={!supported || (!active && !ready)}
        onClick={() => {
          if (active) {
            end.current?.();
            setActive(false);
            return;
          }
          void startXR(
            runtime,
            () =>
              [runtime.cameras.main, ...runtime.cameras.tiles].flatMap((id) =>
                id && hosts.get(id) ? [hosts.get(id)!.video] : [],
              ),
            (message) => {
              setStatus(message);
              if (message.includes('ended')) setActive(false);
            },
          )
            .then((stop) => {
              end.current = stop;
              setActive(true);
            })
            .catch((error: Error) => setStatus(error.message));
        }}
      >
        {active ? 'Exit VR' : 'Enter VR'}
      </button>
      <p className="muted">
        {status ||
          (supported
            ? 'Bind and arm each Cartesian interface before entering VR.'
            : 'Immersive VR is unavailable in this browser.')}
      </p>
    </section>
  );
}
