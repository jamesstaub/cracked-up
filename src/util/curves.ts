import type { NumberParamMeta } from '../api';

type RangeMeta = Pick<NumberParamMeta, 'min' | 'max' | 'curve'>;

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/** Maps a native value to 0..1 along the parameter's curve. Input is clamped to the range. */
export function toNormalized(value: number, meta: RangeMeta): number {
  const { min, max } = meta;
  if (max === min) return 0;
  const v = clamp(value, Math.min(min, max), Math.max(min, max));
  let p: number;
  if (meta.curve === 'log' && min > 0 && max > 0) p = Math.log(v / min) / Math.log(max / min);
  else if (meta.curve === 'exp') p = Math.sqrt((v - min) / (max - min));
  else p = (v - min) / (max - min);
  return clamp(p, 0, 1);
}

/** Maps a 0..1 position to a native value along the curve. Position is clamped to 0..1. */
export function fromNormalized(position: number, meta: RangeMeta): number {
  const { min, max } = meta;
  const p = clamp(position, 0, 1);
  let v: number;
  if (meta.curve === 'log' && min > 0 && max > 0) v = min * Math.pow(max / min, p);
  else if (meta.curve === 'exp') v = min + (max - min) * p * p;
  else v = min + (max - min) * p;
  return clamp(v, Math.min(min, max), Math.max(min, max));
}

/** Clamps to min..max, then snaps to `step` measured from min (when step > 0). */
export function clampToMeta(
  value: number,
  meta: Pick<NumberParamMeta, 'min' | 'max' | 'step'>,
): number {
  const lo = Math.min(meta.min, meta.max);
  const hi = Math.max(meta.min, meta.max);
  let v = clamp(value, lo, hi);
  const step = meta.step;
  if (step !== undefined && step > 0) {
    v = meta.min + Math.round((v - meta.min) / step) * step;
    // Floating point noise from the multiplication: trim to the step's precision.
    const decimals = (String(step).split('.')[1] ?? '').length;
    v = Number(v.toFixed(Math.min(decimals + 6, 15)));
    v = clamp(v, lo, hi);
  }
  return v;
}
