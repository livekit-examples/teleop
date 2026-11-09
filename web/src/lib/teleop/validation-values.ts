import type { FieldPath } from './types';

export function object(value: unknown, label = 'Value'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}
export function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${label} must be a non-empty string.`);
  return value;
}
export function positive(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
    throw new Error(`${label} must be a positive finite number.`);
  return value;
}
export function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  const result = value.map((v) => string(v, label));
  if (new Set(result).size !== result.length) throw new Error(`${label} has duplicate entries.`);
  return result;
}
export function localId(value: string) {
  if (!/^[a-z][a-z0-9_]*$/.test(value))
    throw new Error(`Invalid local ID: ${value}. Use snake_case.`);
  return value;
}
export function fieldPath(value: unknown): FieldPath {
  if (
    !Array.isArray(value) ||
    !value.every(
      (v) => typeof v === 'string' || (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0),
    )
  )
    throw new Error(
      'Field path must be an array of literal property names or non-negative indices.',
    );
  return value;
}
