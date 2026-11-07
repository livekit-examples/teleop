'use client';

import { useEffect, useRef, useState } from 'react';
import type { ControlInput } from '@/lib/teleop/controls';
import { selectJoints } from '@/lib/teleop/selectors';
import type { WorkspaceRuntime } from '@/lib/teleop/runtime';
import { own } from '@/lib/teleop/types';
import { useRuntime } from './context';
import { XrControls } from './xr-controls';

function InputPresentation({ id }: { id: string }) {
  const runtime = useRuntime();
  const manager = runtime.controls;
  const session = manager.session(id)!;
  const operation = manager.operation(id)!;
  const equipment = runtime.config!.control_interfaces[id];
  const activation = session.activation;
  const axes = useRef([0, 0, 0]);
  const held = useRef(new Set<string>());
  const fresh = useRef(false);
  const [waiting, setWaiting] = useState(true);
  const [joint, setJoint] = useState(equipment.joint_names?.[0] ?? '');
  const [positions, setPositions] = useState<Record<string, number>>(() => {
    if (operation.profile !== 'joints.trajectory.v1')
      return Object.fromEntries((equipment.joint_names ?? []).map((name) => [name, 0]));
    try {
      return Object.fromEntries(
        selectJoints(Object.values(manager.context(id).feedback)[0], equipment.joint_names).map(
          (j) => {
            const limits = manager.adapter(id)?.jointLimits?.(manager.context(id))[j.name];
            const measured = j.position ?? 0;
            return [j.name, limits ? Math.max(limits.min, Math.min(limits.max, measured)) : measured];
          },
        ),
      );
    } catch {
      return {};
    }
  });
  const positionRef = useRef(positions);
  useEffect(() => {
    positionRef.current = positions;
  }, [positions]);
  useEffect(() => {
    if (!session.armed || session.presentation === 'vr' || session.presentation === 'joint_sliders')
      return;
    const presentation = session.presentation;
    const keys = held.current;
    const editable = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName));
    const down = (event: KeyboardEvent) => {
      if (
        presentation !== 'keyboard' ||
        event.repeat ||
        editable(event.target) ||
        !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'q', 'e'].includes(event.key)
      )
        return;
      event.preventDefault();
      keys.add(event.key);
    };
    const up = (event: KeyboardEvent) => {
      keys.delete(event.key);
    };
    const release = () => {
      keys.clear();
      axes.current = [0, 0, 0];
      fresh.current = false;
      void manager.stop(id);
      runtime.notify();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', release);
    const interval = setInterval(() => {
      let values = axes.current;
      if (presentation === 'keyboard') {
        const pressed = (key: string) => (keys.has(key) ? 1 : 0);
        values = [
          pressed('ArrowUp') - pressed('ArrowDown'),
          pressed('ArrowLeft') - pressed('ArrowRight'),
          pressed('q') - pressed('e'),
        ];
      } else if (presentation === 'gamepad') {
        const pad = navigator.getGamepads().find((p) => p?.connected);
        if (!pad) {
          release();
          return;
        }
        const clean = (value: number) =>
          Math.abs(value) < 0.12 ? 0 : Math.max(-1, Math.min(1, value));
        values = [clean(-(pad.axes[1] ?? 0)), clean(-(pad.axes[0] ?? 0)), clean(pad.axes[2] ?? 0)];
      }
      // A displaced gamepad or joystick cannot become motion merely by arming.
      if (!fresh.current) {
        if (values.every((v) => v === 0)) {
          fresh.current = true;
          setWaiting(false);
        }
        return;
      }
      const input: ControlInput =
        operation.profile === 'joints.velocity_jog.v1'
          ? { joints: { [joint]: values[0] } }
          : { axes: values };
      manager.send(id, input, activation);
    }, 50);
    return () => {
      clearInterval(interval);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', release);
      keys.clear();
      axes.current = [0, 0, 0];
      fresh.current = false;
    };
  }, [
    runtime,
    manager,
    id,
    session.armed,
    session.presentation,
    operation.profile,
    joint,
    activation,
  ]);

  if (session.presentation === 'joint_sliders') {
    const velocity = operation.profile === 'joints.velocity_jog.v1';
    const neutral = () => {
      if (!velocity) return;
      const values = Object.fromEntries((equipment.joint_names ?? []).map((name) => [name, 0]));
      setPositions(values);
      manager.send(id, { joints: values }, activation);
    };
    return (
      <div className="joint-controls">
        {(equipment.joint_names ?? []).map((name) => (
          <label key={name}>
            {name} · {velocity ? 'Velocity (rad/s)' : 'Position (rad)'}
            <span>{(positions[name] ?? 0).toFixed(3)}</span>
            <input
              aria-label={`${name} ${velocity ? 'velocity' : 'position'}`}
              type="range"
              min={manager.adapter(id)?.jointLimits?.(manager.context(id))[name]?.min ?? (velocity ? -1 : -3.14)}
              max={manager.adapter(id)?.jointLimits?.(manager.context(id))[name]?.max ?? (velocity ? 1 : 3.14)}
              step="0.001"
              value={positions[name] ?? 0}
              disabled={!session.armed}
              onChange={(event) => {
                const values = { ...positionRef.current, [name]: Number(event.target.value) };
                setPositions(values);
                manager.send(id, { joints: values }, activation);
              }}
              onPointerUp={neutral}
              onPointerCancel={neutral}
              onBlur={neutral}
              onKeyUp={neutral}
            />
          </label>
        ))}
        <SliderHeartbeat id={id} values={positions} velocity={velocity} />
      </div>
    );
  }
  if (session.presentation === 'vr')
    return (
      <p className="muted">
        Bind a hand below. Grip engages a fresh pose reference; releasing grip holds the fixture end
        effector.
      </p>
    );
  return (
    <div className="input-presentation">
      {session.presentation === 'gamepad' && equipment.joint_names && (
        <label>
          Gamepad joint
          <select
            value={joint}
            onChange={(event) => {
              void manager.stop(id);
              setJoint(event.target.value);
            }}
          >
            {equipment.joint_names.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
      )}
      {session.presentation === 'joystick' && (
        <div
          className="workspace-joystick"
          role="group"
          aria-label={`${equipment.label} joystick`}
          onPointerDown={(event) => {
            if (!session.armed) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            const rect = event.currentTarget.getBoundingClientRect();
            axes.current = [
              Math.max(
                -1,
                Math.min(1, -(event.clientY - rect.top - rect.height / 2) / (rect.height / 2)),
              ),
              Math.max(
                -1,
                Math.min(1, -(event.clientX - rect.left - rect.width / 2) / (rect.width / 2)),
              ),
              0,
            ];
          }}
          onPointerMove={(event) => {
            if (!session.armed || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
            const rect = event.currentTarget.getBoundingClientRect();
            axes.current = [
              Math.max(
                -1,
                Math.min(1, -(event.clientY - rect.top - rect.height / 2) / (rect.height / 2)),
              ),
              Math.max(
                -1,
                Math.min(1, -(event.clientX - rect.left - rect.width / 2) / (rect.width / 2)),
              ),
              0,
            ];
          }}
          onPointerUp={() => {
            axes.current = [0, 0, 0];
            manager.send(id, { axes: [0, 0, 0] }, activation);
          }}
          onLostPointerCapture={() => {
            axes.current = [0, 0, 0];
          }}
          onPointerCancel={() => {
            axes.current = [0, 0, 0];
          }}
        >
          <span>
            ↑<br />← &nbsp; ● &nbsp; →<br />↓
          </span>
        </div>
      )}
      {session.presentation === 'joystick' && operation.profile === 'base.holonomic_twist.v1' && (
        <label>
          Strafe
          <input
            type="range"
            min="-1"
            max="1"
            step="0.01"
            defaultValue="0"
            disabled={!session.armed}
            onChange={(event) => {
              axes.current[2] = Number(event.target.value);
            }}
            onPointerUp={(event) => {
              event.currentTarget.value = '0';
              axes.current[2] = 0;
            }}
          />
        </label>
      )}
      <p className="muted">
        {session.presentation === 'keyboard'
          ? 'Arrow keys: forward / turn. Q / E: strafe for holonomic drive.'
          : session.presentation === 'gamepad'
            ? 'Use the connected gamepad sticks.'
            : 'Drag from the center. Release to stop.'}
      </p>
      {session.armed && waiting && (
        <p className="view-reason">Return inputs to neutral before motion.</p>
      )}
    </div>
  );
}

function SliderHeartbeat({
  id,
  values,
  velocity,
}: {
  id: string;
  values: Record<string, number>;
  velocity: boolean;
}) {
  const runtime = useRuntime();
  const latest = useRef(values);
  const armed = runtime.controls.session(id)?.armed;
  const repeatInterval = runtime.controls.adapter(id)?.repeatIntervalMs ?? (velocity ? 50 : 0);
  const activation = runtime.controls.session(id)?.activation;
  useEffect(() => {
    latest.current = values;
  }, [values]);
  useEffect(() => {
    if (!repeatInterval || !armed) return;
    const timer = setInterval(
      () => runtime.controls.send(id, { joints: latest.current }, activation),
      repeatInterval,
    );
    return () => clearInterval(timer);
  }, [runtime, id, repeatInterval, armed, activation]);
  return null;
}

function capabilityReason(
  _runtime: WorkspaceRuntime,
  presentation: string,
  gamepad: boolean,
  xr: boolean,
) {
  if (presentation === 'gamepad' && !gamepad) return 'Gamepad disconnected';
  if (presentation === 'vr' && !xr) return 'Immersive VR unavailable';
  if (!['joystick', 'keyboard', 'gamepad', 'joint_sliders', 'vr'].includes(presentation))
    return 'Presentation is not implemented';
  return '';
}

export function ControlPanel({ active }: { active: boolean }) {
  const runtime = useRuntime();
  const [selected, setSelected] = useState('');
  const [gamepad, setGamepad] = useState(false);
  const [xr, setXr] = useState(false);
  useEffect(() => {
    runtime.controls.setVisible(active);
    return () => runtime.controls.setVisible(false);
  }, [runtime, active]);
  useEffect(() => {
    let alive = true;
    void navigator.xr
      ?.isSessionSupported('immersive-vr')
      .then((supported) => {
        if (alive) setXr(supported);
      })
      .catch(() => {});
    const check = () => setGamepad(navigator.getGamepads().some((pad) => pad?.connected));
    check();
    window.addEventListener('gamepadconnected', check);
    window.addEventListener('gamepaddisconnected', check);
    const hidden = () => {
      if (document.hidden && !runtime.xrActive) void runtime.controls.stopAll();
    };
    const blur = () => {
      if (!runtime.xrActive) void runtime.controls.stopAll();
    };
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      alive = false;
      window.removeEventListener('gamepadconnected', check);
      window.removeEventListener('gamepaddisconnected', check);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('blur', blur);
    };
  }, [runtime]);
  const interfaces = runtime.config?.control_interfaces ?? {};
  const ids = [
    ...new Set([
      ...Object.keys(interfaces),
      ...Object.keys(runtime.layout?.control_preferences ?? {}),
    ]),
  ];
  const choose = async (id: string, operation: string, presentation: string) => {
    await runtime.controls.select(id, operation, presentation);
    const current = runtime.controls.session(id);
    if (runtime.layout && current)
      runtime.editLayout({
        ...runtime.layout,
        control_preferences: {
          ...runtime.layout.control_preferences,
          [id]: { operation: current.operation, presentation: current.presentation },
        },
      });
    runtime.notify();
  };
  return (
    <div className="control-panel">
      <label>
        Control interface
        <select
          aria-label="Control interface"
          value={selected}
          onChange={(event) => {
            setSelected(event.target.value);
            document
              .getElementById(`control-${event.target.value}`)
              ?.scrollIntoView({ block: 'nearest' });
          }}
        >
          <option value="">All interfaces</option>
          {ids.map((id) => (
            <option key={id} value={id}>
              {interfaces[id]?.label ?? id}
            </option>
          ))}
        </select>
      </label>
      {!ids.length && (
        <p className="muted">
          This robot advertises no control interfaces. Viewing remains available.
        </p>
      )}
      {ids.map((id) => {
        const equipment = own(interfaces, id);
        const session = runtime.controls.session(id);
        const op = runtime.controls.operation(id);
        const adapter = runtime.controls.adapter(id);
        if (!equipment || !session)
          return (
            <section className="control-card" key={id}>
              <h3>{equipment?.label ?? id}</h3>
              <p>Saved interface or operation unavailable.</p>
            </section>
          );
        const reason = runtime.controls.reason(id, false);
        const capability = capabilityReason(runtime, session.presentation, gamepad, xr);
        const operationIds = [
          ...new Set([...Object.keys(equipment.operations), session.operation]),
        ];
        const presentations = [...new Set([...(op?.presentations ?? []), session.presentation])];
        return (
          <section
            className={`control-card ${session.armed ? 'armed' : ''}`}
            id={`control-${id}`}
            key={id}
          >
            <div className="control-card-heading">
              <h3>{equipment.label}</h3>
              <span className={`status status-${session.armed ? 'healthy' : 'not_requested'}`}>
                {session.armed ? 'Armed' : 'Disarmed'}
              </span>
            </div>
            <label>
              Operation
              <select
                aria-label={`${equipment.label} operation`}
                disabled={session.switching}
                value={session.operation}
                onChange={(event) => {
                  const next = equipment.operations[event.target.value];
                  void choose(
                    id,
                    event.target.value,
                    next?.presentations.includes(session.presentation)
                      ? session.presentation
                      : (next?.presentations[0] ?? session.presentation),
                  );
                }}
              >
                {operationIds.map((opId) => (
                  <option key={opId} value={opId}>
                    {opId}
                    {!equipment.operations[opId] ? ' (unavailable)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Presentation
              <select
                aria-label={`${equipment.label} presentation`}
                disabled={session.switching}
                value={session.presentation}
                onChange={(event) => void choose(id, session.operation, event.target.value)}
              >
                {presentations.map((presentation) => (
                  <option key={presentation} value={presentation}>
                    {presentation}
                    {capabilityReason(runtime, presentation, gamepad, xr)
                      ? ` (${capabilityReason(runtime, presentation, gamepad, xr)})`
                      : ''}
                  </option>
                ))}
              </select>
            </label>
            <p className="profile-name">
              {op?.profile ?? 'Operation absent'}
              <br />
              {adapter?.units ?? ''}
            </p>
            {(reason || capability) && <p className="view-reason">{reason ?? capability}</p>}
            <div className="control-actions">
              <button
                className={session.armed ? 'danger' : 'primary'}
                disabled={
                  !active ||
                  session.switching ||
                  (!session.armed && (!!reason || !!capability || !runtime.controls.ownsControl))
                }
                onClick={() => {
                  void (session.armed ? runtime.controls.stop(id) : runtime.controls.arm(id)).then(
                    runtime.notify,
                  );
                }}
              >
                {session.switching ? 'Switching…' : session.armed ? 'Disarm' : 'Arm input'}
              </button>
              {session.error && (
                <button
                  onClick={() => {
                    runtime.controls.acknowledge(id);
                    runtime.notify();
                  }}
                >
                  Acknowledge failure
                </button>
              )}
            </div>
            {adapter && op && (
              <InputPresentation
                id={id}
                key={`${id}:${session.operation}:${session.presentation}:${session.activation}`}
              />
            )}
          </section>
        );
      })}
      <XrControls supported={xr} />
      {!runtime.transport.fixture && (
        <p className="muted">
          Live adapters require verified robot-specific limits, units, cancellation and watchdog
          behavior. Advertised modes remain visible until those adapters are installed.
        </p>
      )}
    </div>
  );
}
