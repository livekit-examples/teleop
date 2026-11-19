"use client";

import { useEffect, useState } from "react";
import { Keyboard } from "lucide-react";
import { KeyboardTeleop } from "@/lib/teleop/keyboard-teleop";
import {
  ARM_KEY,
  DISARM_KEY,
  FOCUS_KEY,
  keyGlyph,
  type Binding,
  type Part,
  type PartRole,
} from "@/lib/teleop/keymap";
import { useRuntime } from "./context";

const ROLE_LABEL: Record<PartRole, string> = {
  drive: "Base",
  manipulator: "Arm",
  linear: "Linear",
  aim: "Aim",
  joints: "Joints",
};

type Legend = { codes: string[]; label: string };
type SlotLegend = { slots: (keyof Binding["keys"])[]; label: string };

/** Short label for a head, torso or lift joint on the number row. */
function pairLabel(part: Part, joint: string, index: number, count: number) {
  if (part.role === "aim" && count === 2) return index === 0 ? "Pan" : "Tilt";
  if (part.role === "linear" && count === 1) return "Down / up";
  return joint;
}

function legend(part: Part, binding: Binding, joint?: string): Legend[] {
  if (binding.kind === "pairs")
    return (binding.pairs ?? []).map((pair, index, all) => ({
      codes: [pair.minus, pair.plus],
      label: pairLabel(part, pair.joint, index, all.length),
    }));
  return slotLegend(part, binding, joint)
    .filter((row) => row.slots.every((slot) => binding.keys[slot]))
    .map((row) => ({ codes: row.slots.map((slot) => binding.keys[slot]!), label: row.label }));
}

function slotLegend(part: Part, binding: Binding, joint?: string): SlotLegend[] {
  switch (binding.kind) {
    case "drive":
      return [
        { slots: ["forward", "back"], label: "Drive" },
        {
          slots: ["left", "right"],
          label: binding.profile === "base.ackermann_drive.v1" ? "Steer" : "Turn",
        },
        { slots: ["strafe_left", "strafe_right"], label: "Strafe" },
      ];
    case "cartesian":
      return [
        { slots: ["forward", "back"], label: "Reach" },
        { slots: ["left", "right"], label: "Side" },
        { slots: ["up", "down"], label: "Up / down" },
      ];
    case "pairs":
      return [];
    case "gripper":
      return [{ slots: ["open", "close"], label: "Open / close" }];
    case "jog":
      return part.role === "linear"
        ? [{ slots: ["plus", "minus"], label: "Raise / lower" }]
        : [
            { slots: ["plus", "minus"], label: joint ? `Jog ${joint}` : "Jog" },
            { slots: ["prev", "next"], label: "Joint" },
          ];
  }
}

function editable(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

/**
 * Robot-level controls: one Arm button, one speed, and the keymap for every part. This replaces
 * arming each interface on its own; the per-interface cards remain under Advanced.
 */
export function RobotKeyboard({ active }: { active: boolean }) {
  const runtime = useRuntime();
  const [engine] = useState(
    () => new KeyboardTeleop(runtime.controls, () => runtime.notify()),
  );
  const keymap = engine.refresh();
  const controls = runtime.controls;

  useEffect(() => {
    if (!active) return;
    const down = (event: KeyboardEvent) => {
      // Escape disarms from anywhere, a focused field or switch included.
      if (event.code === DISARM_KEY) {
        if (engine.keydown(event)) event.preventDefault();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || editable(event.target)) return;
      // Buttons keep focus after a click; Space and Enter on them must not double as motion.
      if (engine.keydown(event)) event.preventDefault();
    };
    const up = (event: KeyboardEvent) => engine.keyup(event);
    const blur = () => engine.releaseAll();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    const timer = setInterval(() => engine.tick(), 50);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      clearInterval(timer);
      engine.releaseAll();
    };
  }, [engine, active]);

  const engaged = engine.engaged;
  const status = engine.busy
    ? { text: "Arming…", tone: "starting" }
    : engaged
      ? { text: "Armed", tone: "healthy" }
      : { text: "Disarmed", tone: "not_requested" };
  const owner = controls.ownsControl
    ? "You have control"
    : controls.owner
      ? `Controlled by ${controls.owner}`
      : "No one has control";
  const mapped = keymap.parts.filter((p) => p.bindings.length);
  const focused = keymap.focus[engine.focused];

  return (
    <section className={`robot-keyboard ${engaged ? "armed" : ""}`} aria-label="Robot controls">
      <header className="robot-keyboard-bar">
        <div className="robot-keyboard-title">
          <Keyboard size={14} aria-hidden="true" />
          <h3>Robot controls</h3>
          <span className={`status status-${status.tone}`}>{status.text}</span>
        </div>
        <p className="robot-keyboard-owner">{owner}</p>
        <div className="control-actions">
          <button
            className={engaged ? "danger" : "control-arm"}
            disabled={
              !active ||
              runtime.discovery !== "ready" ||
              engine.busy ||
              controls.pending ||
              (!engaged && !mapped.length)
            }
            onClick={() => void (engaged ? engine.disarmAll() : engine.armAll())}
          >
            {engaged ? "Disarm all" : controls.ownsControl ? "Arm robot" : "Take control & arm"}
            <kbd className="key-hint" aria-hidden="true">
              {engaged ? keyGlyph(DISARM_KEY) : `⇧${keyGlyph(ARM_KEY)}`}
            </kbd>
          </button>
          {controls.ownsControl && (
            <button
              className="control-release"
              disabled={engine.busy || controls.pending}
              onClick={() => {
                const action = controls.release();
                runtime.notify();
                void action.then(() => runtime.notify());
              }}
            >
              Release control
            </button>
          )}
        </div>
        <label className="robot-keyboard-speed">
          <span>Speed</span>
          <input
            type="range"
            aria-label="Speed"
            min={10}
            max={100}
            step={5}
            value={Math.round(engine.speed * 100)}
            onChange={(event) => engine.setSpeed(Number(event.target.value) / 100)}
            onKeyDown={(event) => event.currentTarget.blur()}
          />
          <output>{Math.round(engine.speed * 100)}%</output>
        </label>
        {engine.problems.map((problem) => (
          <p className="view-reason" key={problem}>
            {problem}
          </p>
        ))}
      </header>

      {keymap.focus.length > 0 && (
        <div className="robot-keyboard-focus" role="group" aria-label="Focused part">
          {keymap.focus.map((id, index) => (
            <button
              key={id}
              aria-pressed={id === focused}
              onClick={() => engine.focus(index)}
            >
              {keymap.parts.find((p) => p.id === id)?.label ?? id}
            </button>
          ))}
        </div>
      )}

      <ul className="robot-keyboard-parts">
        {keymap.parts.map((part) => {
          const included = !engine.excluded.has(part.id);
          const armed = engine.partArmed(part);
          const inFocus = !part.bindings.some((b) => b.focus) || part.id === focused;
          const partStatus = !part.bindings.length
            ? { text: "No keys", tone: "excluded" }
            : !included
              ? { text: "Off", tone: "not_requested" }
              : armed
                ? { text: inFocus ? "Armed" : "Armed · idle", tone: "healthy" }
                : engaged
                  ? { text: "Not armed", tone: "warning" }
                  : { text: "Ready", tone: "not_requested" };
          return (
            <li
              key={part.id}
              className="robot-keyboard-part"
              data-armed={armed && inFocus}
              data-included={included}
            >
              <div className="robot-keyboard-part-head">
                <label className="lk-switch" title={included ? "Exclude" : "Include"}>
                  <input
                    type="checkbox"
                    aria-label={`Include ${part.label}`}
                    checked={included}
                    disabled={!part.bindings.length || engine.busy}
                    onChange={(event) => void engine.setIncluded(part.id, event.target.checked)}
                  />
                  <span aria-hidden="true" />
                </label>
                <span className="robot-keyboard-part-name">{part.label}</span>
                <span className="robot-keyboard-role">
                  {ROLE_LABEL[part.role]}
                  {part.side ? ` · ${part.side === "left" ? "L" : "R"}` : ""}
                </span>
                <span className={`status status-${partStatus.tone}`}>{partStatus.text}</span>
              </div>
              {part.unmapped ? (
                <p className="muted">{part.unmapped}</p>
              ) : (
                <div className="robot-keyboard-legend">
                  {part.bindings.flatMap((binding) =>
                    legend(part, binding, engine.selectedJointOf(binding)).map((row) => (
                        <div className="robot-keyboard-row" key={`${binding.key}:${row.label}`}>
                          <span className="robot-keyboard-keys">
                            {row.codes.map((code) => {
                              return (
                                <kbd
                                  key={code}
                                  className="key-cap"
                                  data-pressed={
                                    engine.held.has(code) &&
                                    engine.isArmed(binding) &&
                                    inFocus
                                  }
                                >
                                  {keyGlyph(code)}
                                </kbd>
                              );
                            })}
                          </span>
                          <span className="robot-keyboard-action">{row.label}</span>
                        </div>
                      )),
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="robot-keyboard-hint">
        <kbd>⇧{keyGlyph(ARM_KEY)}</kbd> arms everything, <kbd>{keyGlyph(DISARM_KEY)}</kbd> disarms
        everything. Motion keys are ignored while a text field has focus.
        {keymap.focus.length > 0 && (
          <>
            {" "}
            <kbd>{keyGlyph(FOCUS_KEY)}</kbd> cycles which arm the left cluster drives.
          </>
        )}
      </p>
    </section>
  );
}
