"use client";

import { useRef, useState } from "react";
import { controlChannels, controlKey } from "@/lib/teleop/controls";
import { chooseControl } from "@/lib/teleop/control-select";
import type { WorkspaceRuntime } from "@/lib/teleop/runtime";
import { bindHand, vrInterfaces, type Hand } from "@/lib/teleop/xr-bindings";
import { own } from "@/lib/teleop/types";
import { useRuntime } from "../context";
import {
  THEME,
  VrCanvasPanel,
  badge,
  button,
  fillRound,
  fit,
  frame,
  scrollArea,
  text,
  wrap,
  type Painter,
  type Rect,
} from "./canvas-panel";
import { quickAddVisualization } from "./quick-add";

export type ControlsTab = "controls" | "topics";

const W = 1152;
const H = 900;
const PANEL_WIDTH = 1.5;
const SCROLL_STEP = 300;
const KIND_LETTER = { data: "D", video: "V", audio: "A" } as const;
const KIND_NAME = { data: "Data", video: "Video", audio: "Audio" } as const;

/** Every control interface with its channels, the same set that the desktop Controls panel lists. */
function channelsOf(runtime: WorkspaceRuntime) {
  const interfaces = runtime.config?.control_interfaces ?? {};
  const ids = [
    ...new Set([
      ...Object.keys(interfaces),
      ...Object.keys(runtime.layout?.control_preferences ?? {}),
      ...Object.keys(runtime.layout?.control_channel_preferences ?? {}),
    ]),
  ];
  return ids.map((equipmentId) => {
    const equipment = interfaces[equipmentId];
    const channels = new Set([
      ...(equipment ? controlChannels(equipment) : ["primary"]),
      ...Object.keys(runtime.layout?.control_channel_preferences?.[equipmentId] ?? {}),
    ]);
    if (runtime.layout?.control_preferences[equipmentId]) channels.add("primary");
    return { equipmentId, equipment, channels: [...channels] };
  });
}

const channelTitle = (profile: string | undefined, channel: string) =>
  channel === "primary" ? (profile === "base.ackermann_drive.v1" ? "Driving" : "Arm / motion") : channel === "gripper" ? "Gripper" : channel;

/** Draws the Controls tab at the origin of `p` and returns the height that it used. */
function drawControls(p: Painter, runtime: WorkspaceRuntime, width: number) {
  const manager = runtime.controls;
  const groups = channelsOf(runtime);
  let y = 0;
  if (!groups.length) {
    wrap(p, "This robot advertises no control interfaces. Viewing remains available.", width, 30, 3).forEach((line, i) =>
      text(p, line, 0, 40 + i * 42, { size: 30, color: THEME.fg3 }),
    );
    return 140;
  }
  for (const { equipmentId, equipment, channels } of groups) {
    text(p, fit(p, equipment?.label ?? equipmentId, width, 34, 600), 0, y + 30, { size: 34, weight: 600, color: THEME.fg0 });
    y += 66;
    for (const channel of channels) {
      const id = controlKey(equipmentId, channel);
      const session = manager.session(id);
      const operation = manager.operation(id);
      const top = y;
      const card = (h: number) => fillRound(p.ctx, { x: 0, y: top, w: width, h }, 14, THEME.bg1, session?.armed ? THEME.accentLine : THEME.line1, 3);
      if (!equipment || !session) {
        card(96);
        text(p, "Saved interface or operation unavailable.", 24, top + 48, { size: 28, color: THEME.fg3 });
        y += 96 + 20;
        continue;
      }
      const reason = manager.reason(id, false);
      const presentations = [...new Set([...(operation?.presentations ?? []), session.presentation])];
      const height = 24 + 58 + 44 + (reason ? 44 : 0) + (presentations.length > 1 ? 76 : 0) + 82 + (session.error ? 76 : 0) + 10;
      card(height);
      let row = top + 24;
      text(p, channelTitle(operation?.profile, channel), 24, row + 24, { size: 30, weight: 600, color: session.armed ? THEME.accent : THEME.fg0 });
      badge(p, session.armed ? "Armed" : "Disarmed", width - 24, row + 24, session.armed ? "ok" : "muted");
      row += 58;
      text(p, fit(p, `${session.operation} · ${session.presentation}`, width - 48, 22, 500, true), 24, row + 10, { size: 22, mono: true, color: THEME.fg3 });
      row += 44;
      if (reason) {
        text(p, fit(p, reason, width - 48, 25), 24, row + 6, { size: 25, color: THEME.moderate });
        row += 44;
      }
      if (presentations.length > 1) {
        const next = presentations[(presentations.indexOf(session.presentation) + 1) % presentations.length];
        button(p, { x: 24, y: row, w: width - 48, h: 64 }, `presentation-${id}`, `Presentation: ${session.presentation}  ›  ${next}`, {
          disabled: session.switching,
          size: 25,
          onClick: () => void chooseControl(runtime, equipmentId, channel, session.operation, next),
        });
        row += 76;
      }
      const half = (width - 48 - 14) / 2;
      const owns = manager.ownsControl;
      button(p, { x: 24, y: row, w: half, h: 70 }, `acquire-${id}`, manager.pending ? "Acquiring…" : owns ? "Release control" : "Acquire control", {
        kind: owns ? "default" : "primary",
        disabled: runtime.discovery !== "ready" || manager.pending,
        size: 26,
        onClick: () => {
          const action = owns ? manager.release() : manager.request();
          runtime.notify();
          void action.then(runtime.notify);
        },
      });
      button(p, { x: 24 + half + 14, y: row, w: half, h: 70 }, `arm-${id}`, session.switching ? "Switching…" : session.armed ? (channel === "gripper" ? "Disarm gripper" : "Disarm") : channel === "gripper" ? "Enable gripper" : "Arm", {
        kind: session.armed ? "danger" : "default",
        disabled: session.switching || (!session.armed && (!!reason || !owns)),
        size: 26,
        onClick: () => void (session.armed ? manager.stop(id) : manager.arm(id)).then(runtime.notify),
      });
      row += 82;
      if (session.error) {
        button(p, { x: 24, y: row, w: width - 48, h: 64 }, `ack-${id}`, "Acknowledge failure", {
          size: 25,
          onClick: () => {
            manager.acknowledge(id);
            runtime.notify();
          },
        });
      }
      y += height + 20;
    }
    y += 10;
  }

  const options = vrInterfaces(runtime);
  if (options.length) {
    text(p, "VR CONTROLLER BINDINGS", 0, y + 24, { size: 24, weight: 600, mono: true, color: THEME.accent });
    y += 56;
    const half = (width - 14) / 2;
    (["left", "right"] as Hand[]).forEach((hand, i) => {
      const bound = runtime.layout?.controller_hands?.[hand] ?? "";
      const choices = ["", ...options.map(([key]) => key)];
      const next = choices[(choices.indexOf(bound) + 1) % choices.length];
      const label = own(runtime.config?.control_interfaces, bound)?.label ?? "Unassigned";
      button(p, { x: i * (half + 14), y, w: half, h: 76 }, `bind-${hand}`, `${hand === "left" ? "Left" : "Right"}: ${label}`, {
        kind: bound ? "active" : "default",
        size: 26,
        onClick: () => void bindHand(runtime, hand, next),
      });
    });
    y += 96;
    wrap(p, "Arm an interface, then hold grip to move it. Release grip to stop. Select a hand to change its interface.", width, 25, 3).forEach((line, i) =>
      text(p, line, 0, y + 16 + i * 34, { size: 25, color: THEME.fg3 }),
    );
    y += 120;
  }
  return y;
}

/** Draws the Topics tab, one row for each published topic, and returns the height that it used. */
function drawTopics(p: Painter, runtime: WorkspaceRuntime, width: number, adding: string, add: (pubId: string) => void) {
  const rows = runtime.catalog();
  if (!rows.length) {
    text(p, "No topics are published yet.", 0, 40, { size: 30, color: THEME.fg3 });
    return 100;
  }
  rows.forEach((pub, i) => {
    const y = i * 100;
    p.ctx.fillStyle = THEME.line1;
    p.ctx.fillRect(0, y, width, 2);
    fillRound(p.ctx, { x: 0, y: y + 26, w: 48, h: 48 }, 8, THEME.bg2, THEME.line2, 2);
    text(p, KIND_LETTER[pub.kind], 24, y + 51, { size: 26, weight: 600, mono: true, color: THEME.accent, align: "center" });
    const state = pub.excluded
      ? "excluded"
      : !pub.available
        ? "unavailable"
        : pub.kind === "data" && pub.encoding !== "json"
          ? "unsupported"
          : "available";
    text(p, fit(p, pub.name, width - 330, 27, 500, true), 66, y + 36, { size: 27, mono: true, color: THEME.fg0 });
    text(p, `${KIND_NAME[pub.kind]} · ${state}`, 66, y + 72, { size: 23, color: state === "available" ? THEME.fg3 : THEME.moderate });
    const blocked = !pub.available || pub.excluded || (pub.kind === "data" && pub.encoding !== "json");
    button(p, { x: width - 240, y: y + 14, w: 240, h: 72 }, `add-${pub.id}`, adding === pub.id ? "Adding…" : "+  Add", {
      kind: "primary",
      disabled: blocked || !!adding,
      size: 27,
      onClick: () => add(pub.id),
    });
  });
  return rows.length * 100;
}

/** Controls and topics, as two tabs like the desktop dock. */
export function VrControlsPanel({
  tab,
  setTab,
  position,
  rotation,
}: {
  tab: ControlsTab;
  setTab(tab: ControlsTab): void;
  position: [number, number, number];
  rotation: [number, number, number];
}) {
  const runtime = useRuntime();
  const [scroll, setScroll] = useState({ controls: 0, topics: 0 });
  const [adding, setAdding] = useState("");
  const [message, setMessage] = useState("");
  const content = useRef(0);
  const AREA: Rect = { x: 44, y: tab === "topics" ? 232 : 184, w: W - 88 - 76, h: 0 };
  AREA.h = H - 40 - AREA.y;
  const offset = scroll[tab];
  const limit = () => Math.max(0, content.current - AREA.h);
  const move = (delta: number) =>
    setScroll((current) => ({ ...current, [tab]: Math.max(0, Math.min(limit(), current[tab] + delta)) }));

  const add = (pubId: string) => {
    const pub = runtime.catalog().find((entry) => entry.id === pubId);
    if (!pub) return;
    setAdding(pubId);
    setMessage("");
    quickAddVisualization(runtime, pub)
      .then((panel) => setMessage(`Added ${panel.label} as ${panel.visualization}.`))
      .catch((error: Error) => setMessage(error.message))
      .finally(() => setAdding(""));
  };

  const paint = (p: Painter) => {
    frame(p, "Workspace", runtime.config?.label);
    const half = (W - 88 - 14) / 2;
    button(p, { x: 44, y: 84, w: half, h: 72 }, "tab-controls", "Controls", { kind: tab === "controls" ? "active" : "default", onClick: () => setTab("controls"), size: 28 });
    button(p, { x: 44 + half + 14, y: 84, w: half, h: 72 }, "tab-topics", "Topics & panels", { kind: tab === "topics" ? "active" : "default", onClick: () => setTab("topics"), size: 28 });
    if (tab === "topics") {
      const line = message || "Add a visualization for a topic. It appears in the Visualizations panel.";
      text(p, fit(p, line, W - 88, 25), 44, 196, { size: 25, color: message ? THEME.accent : THEME.fg3 });
    }
    scrollArea(p, AREA, offset, (inner) => {
      content.current = tab === "controls" ? drawControls(inner, runtime, AREA.w) : drawTopics(inner, runtime, AREA.w, adding, add);
    });
    const more = content.current > AREA.h;
    const x = W - 44 - 56;
    button(p, { x, y: AREA.y, w: 56, h: 72 }, "scroll-up", "▲", { disabled: !more || offset <= 0, onClick: () => move(-SCROLL_STEP), size: 26 });
    button(p, { x, y: AREA.y + AREA.h - 72, w: 56, h: 72 }, "scroll-down", "▼", { disabled: !more || offset >= limit(), onClick: () => move(SCROLL_STEP), size: 26 });
  };

  return <VrCanvasPanel position={position} rotation={rotation} width={PANEL_WIDTH} canvasWidth={W} canvasHeight={H} paint={paint} />;
}
