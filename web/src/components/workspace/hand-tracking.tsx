'use client';

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { HandTeleop } from '@/lib/teleop/hands/hand-teleop';
import { HandTracker } from '@/lib/teleop/hands/tracker';
import { drawHands } from '@/lib/teleop/hands/draw';
import {
  handSettings,
  setHandSettings,
  serverHandSettings,
  subscribeHandSettings,
} from '@/lib/teleop/hands/settings';
import {
  bindTrackedHand,
  HAND_CAMERA_ID,
  handInterfaces,
  handSelected,
  type TrackedHand,
} from '@/lib/teleop/hands/bindings';
import { controlChannels, controlKey } from '@/lib/teleop/controls';
import { errorMessage } from '@/lib/teleop/types';
import { CollapsibleSection } from './collapsible-section';
import { useRuntime } from './context';

const useSettings = () =>
  useSyncExternalStore(subscribeHandSettings, handSettings, serverHandSettings);

/**
 * Runs the webcam, the tracker, and the hand teleoperation while an interface that a hand drives
 * uses the hand tracking presentation. The camera is off at all other times.
 */
export function HandTrackingDriver() {
  const runtime = useRuntime();
  const selectedKey = (runtime.config ? handSelected(runtime) : []).join('\0');
  const selected = useMemo(() => (selectedKey ? selectedKey.split('\0') : []), [selectedKey]);
  const bound = Object.values(runtime.layout?.tracked_hands ?? {});
  const wanted = selected.some((id) => bound.includes(id));
  const needsBinding = selected.length > 0 && bound.length === 0;

  // Bind the hands when none is bound, so that the presentation works without a visit to the settings.
  useEffect(() => {
    if (!needsBinding || !runtime.layout) return;
    const ids = selected;
    const hands: Partial<Record<TrackedHand, string>> = {};
    if (ids[0]) hands.right = ids[0];
    if (ids[1]) hands.left = ids[1];
    runtime.editLayout({ ...runtime.layout, tracked_hands: hands });
  }, [needsBinding, runtime, selected]);

  // Arm the bound interfaces once, as soon as the operator owns control. After that, only the
  // operator disarms them, so a Disarm press stays disarmed. A visitor to a short session then
  // does not need to find the Arm buttons.
  const tried = useRef(new Set<string>());
  const revision = runtime.snapshot();
  const boundKey = bound.join('\0');
  useEffect(() => {
    if (!wanted) {
      tried.current.clear();
      return;
    }
    const { controls } = runtime;
    if (!controls.ownsControl || !runtime.config) return;
    for (const id of boundKey.split('\0')) {
      const equipment = runtime.config.control_interfaces[id];
      if (!equipment) continue;
      for (const channel of controlChannels(equipment)) {
        const key = controlKey(id, channel);
        const current = controls.session(key);
        if (tried.current.has(key) || !current || current.armed || current.switching) continue;
        if (controls.reason(key)) continue;
        // The pose channel arms with the hand tracking presentation. The gripper arms beside it.
        if (current.presentation !== 'hand_tracking' && channel !== 'gripper') continue;
        tried.current.add(key);
        void controls.arm(key).then(runtime.notify);
      }
    }
  }, [runtime, wanted, revision, boundKey]);

  useEffect(() => {
    if (!wanted) return;
    const tracker = new HandTracker();
    const teleop = new HandTeleop(runtime, handSettings);
    const canvas = document.createElement('canvas');
    canvas.style.cssText =
      'width:100%;height:100%;object-fit:contain;display:block;background:#000000';
    let alive = true;
    let frame = 0;
    let lastSeq = -1;
    runtime.handError = '';
    const loop = (now: number) => {
      if (!alive) return;
      try {
        const sighting = tracker.poll(now);
        teleop.update(now, sighting);
        drawHands(canvas, tracker.video, sighting, teleop);
        // The video is one of the live cameras. Each webcam frame counts toward its frame rate.
        const at = runtime.clock.now();
        runtime.cameras.add(HAND_CAMERA_ID, 'Hand tracking', at);
        if (sighting && sighting.seq !== lastSeq) {
          lastSeq = sighting.seq;
          runtime.cameras.frame(HAND_CAMERA_ID, at);
        }
      } catch (error) {
        teleop.stopAll();
        runtime.handError = errorMessage(error);
        runtime.notify();
        return;
      }
      frame = requestAnimationFrame(loop);
    };
    tracker
      .start()
      .then(() => {
        if (!alive) return;
        runtime.handCanvas = canvas;
        runtime.notify();
        frame = requestAnimationFrame(loop);
      })
      .catch((error: unknown) => {
        if (!alive) return;
        runtime.handError = errorMessage(error);
        runtime.notify();
      });
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      teleop.stopAll();
      tracker.stop();
      if (runtime.handCanvas === canvas) runtime.handCanvas = undefined;
      runtime.cameras.remove(HAND_CAMERA_ID, true);
      runtime.handStatus = {};
      runtime.notify();
    };
  }, [runtime, wanted]);
  return null;
}

/** The hand bindings and settings. The video is a camera in the live camera deck. */
export function HandControls() {
  const runtime = useRuntime();
  const settings = useSettings();
  const interfaces = handInterfaces(runtime);
  return (
    <section className="control-card" data-hand-tracking>
      <CollapsibleSection heading="h3" title="Hand tracking">
        {!runtime.handCanvas && (
          <p className="muted">
            {runtime.handError ||
              'Choose the hand_tracking presentation on an arm to start the webcam. The video then shows with the live cameras.'}
          </p>
        )}
        {(['left', 'right'] as TrackedHand[]).map((hand) => (
          <label key={hand}>
            {hand} hand
            <select
              value={runtime.layout?.tracked_hands?.[hand] ?? ''}
              onChange={(event) => void bindTrackedHand(runtime, hand, event.target.value)}
            >
              <option value="">Unassigned</option>
              {interfaces.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            <span className="muted">{runtime.handStatus[hand] ?? ''}</span>
          </label>
        ))}
        <label>
          Motion frame
          <select
            value={settings.frame}
            onChange={(event) =>
              setHandSettings({ frame: event.target.value === 'base' ? 'base' : 'tool' })
            }
          >
            <option value="tool">Gripper point of view</option>
            <option value="base">Robot base</option>
          </select>
        </label>
        <label>
          Wrist turn
          <select
            value={settings.rotate}
            onChange={(event) =>
              setHandSettings({ rotate: event.target.value === 'off' ? 'off' : 'full' })
            }
          >
            <option value="full">Turns the gripper</option>
            <option value="off">Keeps orientation</option>
          </select>
        </label>
        <label>
          Scale
          <input
            type="number"
            min={0.1}
            max={3}
            step={0.1}
            value={settings.scale}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value) && value > 0)
                setHandSettings({ scale: Math.min(value, 3) });
            }}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.swapSides}
            onChange={(event) => setHandSettings({ swapSides: event.target.checked })}
          />
          Swap hands (for a webcam that mirrors)
        </label>
        <p className="muted">
          Arm the interface, then curl your middle, ring and pinky fingers into your palm to move.
          Thumb and index set the gripper. Open your hand to stop.
        </p>
      </CollapsibleSection>
    </section>
  );
}
