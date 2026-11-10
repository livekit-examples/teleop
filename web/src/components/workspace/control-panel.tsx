"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
  controlKey,
  controlChannels,
  type ControlInput,
} from "@/lib/teleop/controls";
import { selectJoints } from "@/lib/teleop/selectors";
import type { WorkspaceRuntime } from "@/lib/teleop/runtime";
import { own } from "@/lib/teleop/types";
import { CollapsibleSection } from "./collapsible-section";
import { useRuntime } from "./context";
import { XrControls } from "./xr-controls";
import { ImmersiveVrButton, useImmersiveVr } from "./immersive-vr";
import { chooseControl } from "@/lib/teleop/control-select";
import { RacingTelemetry } from "./racing-telemetry";
import { KeyboardSteering } from "@/lib/teleop/keyboard-steering";

function InputPresentation({ id }: { id: string }) {
  const runtime = useRuntime();
  const manager = runtime.controls;
  const session = manager.session(id)!;
  const operation = manager.operation(id)!;
  const equipment = manager.context(id).equipment;
  const activation = session.activation;
  const driving = operation.profile === "base.ackermann_drive.v1";
  const inputInterval = manager.adapter(id)?.repeatIntervalMs ?? 50;
  const axes = useRef([0, 0, 0]);
  const held = useRef(new Set<string>());
  const fresh = useRef(false);
  // Axes use the whole pad. The knob follows the pointer but stays inside the rim.
  const steer = (event: PointerEvent<HTMLElement>) => {
    const pad = event.currentTarget;
    const rect = pad.getBoundingClientRect();
    const x = Math.max(
      -1,
      Math.min(
        1,
        (event.clientX - rect.left - rect.width / 2) / (rect.width / 2),
      ),
    );
    const y = Math.max(
      -1,
      Math.min(
        1,
        (event.clientY - rect.top - rect.height / 2) / (rect.height / 2),
      ),
    );
    axes.current = [-y, -x, 0];
    const reach = Math.hypot(x, y) || 1;
    const scale = Math.min(1, 1 / reach);
    pad.style.setProperty("--knob-x", `${x * scale}`);
    pad.style.setProperty("--knob-y", `${y * scale}`);
  };
  const release = (pad: HTMLElement) => {
    axes.current = [0, 0, 0];
    delete pad.dataset.active;
    pad.style.setProperty("--knob-x", "0");
    pad.style.setProperty("--knob-y", "0");
  };
  const [waiting, setWaiting] = useState(true);
  // Keys held now, for the on-screen key display.
  const [pressed, setPressed] = useState<string[]>([]);
  const [joint, setJoint] = useState(equipment.joint_names?.[0] ?? "");
  const [positions, setPositions] = useState<Record<string, number>>(() => {
    if (operation.profile !== "joints.trajectory.v1")
      return Object.fromEntries(
        (equipment.joint_names ?? []).map((name) => [name, 0]),
      );
    try {
      return Object.fromEntries(
        selectJoints(
          Object.values(manager.context(id).feedback)[0],
          equipment.joint_names,
        ).map((j) => {
          const limits = manager
            .adapter(id)
            ?.jointLimits?.(manager.context(id))[j.name];
          const measured = j.position ?? 0;
          return [
            j.name,
            limits
              ? Math.max(limits.min, Math.min(limits.max, measured))
              : measured,
          ];
        }),
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
    if (
      !session.armed ||
      ["vr", "joint_sliders", "gripper_controls"].includes(session.presentation)
    )
      return;
    const presentation = session.presentation;
    const keys = held.current;
    const keyboardSteering = new KeyboardSteering();
    let lastSample = performance.now();
    // Arrow keys do nothing on a button, and the Disarm button keeps focus after arming.
    const editable = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
    const down = (event: KeyboardEvent) => {
      if (
        presentation !== "keyboard" ||
        event.repeat ||
        editable(event.target) ||
        !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "q", "e"].includes(
          event.key,
        )
      )
        return;
      event.preventDefault();
      keys.add(event.key);
      setPressed([...keys]);
    };
    const up = (event: KeyboardEvent) => {
      keys.delete(event.key);
      setPressed([...keys]);
    };
    const release = () => {
      keys.clear();
      setPressed([]);
      axes.current = [0, 0, 0];
      fresh.current = false;
      keyboardSteering.reset();
      void manager.stop(id);
      runtime.notify();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", release);
    const interval = setInterval(() => {
      const sampledAt = performance.now();
      const elapsedMs = sampledAt - lastSample;
      lastSample = sampledAt;
      let values = axes.current;
      if (presentation === "keyboard") {
        const pressed = (key: string) => (keys.has(key) ? 1 : 0);
        values = [
          pressed("ArrowUp") - pressed("ArrowDown"),
          pressed("ArrowLeft") - pressed("ArrowRight"),
          pressed("q") - pressed("e"),
        ];
      } else if (presentation === "gamepad") {
        const pad = navigator.getGamepads().find((p) => p?.connected);
        if (!pad) {
          release();
          return;
        }
        const clean = (value: number) =>
          Math.abs(value) < 0.12 ? 0 : Math.max(-1, Math.min(1, value));
        // Base driving uses the triggers for forward and back, like a car. Other operations,
        // and pads without the standard layout, keep the left stick.
        const triggers =
          operation.profile.startsWith("base.") && pad.mapping === "standard";
        const trigger = (index: number) => {
          const value = pad.buttons[index]?.value ?? 0;
          return value < 0.05 ? 0 : Math.min(1, value);
        };
        values = [
          triggers ? trigger(7) - trigger(6) : clean(-(pad.axes[1] ?? 0)),
          clean(-(pad.axes[0] ?? 0)),
          driving ? 0 : clean(pad.axes[2] ?? 0),
        ];
      }
      if (driving) values = [values[0], values[1], 0];
      // A displaced gamepad or joystick cannot become motion merely by arming.
      if (!fresh.current) {
        keyboardSteering.reset();
        if (values.every((v) => v === 0)) {
          fresh.current = true;
          setWaiting(false);
        }
        return;
      }
      if (driving && presentation === "keyboard")
        values = [values[0], keyboardSteering.sample(values[1], elapsedMs), 0];
      const input: ControlInput =
        operation.profile === "joints.velocity_jog.v1"
          ? { joints: { [joint]: values[0] } }
          : { axes: values };
      manager.send(id, input, activation);
    }, inputInterval);
    return () => {
      clearInterval(interval);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", release);
      keys.clear();
      setPressed([]);
      axes.current = [0, 0, 0];
      fresh.current = false;
      keyboardSteering.reset();
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
    driving,
    inputInterval,
  ]);

  if (session.presentation === "gripper_controls")
    return <GripperControls id={id} />;
  if (session.presentation === "joint_sliders") {
    const velocity = operation.profile === "joints.velocity_jog.v1";
    const neutral = () => {
      if (!velocity) return;
      const values = Object.fromEntries(
        (equipment.joint_names ?? []).map((name) => [name, 0]),
      );
      setPositions(values);
      manager.send(id, { joints: values }, activation);
    };
    return (
      <div className="joint-controls">
        {(equipment.joint_names ?? []).map((name) => (
          <label key={name}>
            {name} · {velocity ? "Velocity (rad/s)" : "Position (rad)"}
            <span>{(positions[name] ?? 0).toFixed(3)}</span>
            <input
              aria-label={`${name} ${velocity ? "velocity" : "position"}`}
              type="range"
              min={
                manager.adapter(id)?.jointLimits?.(manager.context(id))[name]
                  ?.min ?? (velocity ? -1 : -3.14)
              }
              max={
                manager.adapter(id)?.jointLimits?.(manager.context(id))[name]
                  ?.max ?? (velocity ? 1 : 3.14)
              }
              step="0.001"
              value={positions[name] ?? 0}
              disabled={!session.armed}
              onChange={(event) => {
                const values = {
                  ...positionRef.current,
                  [name]: Number(event.target.value),
                };
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
  if (session.presentation === "vr")
    return (
      <p className="muted">
        Bind a hand below. Grip engages a fresh pose reference; releasing grip
        holds the fixture end effector.
      </p>
    );
  return (
    <div className="input-presentation">
      {session.presentation === "gamepad" && equipment.joint_names && (
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
      {session.presentation === "joystick" && (
        <div
          className="workspace-joystick"
          role="group"
          aria-label={`${equipment.label} joystick`}
          onPointerDown={(event) => {
            if (!session.armed) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            event.currentTarget.dataset.active = "true";
            steer(event);
          }}
          onPointerMove={(event) => {
            if (
              !session.armed ||
              !event.currentTarget.hasPointerCapture(event.pointerId)
            )
              return;
            steer(event);
          }}
          onPointerUp={(event) => {
            release(event.currentTarget);
            manager.send(id, { axes: [0, 0, 0] }, activation);
          }}
          onLostPointerCapture={(event) => release(event.currentTarget)}
          onPointerCancel={(event) => release(event.currentTarget)}
        >
          <span className="workspace-joystick-hint" aria-hidden="true">
            ↑<br />← &nbsp; &nbsp; →<br />↓
          </span>
          <span className="workspace-joystick-knob" aria-hidden="true" />
        </div>
      )}
      {session.presentation === "joystick" &&
        operation.profile === "base.holonomic_twist.v1" && (
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
                event.currentTarget.value = "0";
                axes.current[2] = 0;
              }}
            />
          </label>
        )}
      {session.presentation === "keyboard" && (
        <div
          className="key-pad"
          role="group"
          aria-label="Keyboard controls"
          data-armed={session.armed}
        >
          {(
            [
              ["ArrowUp", "↑", "key-up", "Up arrow"],
              ["ArrowLeft", "←", "key-left", "Left arrow"],
              ["ArrowDown", "↓", "key-down", "Down arrow"],
              ["ArrowRight", "→", "key-right", "Right arrow"],
              ...(driving
                ? []
                : [
                    ["q", "Q", "key-q", "Q key"],
                    ["e", "E", "key-e", "E key"],
                  ]),
            ] as const
          ).map(([key, glyph, area, name]) => (
            <kbd
              key={key}
              className={`key-cap ${area}`}
              data-pressed={pressed.includes(key)}
              aria-label={name}
            >
              {glyph}
            </kbd>
          ))}
        </div>
      )}
      <p className="muted">
        {session.presentation === "keyboard"
          ? driving
            ? "Up/down: target speed; release to brake. Left/right: hold to steer progressively, release to center."
            : "Arrow keys: forward / turn. Q / E: strafe for holonomic drive."
          : session.presentation === "gamepad"
            ? operation.profile.startsWith("base.")
              ? "Right trigger: forward. Left trigger: back. Left stick: turn."
              : "Use the connected gamepad sticks."
            : "Drag from the center. Release to stop."}
      </p>
      {session.armed && waiting && (
        <p className="view-reason">Return inputs to neutral before motion.</p>
      )}
    </div>
  );
}

function GripperControls({ id }: { id: string }) {
  const runtime = useRuntime();
  const manager = runtime.controls;
  const session = manager.session(id)!;
  const [target, setTarget] = useState<number>();
  let measured: number | undefined;
  let bounds: { min: number; max: number } | undefined;
  let targets: { open: number; closed: number; label: string } | undefined;
  const ctx = manager.context(id);
  const name = ctx.equipment.joint_names![0];
  try {
    measured = selectJoints(Object.values(ctx.feedback)[0], [name])[0].position;
    bounds = manager.adapter(id)?.jointLimits?.(ctx)[name];
    targets = manager.adapter(id)?.gripperTargets?.(ctx);
  } catch {
    /* The channel status explains missing or incompatible feedback. */
  }
  const move = (value: number) => {
    if (manager.send(id, { joints: { [name]: value } }, session.activation))
      setTarget(value);
    runtime.notify();
  };
  const enabled =
    session.armed &&
    !manager.reason(id) &&
    bounds &&
    targets &&
    measured !== undefined;
  return (
    <div className="gripper-controls">
      <label>
        {targets?.label ?? "Gripper position"} (m)
        <input
          aria-label={`${name} position`}
          type="range"
          step="0.0001"
          min={bounds?.min ?? 0}
          max={bounds?.max ?? 0}
          value={
            target ??
            (measured !== undefined && bounds
              ? Math.max(bounds.min, Math.min(bounds.max, measured))
              : 0)
          }
          disabled={!enabled}
          onChange={(event) => move(Number(event.target.value))}
        />
      </label>
      <p>
        Measured: {measured?.toFixed(4) ?? "Unavailable"} m · Target:{" "}
        {target?.toFixed(4) ?? "None"} m
      </p>
      <div className="control-actions">
        <button disabled={!enabled} onClick={() => move(targets!.open)}>
          Open
        </button>
        <button disabled={!enabled} onClick={() => move(targets!.closed)}>
          Close
        </button>
      </div>
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
  // Position refresh belongs to the manager and starts only after explicit input.
  const repeatInterval = velocity
    ? (runtime.controls.adapter(id)?.repeatIntervalMs ?? 50)
    : 0;
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
  if (presentation === "gamepad" && !gamepad) return "Gamepad disconnected";
  if (presentation === "vr" && !xr) return "Immersive VR unavailable";
  if (
    ![
      "joystick",
      "keyboard",
      "gamepad",
      "joint_sliders",
      "gripper_controls",
      "vr",
    ].includes(presentation)
  )
    return "Presentation is not implemented";
  return "";
}

export function ControlPanel({ active }: { active: boolean }) {
  const runtime = useRuntime();
  const [selected, setSelected] = useState("");
  const [gamepad, setGamepad] = useState(false);
  const xr = useImmersiveVr().supported;
  useEffect(() => {
    runtime.controls.setVisible(active);
    return () => runtime.controls.setVisible(false);
  }, [runtime, active]);
  useEffect(() => {
    const check = () =>
      setGamepad(navigator.getGamepads().some((pad) => pad?.connected));
    check();
    window.addEventListener("gamepadconnected", check);
    window.addEventListener("gamepaddisconnected", check);
    const hidden = () => {
      if (document.hidden && !runtime.xrActive) void runtime.controls.stopAll();
    };
    const blur = () => {
      if (!runtime.xrActive) void runtime.controls.stopAll();
    };
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("gamepadconnected", check);
      window.removeEventListener("gamepaddisconnected", check);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("blur", blur);
    };
  }, [runtime]);
  const interfaces = runtime.config?.control_interfaces ?? {};
  const ids = [
    ...new Set([
      ...Object.keys(interfaces),
      ...Object.keys(runtime.layout?.control_preferences ?? {}),
      ...Object.keys(runtime.layout?.control_channel_preferences ?? {}),
    ]),
  ];
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
              ?.scrollIntoView({ block: "nearest" });
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
        <>
          <p className="muted">
            This robot advertises no control interfaces. Viewing remains
            available.
          </p>
          <div className="control-actions">
            <ImmersiveVrButton />
          </div>
        </>
      )}
      {ids.map((equipmentId, index) => {
        const equipment = interfaces[equipmentId];
        const channels = new Set([
          ...(equipment ? controlChannels(equipment) : ["primary"]),
          ...Object.keys(
            runtime.layout?.control_channel_preferences?.[equipmentId] ?? {},
          ),
        ]);
        if (runtime.layout?.control_preferences[equipmentId])
          channels.add("primary");
        return (
          <section
            className="control-card"
            id={`control-${equipmentId}`}
            key={equipmentId}
          >
            <CollapsibleSection
              heading="h3"
              title={equipment?.label ?? equipmentId}
            >
              <RacingTelemetry equipmentId={equipmentId} active={active} />
              {[...channels].map((channel, position) => (
                <ControlChannel
                  key={channel}
                  equipmentId={equipmentId}
                  channel={channel}
                  immersive={index === 0 && position === 0}
                  active={active}
                  gamepad={gamepad}
                  xr={xr}
                />
              ))}
            </CollapsibleSection>
          </section>
        );
      })}
      {Object.values(interfaces).some((equipment) =>
        Object.values(equipment.operations).some((op) =>
          op.presentations.includes("vr"),
        ),
      ) && <XrControls supported={xr} />}
      {!runtime.transport.fixture && (
        <p className="muted">
          Live adapters require verified robot-specific limits, units,
          cancellation and watchdog behavior. Advertised modes remain visible
          until those adapters are installed.
        </p>
      )}
    </div>
  );
}

function ControlChannel({
  equipmentId,
  channel,
  active,
  gamepad,
  xr,
  immersive,
}: {
  equipmentId: string;
  channel: string;
  active: boolean;
  gamepad: boolean;
  xr: boolean;
  /** Show the Immersive VR button beside Arm. One channel of the panel shows it. */
  immersive: boolean;
}) {
  const runtime = useRuntime();
  const id = controlKey(equipmentId, channel);
  const choose = (id: string, operation: string, presentation: string) =>
    chooseControl(runtime, equipmentId, channel, operation, presentation);
  const equipment = own(runtime.config?.control_interfaces, equipmentId);
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
  const capability = capabilityReason(
    runtime,
    session.presentation,
    gamepad,
    xr,
  );
  const operationIds = [
    ...new Set([
      ...Object.keys(equipment.operations).filter(
        (key) =>
          (equipment.operations[key].control_channel ?? "primary") === channel,
      ),
      session.operation,
    ]),
  ];
  const presentations = [
    ...new Set([...(op?.presentations ?? []), session.presentation]),
  ];
  return (
    <section
      className={`control-channel ${session.armed ? "armed" : ""}`}
      data-control-channel={channel}
      key={id}
    >
      <CollapsibleSection
        heading="h4"
        title={
          channel === "primary"
            ? op?.profile === "base.ackermann_drive.v1"
              ? "Driving"
              : "Arm / motion"
            : channel === "gripper"
              ? "Gripper"
              : channel
        }
        badge={
          <span
            className={`status status-${session.armed ? "healthy" : "not_requested"}`}
          >
            {session.armed ? "Armed" : "Disarmed"}
          </span>
        }
      >
        <label>
          Operation
          <select
            aria-label={`${equipment.label}${channel === "primary" ? "" : ` ${channel}`} operation`}
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
                {!equipment.operations[opId] ? " (unavailable)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Presentation
          <select
            aria-label={`${equipment.label}${channel === "primary" ? "" : ` ${channel}`} presentation`}
            disabled={session.switching}
            value={session.presentation}
            onChange={(event) =>
              void choose(id, session.operation, event.target.value)
            }
          >
            {presentations.map((presentation) => (
              <option key={presentation} value={presentation}>
                {presentation}
                {capabilityReason(runtime, presentation, gamepad, xr)
                  ? ` (${capabilityReason(runtime, presentation, gamepad, xr)})`
                  : ""}
              </option>
            ))}
          </select>
        </label>
        <p className="profile-name">
          {op?.profile ?? "Operation absent"}
          <br />
          {adapter?.units ?? ""}
        </p>
        {(reason || capability) && (
          <p className="view-reason">{reason ?? capability}</p>
        )}
        <div className="control-actions">
          <button
            className={
              runtime.controls.ownsControl
                ? "control-release"
                : "control-acquire"
            }
            disabled={
              !active ||
              runtime.discovery !== "ready" ||
              runtime.controls.pending
            }
            onClick={() => {
              const action = runtime.controls.ownsControl
                ? runtime.controls.release()
                : runtime.controls.request();
              runtime.notify();
              void action.then(runtime.notify);
            }}
          >
            {runtime.controls.pending
              ? "Acquiring…"
              : runtime.controls.ownsControl
                ? "Release control"
                : "Acquire control"}
          </button>
          <button
            className={session.armed ? "danger" : "control-arm"}
            disabled={
              !active ||
              session.switching ||
              (!session.armed &&
                (!!reason || !!capability || !runtime.controls.ownsControl))
            }
            onClick={() => {
              void (
                session.armed
                  ? runtime.controls.stop(id)
                  : runtime.controls.arm(id)
              ).then(runtime.notify);
            }}
          >
            {session.switching
              ? "Switching…"
              : session.armed
                ? channel === "gripper"
                  ? "Disarm gripper"
                  : "Disarm"
                : channel === "gripper"
                  ? "Enable gripper"
                  : "Arm"}
          </button>
          {immersive && <ImmersiveVrButton />}
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
      </CollapsibleSection>
    </section>
  );
}
