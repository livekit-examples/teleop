"use client";

import { useState } from "react";
import {
  GAUGE_DEFAULT_MAX,
  GAUGE_DEFAULT_MIN,
  GAUGE_START_DEG,
  GAUGE_SWEEP_DEG,
  gaugeColor,
  gaugeColors,
  gaugeFraction,
  gaugeOverflow,
} from "@/lib/teleop/gauge";
import { prunePlacement } from "@/lib/teleop/placement";
import { panelSeries, type NamedJoint } from "@/lib/teleop/selectors";
import type { WorkspaceRuntime } from "@/lib/teleop/runtime";
import { own, type Panel } from "@/lib/teleop/types";
import { useDataView, useRuntime, useSeriesViews } from "../context";
import { SERIES_COLORS } from "../visualizations";
import {
  THEME,
  VrCanvasPanel,
  button,
  dot,
  fillRound,
  fit,
  frame,
  text,
  wrap,
  type Painter,
  type Rect,
} from "./canvas-panel";
import { VrVideo } from "./vr-cameras";

const W = 1152;
const H = 860;
const PANEL_WIDTH = 1.5;
const BODY: Rect = { x: 44, y: 214, w: W - 88, h: 524 };
const TAB_W = 244;
const TABS_PER_PAGE = 3;

const idle: Panel = {
  visualization: "raw",
  label: "",
  visible: false,
  source: { kind: "data", track_name: "", field_path: [] },
  settings: {},
};

function hide(runtime: WorkspaceRuntime, id: string, remove: boolean) {
  const layout = runtime.layout;
  const panel = layout?.panels[id];
  if (!layout || !panel) return;
  const panels = { ...layout.panels };
  if (remove) delete panels[id];
  else panels[id] = { ...panel, visible: false };
  const order = layout.panel_order.filter((key) => !remove || key !== id);
  runtime.editLayout({
    ...layout,
    panels,
    panel_order: order,
    workspace: prunePlacement(
      layout.workspace,
      order.filter((key) => panels[key].visible),
    ),
  });
}

const number = (value: unknown, digits = 3) =>
  typeof value === "number" && Number.isFinite(value)
    ? // Rounding can leave -0, which prints as "-0".
      (Math.abs(value) < 10 ** -digits ? 0 : value).toLocaleString(undefined, { maximumFractionDigits: digits })
    : "—";

function drawPlot(p: Painter, r: Rect, panel: Panel, samples: { t: number; value: unknown }[][], statuses: string[], now: number) {
  const series = panelSeries(panel);
  const windowMs = (panel.settings.window_seconds ?? 30) * 1000;
  const start = now - windowMs;
  const lines = samples.map((list) =>
    list.filter((s) => s.t >= start).map((s) => ({ t: s.t, v: typeof s.value === "number" && Number.isFinite(s.value) ? s.value : null })),
  );
  const values = lines.flat().flatMap((s) => (s.v === null ? [] : [s.v]));
  let min = values.length ? Math.min(...values) : 0;
  let max = values.length ? Math.max(...values) : 1;
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.06;
  min -= pad;
  max += pad;
  // The legend sits above the plot, one row per series.
  series.slice(0, 4).forEach((item, index) => {
    const y = r.y + 18 + index * 36;
    p.ctx.fillStyle = SERIES_COLORS[index % SERIES_COLORS.length];
    p.ctx.fillRect(r.x, y - 8, 28, 6);
    text(p, fit(p, item.label, r.w - 280, 26, 600), r.x + 42, y - 3, { size: 26, weight: 600, color: THEME.fg0 });
    text(p, statuses[index] ?? "", r.x + r.w, y - 3, { size: 24, mono: true, color: THEME.fg3, align: "right" });
  });
  const top = r.y + Math.min(series.length, 4) * 36 + 22;
  const plot: Rect = { x: r.x + 110, y: top, w: r.w - 130, h: r.y + r.h - top - 44 };
  p.ctx.strokeStyle = THEME.line2;
  p.ctx.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    const y = plot.y + (plot.h * i) / 4;
    p.ctx.beginPath();
    p.ctx.moveTo(plot.x, y);
    p.ctx.lineTo(plot.x + plot.w, y);
    p.ctx.stroke();
    text(p, number(max - ((max - min) * i) / 4, 3), plot.x - 12, y, { size: 22, mono: true, color: THEME.fg3, align: "right" });
  }
  text(p, `receive time · ${panel.settings.window_seconds ?? 30}s window`, plot.x + plot.w, plot.y + plot.h + 28, {
    size: 22,
    mono: true,
    color: THEME.fg4,
    align: "right",
  });
  lines.forEach((line, index) => {
    p.ctx.strokeStyle = SERIES_COLORS[index % SERIES_COLORS.length];
    p.ctx.lineWidth = 3.5;
    p.ctx.lineJoin = "round";
    p.ctx.beginPath();
    let pen = false;
    for (const point of line) {
      if (point.v === null) {
        pen = false;
        continue;
      }
      const x = plot.x + ((point.t - start) / windowMs) * plot.w;
      const y = plot.y + plot.h - ((point.v - min) / (max - min)) * plot.h;
      if (pen) p.ctx.lineTo(x, y);
      else p.ctx.moveTo(x, y);
      pen = true;
    }
    p.ctx.stroke();
  });
  if (!values.length) text(p, "Waiting for samples", plot.x + plot.w / 2, plot.y + plot.h / 2, { size: 32, color: THEME.fg3, align: "center" });
}

function drawState(p: Painter, r: Rect, panel: Panel, samples: { t: number; value: unknown }[], now: number) {
  const mapping = panel.settings.enum_labels ?? {};
  const value = samples.at(-1)?.value;
  const label = value === undefined ? "Waiting for a value" : (own(mapping, String(value)) ?? `Unmapped: ${String(value)}`);
  text(p, fit(p, label, r.w, 72, 600), r.x, r.y + 70, { size: 72, weight: 600, color: THEME.fg0 });
  const windowMs = (panel.settings.window_seconds ?? 30) * 1000;
  const start = now - windowMs;
  const changes = samples.filter((s, i) => i === 0 || s.value !== samples[i - 1].value);
  const bar: Rect = { x: r.x, y: r.y + 150, w: r.w, h: 90 };
  fillRound(p.ctx, bar, 8, THEME.bg2);
  changes.forEach((sample, i) => {
    const from = Math.max(start, sample.t);
    const to = changes[i + 1]?.t ?? now;
    if (to < start) return;
    const known = Object.hasOwn(mapping, String(sample.value));
    const index = Object.keys(mapping).indexOf(String(sample.value));
    p.ctx.fillStyle = known ? [THEME.accent, THEME.success, THEME.moderate, "#dc85ff"][Math.max(0, index) % 4] : THEME.line2;
    p.ctx.fillRect(bar.x + ((from - start) / windowMs) * bar.w, bar.y, Math.max(4, ((to - from) / windowMs) * bar.w), bar.h);
  });
  text(p, `receive time · ${panel.settings.window_seconds ?? 30}s window`, r.x, bar.y + bar.h + 36, { size: 24, mono: true, color: THEME.fg4 });
}

function drawGauge(p: Painter, r: Rect, panel: Panel, value: unknown) {
  const min = panel.settings.min ?? GAUGE_DEFAULT_MIN;
  const max = panel.settings.max ?? GAUGE_DEFAULT_MAX;
  const known = typeof value === "number" && Number.isFinite(value);
  const overflow = known ? gaugeOverflow(value, min, max) : undefined;
  const radius = Math.min(r.w / 2, r.h / 1.85) - 40;
  const cx = r.x + r.w / 2;
  const cy = r.y + radius + 40;
  const start = (GAUGE_START_DEG * Math.PI) / 180;
  const sweep = (GAUGE_SWEEP_DEG * Math.PI) / 180;
  const ctx = p.ctx;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineWidth = 34;
  ctx.strokeStyle = THEME.bg3;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, start, start + sweep);
  ctx.stroke();
  const fraction = known ? gaugeFraction(value, min, max) : 0;
  const colors = gaugeColors(panel.settings);
  if (fraction > 0 && colors) {
    // Short segments blended from the min color, with round ends drawn as dots.
    const count = Math.max(1, Math.ceil((GAUGE_SWEEP_DEG * fraction) / 2));
    ctx.lineCap = "butt";
    for (let i = 0; i < count; i++) {
      const from = (fraction * i) / count;
      const to = (fraction * (i + 1)) / count;
      ctx.strokeStyle = gaugeColor((from + to) / 2, colors.min, colors.max);
      ctx.beginPath();
      ctx.arc(cx, cy, radius, start + sweep * from, Math.min(start + sweep * to + 0.007, start + sweep * fraction));
      ctx.stroke();
    }
    for (const [at, color] of [[0, colors.min], [fraction, gaugeColor(fraction, colors.min, colors.max)]] as const) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx + radius * Math.cos(start + sweep * at), cy + radius * Math.sin(start + sweep * at), ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (fraction > 0) {
    ctx.strokeStyle = overflow ? THEME.moderate : THEME.accent;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, start + sweep * fraction);
    ctx.stroke();
  }
  ctx.restore();
  text(p, number(value, 4), cx, cy, { size: 110, weight: 600, mono: true, color: THEME.fg0, align: "center", maxWidth: radius * 1.5 });
  if (overflow) text(p, overflow === "over" ? "▲ over max" : "▼ under min", cx, cy + 90, { size: 30, mono: true, color: THEME.moderate, align: "center" });
  const end = start + sweep;
  text(p, number(min, 4), cx + radius * Math.cos(start), cy + radius * Math.sin(start) + 56, { size: 26, mono: true, color: THEME.fg3, align: "center" });
  text(p, number(max, 4), cx + radius * Math.cos(end), cy + radius * Math.sin(end) + 56, { size: 26, mono: true, color: THEME.fg3, align: "center" });
}

function drawJoints(p: Painter, r: Rect, joints: NamedJoint[]) {
  const columns = [0, 0.46, 0.64, 0.82];
  ["Joint", "Position", "Velocity", "Effort"].forEach((name, i) =>
    text(p, name.toUpperCase(), r.x + columns[i] * r.w, r.y + 20, { size: 22, weight: 600, mono: true, color: THEME.fg3 }),
  );
  const rows = Math.floor((r.h - 50) / 54);
  joints.slice(0, rows).forEach((joint, row) => {
    const y = r.y + 70 + row * 54;
    p.ctx.fillStyle = THEME.line1;
    p.ctx.fillRect(r.x, y - 27, r.w, 2);
    text(p, fit(p, joint.name, r.w * 0.44, 28, 600), r.x, y, { size: 28, weight: 600, color: THEME.fg0 });
    [joint.position, joint.velocity, joint.effort].forEach((v, i) =>
      text(p, v === undefined ? "—" : v.toFixed(3), r.x + columns[i + 1] * r.w, y, { size: 27, mono: true, color: THEME.accent }),
    );
  });
  if (joints.length > rows) text(p, `+${joints.length - rows} more joints`, r.x, r.y + r.h - 10, { size: 24, color: THEME.fg3 });
  if (!joints.length) text(p, "Waiting for joint states", r.x, r.y + 80, { size: 32, color: THEME.fg3 });
}

function drawRaw(p: Painter, r: Rect, value: unknown) {
  const json = value === undefined ? "Waiting for usable JSON…" : JSON.stringify(value, null, 2);
  const lines = json.split("\n");
  const rows = Math.floor(r.h / 34);
  lines.slice(0, rows).forEach((line, i) => text(p, fit(p, line, r.w, 26, 500, true), r.x, r.y + 18 + i * 34, { size: 26, mono: true, color: THEME.fg1 }));
  if (lines.length > rows) text(p, `… ${lines.length - rows} more lines`, r.x, r.y + r.h - 8, { size: 24, color: THEME.fg3 });
}

/** The saved visualizations, as tabs. The selected one draws below the tabs. */
export function VrVisualizationsPanel({
  hosts,
  position,
  rotation,
  onAdd,
}: {
  hosts: Map<string, { video: HTMLVideoElement }>;
  position: [number, number, number];
  rotation: [number, number, number];
  onAdd(): void;
}) {
  const runtime = useRuntime();
  const layout = runtime.layout;
  const visible = (layout?.panel_order ?? []).filter((id) => layout?.panels[id]?.visible);
  const [chosen, setChosen] = useState("");
  const [page, setPage] = useState(0);
  // A visualization that was just added opens at once.
  const [count, setCount] = useState(visible.length);
  if (count !== visible.length) {
    setCount(visible.length);
    if (visible.length > count) {
      setChosen(visible[visible.length - 1]);
      setPage(Math.max(0, visible.length - TABS_PER_PAGE));
    }
  }
  const id = visible.includes(chosen) ? chosen : (visible[0] ?? "");
  const panel = id ? layout!.panels[id] : undefined;
  const plot = panel?.visualization === "plot";
  const data = panel?.source.kind === "data";
  // VR consumers use their own keys, so the desktop panels keep their own streams.
  const view = useDataView(`vr:${id}`, panel ?? idle, !!panel && data && !plot);
  const seriesViews = useSeriesViews(`vr:${id}`, panel ?? idle, !!panel && data && plot);
  const publication = panel ? runtime.catalog().find((pub) => pub.kind === panel.source.kind && pub.name === panel.source.track_name) : undefined;
  const video = panel?.visualization === "video" && publication?.available ? hosts.get(publication.id)?.video : undefined;
  const now = runtime.clock.now();
  const first = Math.min(page, Math.max(0, visible.length - TABS_PER_PAGE));

  const paint = (p: Painter) => {
    frame(p, "Visualizations", `${visible.length} in workspace`);
    if (!panel) {
      text(p, "No visualizations yet", W / 2, 330, { size: 44, weight: 600, color: THEME.fg0, align: "center" });
      text(p, "Pick a topic to build your workspace.", W / 2, 392, { size: 28, color: THEME.fg3, align: "center" });
      button(p, { x: W / 2 - 230, y: 450, w: 460, h: 84 }, "add", "+  Add visualization", { kind: "primary", onClick: onAdd, size: 30 });
      return;
    }
    // Tabs, with arrows when there are more than fit.
    const more = visible.length > TABS_PER_PAGE;
    const tabsLeft = 44 + (more ? 70 : 0);
    if (more) {
      button(p, { x: 44, y: 84, w: 56, h: 72 }, "tabs-prev", "‹", { disabled: first === 0, onClick: () => setPage(first - 1), size: 36 });
      button(p, { x: W - 100, y: 84, w: 56, h: 72 }, "tabs-next", "›", {
        disabled: first + TABS_PER_PAGE >= visible.length,
        onClick: () => setPage(first + 1),
        size: 36,
      });
    }
    visible.slice(first, first + TABS_PER_PAGE).forEach((key, i) =>
      button(p, { x: tabsLeft + i * (TAB_W + 10), y: 84, w: TAB_W, h: 72 }, `tab-${key}`, layout!.panels[key].label, {
        kind: key === id ? "active" : "default",
        onClick: () => setChosen(key),
        size: 26,
      }),
    );

    const head = plot ? (seriesViews.find((v) => ["stale", "invalid", "unsupported", "excluded", "unavailable"].includes(v.status)) ?? seriesViews[0] ?? view) : view;
    const status = panel.source.kind === "data" ? head.status : publication?.excluded ? "excluded" : publication?.available ? "healthy" : "unavailable";
    const color = status === "healthy" ? THEME.success : status === "warning" || status === "stale" || status === "starting" || status === "unmonitored" ? THEME.moderate : status === "not_requested" ? THEME.fg3 : THEME.serious;
    dot(p, 56, 184, color, 8);
    text(p, panel.source.track_name, 76, 184, { size: 24, mono: true, color: THEME.fg3, maxWidth: W - 480 });

    const body = BODY;
    const display = view.value;
    if (panel.source.kind === "data") {
      if (head.reason) text(p, fit(p, head.reason, body.w, 26), body.x, body.y + 14, { size: 26, color: THEME.moderate });
      const inner: Rect = { ...body, y: body.y + (head.reason ? 40 : 0), h: body.h - (head.reason ? 40 : 0) };
      if (panel.visualization === "plot") drawPlot(p, inner, panel, seriesViews.map((v) => v.samples), seriesViews.map((v) => v.status), now);
      else if (panel.visualization === "value")
        text(p, number(display, 4), inner.x + inner.w / 2, inner.y + inner.h / 2, { size: 150, weight: 600, mono: true, color: THEME.fg0, align: "center", maxWidth: inner.w });
      else if (panel.visualization === "gauge") drawGauge(p, inner, panel, display);
      else if (panel.visualization === "boolean") {
        const on = display === true;
        dot(p, inner.x + inner.w / 2 - 200, inner.y + inner.h / 2, display === undefined ? THEME.fg4 : on ? THEME.success : THEME.serious, 44);
        text(p, display === true ? "TRUE" : display === false ? "FALSE" : "UNKNOWN", inner.x + inner.w / 2 - 130, inner.y + inner.h / 2, { size: 110, weight: 600, color: THEME.fg0 });
      } else if (panel.visualization === "state") drawState(p, inner, panel, view.samples, now);
      else if (panel.visualization === "joints") drawJoints(p, inner, (display as NamedJoint[] | undefined) ?? []);
      else drawRaw(p, inner, display);
    } else if (panel.visualization === "audio") {
      wrap(p, "Audio listening is not available in immersive VR. Use the desktop workspace to listen.", body.w, 30, 3).forEach((line, i) =>
        text(p, line, body.x, body.y + 40 + i * 44, { size: 30, color: THEME.fg3 }),
      );
    } else if (!video) {
      text(p, publication?.excluded ? "Blocked by the robot’s current exclusions." : "Waiting for this exact publication.", body.x, body.y + 40, { size: 30, color: THEME.fg3 });
    }

    text(p, data ? `${head.observedRate.toFixed(1)} arrivals/s · ${status}` : status, 44, H - 70, { size: 24, mono: true, color: THEME.fg3 });
    button(p, { x: W - 44 - 300, y: H - 100, w: 140, h: 60 }, "hide", "Hide", { onClick: () => hide(runtime, id, false), size: 26 });
    button(p, { x: W - 44 - 150, y: H - 100, w: 150, h: 60 }, "remove", "Remove", { kind: "danger", onClick: () => hide(runtime, id, true), size: 26 });
  };

  const scale = PANEL_WIDTH / W;
  return (
    <group position={position} rotation={rotation}>
      <VrCanvasPanel position={[0, 0, 0]} width={PANEL_WIDTH} canvasWidth={W} canvasHeight={H} paint={paint} />
      {video && panel && (
        <VrVideo
          video={video}
          stereo={panel.settings.image_layout === "stereo_sbs"}
          width={BODY.w * scale}
          maxHeight={BODY.h * scale}
          position={[(BODY.x + BODY.w / 2 - W / 2) * scale, (H / 2 - BODY.y - BODY.h / 2) * scale, 0.01]}
        />
      )}
    </group>
  );
}
