import { createEngine } from '../../src';
import type { Engine } from '../../src';
import { SAMPLE_RATE } from '../core/setup';

/** Magnitude of one frequency in a mono signal (a single-bin DFT), scaled so a sine of amplitude A reads A. */
export function goertzel(data: Float32Array, frequency: number, sampleRate = SAMPLE_RATE): number {
  let re = 0;
  let im = 0;
  const w = (2 * Math.PI * frequency) / sampleRate;
  for (let i = 0; i < data.length; i++) {
    re += (data[i] ?? 0) * Math.cos(w * i);
    im -= (data[i] ?? 0) * Math.sin(w * i);
  }
  return (2 * Math.hypot(re, im)) / data.length;
}

/** An offline engine with an explicit random seed. */
export async function seededEngine(seconds: number, seed: number): Promise<Engine> {
  const context = new OfflineAudioContext(1, Math.round(SAMPLE_RATE * seconds), SAMPLE_RATE);
  return createEngine({ context, seed });
}

/** The first channel of an audio buffer as a plain copy. */
export const samples = (buffer: AudioBuffer): Float32Array => buffer.getChannelData(0).slice();

/** True when two sample arrays are bit-identical. */
export function identical(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

/** The largest absolute difference between two sample arrays over a range. */
export function maxDiff(a: Float32Array, b: Float32Array, from = 0, to = a.length): number {
  let max = 0;
  for (let i = from; i < to; i++) max = Math.max(max, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
  return max;
}
