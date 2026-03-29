'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';

interface GyroscopeProps {
  x?: number;
  y?: number;
  z?: number;
}

type Vec3 = readonly [number, number, number];

const SEGMENTS = 48;

/** Apply Rz * Ry * Rx to point p (radians). */
function rotateXYZ(p: Vec3, rx: number, ry: number, rz: number): Vec3 {
  let [x, y, z] = p;
  // Rx
  {
    const c = Math.cos(rx);
    const s = Math.sin(rx);
    const ny = y * c - z * s;
    const nz = y * s + z * c;
    y = ny;
    z = nz;
  }
  // Ry
  {
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    const nx = x * c + z * s;
    const nz = -x * s + z * c;
    x = nx;
    z = nz;
  }
  // Rz
  {
    const c = Math.cos(rz);
    const s = Math.sin(rz);
    const nx = x * c - y * s;
    const ny = x * s + y * c;
    x = nx;
    y = ny;
  }
  return [x, y, z];
}

function circleInYZ(radius: number, i: number, n: number): Vec3 {
  const t = (i / n) * Math.PI * 2;
  return [0, radius * Math.cos(t), radius * Math.sin(t)];
}

function circleInXZ(radius: number, i: number, n: number): Vec3 {
  const t = (i / n) * Math.PI * 2;
  return [radius * Math.cos(t), 0, radius * Math.sin(t)];
}

function circleInXY(radius: number, i: number, n: number): Vec3 {
  const t = (i / n) * Math.PI * 2;
  return [radius * Math.cos(t), radius * Math.sin(t), 0];
}

function avgZ(points: Vec3[]): number {
  let s = 0;
  for (const p of points) s += p[2];
  return s / points.length;
}

export function Gyroscope({ x = 0, y = 0, z = 0 }: GyroscopeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const ratesRef = useRef({ x, y, z });

  useLayoutEffect(() => {
    ratesRef.current = { x, y, z };
  }, [x, y, z]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let angX = 0;
    let angY = 0;
    let angZ = 0;
    let last = performance.now();
    let rafId = 0;
    let logicalW = 40;
    let logicalH = 40;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      logicalW = Math.max(1, rect.width);
      logicalH = Math.max(1, rect.height);
      canvas.width = Math.floor(logicalW * dpr);
      canvas.height = Math.floor(logicalH * dpr);
      canvas.style.width = `${logicalW}px`;
      canvas.style.height = `${logicalH}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    const draw = (now: number) => {
      const dt = Math.min(now - last, 48);
      last = now;

      const { x: xr, y: yr, z: zr } = ratesRef.current;
      const dpsToRadPerMs = Math.PI / 180 / 1000;
      const xi = Number.isFinite(xr) ? xr : 0;
      const yi = Number.isFinite(yr) ? yr : 0;
      const zi = Number.isFinite(zr) ? zr : 0;
      angX += xi * dt * dpsToRadPerMs;
      angY += yi * dt * dpsToRadPerMs;
      angZ += zi * dt * dpsToRadPerMs;

      const w = logicalW;
      const h = logicalH;
      const cx = w / 2;
      const cy = h / 2;
      const r3 = 1;
      const scale = Math.min(w, h) * 0.42;

      ctx.clearRect(0, 0, w, h);

      const project = (p: Vec3): [number, number] => [cx + p[0] * scale, cy - p[1] * scale];

      type Ring = { zKey: number; draw: () => void };

      const rings: Ring[] = [];

      // X axis — red — circle in YZ plane
      {
        const pts: Vec3[] = [];
        for (let i = 0; i <= SEGMENTS; i++) {
          pts.push(rotateXYZ(circleInYZ(r3, i, SEGMENTS), angX, angY, angZ));
        }
        const zKey = avgZ(pts.slice(0, -1));
        rings.push({
          zKey,
          draw: () => {
            ctx.strokeStyle = 'oklch(0.637 0.237 25.33)';
            ctx.lineWidth = 1.25;
            ctx.lineJoin = 'round';
            ctx.beginPath();
            const p0 = pts[0];
            if (!p0) return;
            const [sx, sy] = project(p0);
            ctx.moveTo(sx, sy);
            for (let i = 1; i < pts.length; i++) {
              const [px, py] = project(pts[i]!);
              ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.stroke();
          },
        });
      }

      // Y axis — green — circle in XZ plane
      {
        const pts: Vec3[] = [];
        for (let i = 0; i <= SEGMENTS; i++) {
          pts.push(rotateXYZ(circleInXZ(r3, i, SEGMENTS), angX, angY, angZ));
        }
        const zKey = avgZ(pts.slice(0, -1));
        rings.push({
          zKey,
          draw: () => {
            ctx.strokeStyle = 'oklch(0.717 0.176 142.71)';
            ctx.lineWidth = 1.25;
            ctx.lineJoin = 'round';
            ctx.beginPath();
            const p0 = pts[0];
            if (!p0) return;
            const [sx, sy] = project(p0);
            ctx.moveTo(sx, sy);
            for (let i = 1; i < pts.length; i++) {
              const [px, py] = project(pts[i]!);
              ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.stroke();
          },
        });
      }

      // Z axis — blue — circle in XY plane
      {
        const pts: Vec3[] = [];
        for (let i = 0; i <= SEGMENTS; i++) {
          pts.push(rotateXYZ(circleInXY(r3, i, SEGMENTS), angX, angY, angZ));
        }
        const zKey = avgZ(pts.slice(0, -1));
        rings.push({
          zKey,
          draw: () => {
            ctx.strokeStyle = 'oklch(0.717 0.129 218.88)';
            ctx.lineWidth = 1.25;
            ctx.lineJoin = 'round';
            ctx.beginPath();
            const p0 = pts[0];
            if (!p0) return;
            const [sx, sy] = project(p0);
            ctx.moveTo(sx, sy);
            for (let i = 1; i < pts.length; i++) {
              const [px, py] = project(pts[i]!);
              ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.stroke();
          },
        });
      }

      rings.sort((a, b) => a.zKey - b.zKey);
      for (const ring of rings) ring.draw();

      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, []);

  return (
    <div className="border-accent-foreground/50 size-10 rounded border p-1">
      <div ref={containerRef} className="relative size-full">
        <canvas ref={canvasRef} className="absolute size-full" aria-hidden />
      </div>
    </div>
  );
}
