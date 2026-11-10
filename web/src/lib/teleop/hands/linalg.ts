/** Small 3D linear algebra for hand tracking. A matrix is 9 numbers, row-major. */
export type V3 = [number, number, number];
export type M3 = number[];

export const EYE: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = (a: ArrayLike<number>) => Math.hypot(...Array.from(a));
export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const unit = (a: V3): V3 => scale(a, 1 / Math.max(norm(a), 1e-9));
export const mean = (points: V3[]): V3 => {
  const sum = points.reduce((acc, p) => add(acc, p), [0, 0, 0] as V3);
  return scale(sum, 1 / points.length);
};

export const diag = (a: number, b: number, c: number): M3 => [a, 0, 0, 0, b, 0, 0, 0, c];
export const T = (m: M3): M3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
export const mul = (a: M3, b: M3): M3 => {
  const out: number[] = Array.from({ length: 9 }, () => 0);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      out[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return out;
};
export const apply = (m: M3, v: V3): V3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];
/** A matrix from three column vectors. */
export const columns = (x: V3, y: V3, z: V3): M3 => [
  x[0],
  y[0],
  z[0],
  x[1],
  y[1],
  z[1],
  x[2],
  y[2],
  z[2],
];
export const trace = (m: M3) => m[0] + m[4] + m[8];

/** The rotation about `axis` (unit) by `angle`, by Rodrigues' formula. */
export function fromAxisAngle(axis: V3, angle: number): M3 {
  const [x, y, z] = axis;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    t * x * x + c,
    t * x * y - s * z,
    t * x * z + s * y,
    t * x * y + s * z,
    t * y * y + c,
    t * y * z - s * x,
    t * x * z - s * y,
    t * y * z + s * x,
    t * z * z + c,
  ];
}
export function fromRotvec(v: V3): M3 {
  const angle = norm(v);
  return angle < 1e-12 ? EYE : fromAxisAngle(scale(v, 1 / angle), angle);
}

export type Quat = { x: number; y: number; z: number; w: number };
export function toQuat(m: M3): Quat {
  const t = trace(m);
  let q: Quat;
  if (t > 0) {
    const s = Math.sqrt(t + 1) * 2;
    q = { w: s / 4, x: (m[7] - m[5]) / s, y: (m[2] - m[6]) / s, z: (m[3] - m[1]) / s };
  } else if (m[0] > m[4] && m[0] > m[8]) {
    const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2;
    q = { w: (m[7] - m[5]) / s, x: s / 4, y: (m[1] + m[3]) / s, z: (m[2] + m[6]) / s };
  } else if (m[4] > m[8]) {
    const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2;
    q = { w: (m[2] - m[6]) / s, x: (m[1] + m[3]) / s, y: s / 4, z: (m[5] + m[7]) / s };
  } else {
    const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2;
    q = { w: (m[3] - m[1]) / s, x: (m[2] + m[6]) / s, y: (m[5] + m[7]) / s, z: s / 4 };
  }
  const n = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
}
export function fromQuat(q: Quat): M3 {
  const n = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  const [x, y, z, w] = [q.x / n, q.y / n, q.z / n, q.w / n];
  return [
    1 - 2 * (y * y + z * z),
    2 * (x * y - z * w),
    2 * (x * z + y * w),
    2 * (x * y + z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z - x * w),
    2 * (x * z - y * w),
    2 * (y * z + x * w),
    1 - 2 * (x * x + y * y),
  ];
}
/** The rotation as one vector: its axis times its angle, by the shortest turn. */
export function toRotvec(m: M3): V3 {
  let q = toQuat(m);
  if (q.w < 0) q = { x: -q.x, y: -q.y, z: -q.z, w: -q.w };
  const s = Math.hypot(q.x, q.y, q.z);
  if (s < 1e-12) return [0, 0, 0];
  const angle = 2 * Math.atan2(s, q.w);
  return [(q.x / s) * angle, (q.y / s) * angle, (q.z / s) * angle];
}
/** The angle of the turn from rotation `a` to rotation `b`, in rad. */
export const turnBetween = (a: M3, b: M3) =>
  Math.acos(Math.min(1, Math.max(-1, (trace(mul(b, T(a))) - 1) / 2)));

/** Solve the 3x3 system `a x = b` by Cramer's rule. Null when it is singular. */
export function solve3(a: M3, b: V3): V3 | null {
  const det = (m: M3) =>
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6]);
  const d = det(a);
  if (Math.abs(d) < 1e-18) return null;
  const col = (k: number) => {
    const m = [...a];
    for (let i = 0; i < 3; i++) m[i * 3 + k] = b[i];
    return det(m) / d;
  };
  return [col(0), col(1), col(2)];
}
