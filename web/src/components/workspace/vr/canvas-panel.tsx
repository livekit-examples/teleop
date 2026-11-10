"use client";

import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { CanvasTexture, SRGBColorSpace } from "three";

/*
 * 2D panels for the immersive view. A panel draws itself on a canvas, and the
 * canvas is a texture on one plane. A button records its own hit box while it
 * draws, so drawing and picking cannot disagree. Colors are the workspace
 * tokens from globals.css, and every panel uses an unlit material.
 */
export const THEME = {
  bg0: "#000000",
  bg1: "#070707",
  bg2: "#131313",
  bg3: "#1f1f1f",
  line1: "#202020",
  line2: "#30302f",
  fg0: "#ffffff",
  fg1: "#cccccc",
  fg3: "#999999",
  fg4: "#666666",
  accent: "#1fd5f9",
  accentDim: "#15889f",
  accentLine: "#035c6d",
  accentBg: "#051518",
  accentBg2: "#012a32",
  success: "#23de6b",
  moderate: "#ffb752",
  serious: "#ff7566",
  seriousBg: "#1f0e0b",
  seriousLine: "#b32909",
} as const;

export type Rect = { x: number; y: number; w: number; h: number };
export type Hit = Rect & {
  id: string;
  onClick?: () => void;
  /** Called instead of `onClick` with the canvas x of the hit, for sliders. */
  onPoint?(x: number): void;
  disabled?: boolean;
  /** The visible part of a scrolled area. The pointer must be inside it too. */
  clip?: Rect;
};

/** What a panel draws with. `ox`/`oy` and `clip` are set while a scroll area draws. */
export type Painter = {
  ctx: CanvasRenderingContext2D;
  hits: Hit[];
  hovered: string | null;
  width: number;
  height: number;
  ox: number;
  oy: number;
  clip?: Rect;
};

let fonts: { sans: string; mono: string } | undefined;
/** The page fonts, so panels match the workspace. Canvas cannot read CSS variables. */
function pageFonts() {
  if (fonts) return fonts;
  const fallback = { sans: "ui-sans-serif, system-ui, sans-serif", mono: "ui-monospace, SFMono-Regular, monospace" };
  if (typeof document === "undefined") return fallback;
  const style = getComputedStyle(document.documentElement);
  const family = (name: string, rest: string) => {
    const value = style.getPropertyValue(name).trim();
    return value ? `${value}, ${rest}` : rest;
  };
  fonts = {
    sans: family("--font-lk-sans", fallback.sans),
    mono: family("--font-lk-mono", fallback.mono),
  };
  return fonts;
}

export function font(size: number, weight = 500, mono = false) {
  const { sans, mono: monospace } = pageFonts();
  return `${weight} ${size}px ${mono ? monospace : sans}`;
}

export function fillRound(ctx: CanvasRenderingContext2D, r: Rect, radius: number, fill: string, stroke?: string, lineWidth = 3) {
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

type TextOptions = {
  size?: number;
  weight?: number;
  color?: string;
  mono?: boolean;
  align?: CanvasTextAlign;
  maxWidth?: number;
};

export function text(p: Painter, value: string, x: number, y: number, options: TextOptions = {}) {
  const { ctx } = p;
  ctx.font = font(options.size ?? 30, options.weight ?? 500, options.mono);
  ctx.fillStyle = options.color ?? THEME.fg1;
  ctx.textAlign = options.align ?? "left";
  ctx.textBaseline = "middle";
  ctx.fillText(value, x, y, options.maxWidth);
}

/** Cut text to a pixel width, with an ellipsis. */
export function fit(p: Painter, value: string, width: number, size: number, weight = 500, mono = false) {
  p.ctx.font = font(size, weight, mono);
  if (p.ctx.measureText(value).width <= width) return value;
  let out = value;
  while (out.length > 1 && p.ctx.measureText(`${out}…`).width > width) out = out.slice(0, -1);
  return `${out}…`;
}

/** Words wrapped to a pixel width, at most `lines` lines. */
export function wrap(p: Painter, value: string, width: number, size: number, lines: number, mono = false) {
  p.ctx.font = font(size, 500, mono);
  const out: string[] = [];
  let line = "";
  for (const word of value.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && p.ctx.measureText(next).width > width) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  if (out.length > lines) {
    out.length = lines;
    out[lines - 1] = fit(p, `${out[lines - 1]} …`, width, size, 500, mono);
  }
  return out;
}

export type ButtonKind = "default" | "primary" | "danger" | "active";

/** A button. The hit box is registered as the button draws. */
export function button(
  p: Painter,
  r: Rect,
  id: string,
  label: string,
  options: { kind?: ButtonKind; disabled?: boolean; onClick?: () => void; size?: number } = {},
) {
  const { kind = "default", disabled = false, size = 28 } = options;
  const hovered = !disabled && p.hovered === id;
  const palette = {
    default: { fill: THEME.bg2, line: THEME.line2, fg: THEME.fg0, hover: THEME.bg3, hoverLine: THEME.fg4 },
    primary: { fill: THEME.accentBg, line: THEME.accentLine, fg: THEME.accent, hover: THEME.accentBg2, hoverLine: THEME.accent },
    danger: { fill: THEME.seriousBg, line: THEME.seriousLine, fg: THEME.serious, hover: "#421510", hoverLine: THEME.serious },
    active: { fill: THEME.accentBg2, line: THEME.accent, fg: THEME.fg0, hover: THEME.accentBg2, hoverLine: THEME.accent },
  }[kind];
  fillRound(
    p.ctx,
    r,
    10,
    disabled ? THEME.bg1 : hovered ? palette.hover : palette.fill,
    disabled ? THEME.line1 : hovered ? palette.hoverLine : palette.line,
    hovered ? 4 : 3,
  );
  text(p, fit(p, label, r.w - 20, size, 600), r.x + r.w / 2, r.y + r.h / 2 + 1, {
    size,
    weight: 600,
    color: disabled ? THEME.fg4 : palette.fg,
    align: "center",
  });
  p.hits.push({
    id,
    x: r.x + p.ox,
    y: r.y + p.oy,
    w: r.w,
    h: r.h,
    disabled,
    onClick: options.onClick,
    clip: p.clip,
  });
}

/** A hit box without a drawing, for areas that the caller draws itself. */
export function region(p: Painter, r: Rect, id: string, onClick?: () => void) {
  p.hits.push({ id, x: r.x + p.ox, y: r.y + p.oy, w: r.w, h: r.h, onClick, clip: p.clip });
}

/** A status pill, such as "Armed". */
export function badge(p: Painter, label: string, right: number, y: number, tone: "ok" | "muted" | "warn" | "bad") {
  const color = { ok: THEME.success, muted: THEME.fg3, warn: THEME.moderate, bad: THEME.serious }[tone];
  p.ctx.font = font(22, 600, true);
  const width = p.ctx.measureText(label.toUpperCase()).width + 34;
  fillRound(p.ctx, { x: right - width, y: y - 18, w: width, h: 36 }, 18, THEME.bg2, color, 2);
  text(p, label.toUpperCase(), right - width / 2, y + 1, { size: 22, weight: 600, mono: true, color, align: "center" });
}

export function dot(p: Painter, x: number, y: number, color: string, radius = 9) {
  p.ctx.fillStyle = color;
  p.ctx.beginPath();
  p.ctx.arc(x, y, radius, 0, Math.PI * 2);
  p.ctx.fill();
}

/**
 * Draw `content` in a window that shows `contentHeight` pixels of it from
 * `scroll`. Hit boxes that fall outside the window never fire.
 */
export function scrollArea(p: Painter, area: Rect, scroll: number, content: (inner: Painter) => void) {
  const { ctx } = p;
  ctx.save();
  ctx.beginPath();
  ctx.rect(area.x, area.y, area.w, area.h);
  ctx.clip();
  ctx.translate(area.x, area.y - scroll);
  content({ ...p, ox: p.ox + area.x, oy: p.oy + area.y - scroll, clip: { x: area.x + p.ox, y: area.y + p.oy, w: area.w, h: area.h } });
  ctx.restore();
}

export function frame(p: Painter, title: string, subtitle?: string) {
  fillRound(p.ctx, { x: 3, y: 3, w: p.width - 6, h: p.height - 6 }, 24, "rgba(7, 7, 7, 0.97)", THEME.line2, 4);
  text(p, title.toUpperCase(), 44, 58, { size: 26, weight: 600, mono: true, color: THEME.accent });
  if (subtitle) text(p, subtitle, p.width - 44, 58, { size: 24, color: THEME.fg3, align: "right", mono: true });
}

const inside = (r: Rect, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

/** The fastest that one panel redraws. Panels hold text and buttons, so 10 Hz reads as live. */
const REDRAW_INTERVAL_MS = 100;

export function VrCanvasPanel({
  position,
  rotation,
  width,
  canvasWidth,
  canvasHeight,
  paint,
  transparent = true,
  renderOrder,
}: {
  position: [number, number, number];
  rotation?: [number, number, number];
  /** Panel width in meters. The height follows the canvas aspect. */
  width: number;
  canvasWidth: number;
  canvasHeight: number;
  /** Draws the whole panel. It runs on every render of the panel. */
  paint(p: Painter): void;
  transparent?: boolean;
  renderOrder?: number;
}) {
  const canvas = useMemo(() => {
    if (typeof document === "undefined") return null;
    const next = document.createElement("canvas");
    next.width = canvasWidth;
    next.height = canvasHeight;
    return next;
  }, [canvasWidth, canvasHeight]);
  const texture = useMemo(() => {
    if (!canvas) return null;
    const next = new CanvasTexture(canvas);
    next.colorSpace = SRGBColorSpace;
    return next;
  }, [canvas]);
  useEffect(() => () => texture?.dispose(), [texture]);
  const hits = useRef<Hit[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);
  // The caller renders on every runtime update, and telemetry updates many times a second. Drawing
  // and uploading a large canvas for each one stalls the headset frame loop, which shows as jitter.
  // So each render only marks the panel dirty, and the frame loop redraws it at a limited rate.
  const latest = useRef(paint);
  const dirty = useRef(true);
  const drawnAt = useRef(0);
  useEffect(() => {
    latest.current = paint;
    dirty.current = true;
  });
  useEffect(() => {
    dirty.current = true;
  }, [hovered, canvas]);
  useFrame(() => {
    if (!dirty.current) return;
    const now = performance.now();
    if (now - drawnAt.current < REDRAW_INTERVAL_MS) return;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !texture) return;
    dirty.current = false;
    drawnAt.current = now;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const list: Hit[] = [];
    latest.current({ ctx, hits: list, hovered, width: canvas.width, height: canvas.height, ox: 0, oy: 0 });
    hits.current = list;
    texture.needsUpdate = true;
  });
  if (!texture) return null;
  const at = (event: ThreeEvent<PointerEvent | MouseEvent>) => {
    if (!event.uv) return undefined;
    const x = event.uv.x * canvasWidth;
    const y = (1 - event.uv.y) * canvasHeight;
    // The last box drawn is the top one.
    return [...hits.current].reverse().find((hit) => inside(hit, x, y) && (!hit.clip || inside(hit.clip, x, y)));
  };
  return (
    <mesh
      position={position}
      rotation={rotation}
      scale={[width, (width * canvasHeight) / canvasWidth, 1]}
      renderOrder={renderOrder}
      onPointerMove={(event) => {
        const hit = at(event);
        const next = hit && !hit.disabled ? hit.id : null;
        setHovered((current) => (current === next ? current : next));
      }}
      onPointerOut={() => setHovered(null)}
      onClick={(event) => {
        const hit = at(event);
        if (!hit) return;
        event.stopPropagation();
        if (hit.disabled) return;
        if (hit.onPoint && event.uv) hit.onPoint(event.uv.x * canvasWidth);
        else hit.onClick?.();
      }}
    >
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={texture} transparent={transparent} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}
