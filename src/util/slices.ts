import type { Duration } from '../api';
import { beatsToSeconds, durationToBeats } from './duration';
import { detectOnsets } from './onsets';
import type { OnsetOptions } from './onsets';
import { audioData } from './waveform';
import type { AudioSource } from './waveform';

/** No helper makes more slices than this. */
const MAX_SLICES = 4096;

/** Boundaries are never put closer together than this, in seconds: a slice that short is a click. */
const MIN_SLICE = 0.001;

/**
 * Slice boundaries as a buffer wants them: only finite numbers, in ascending order, each one once,
 * and with `duration` given, none outside the sound (those are moved to its start or end).
 */
export function normalizeSlices(boundaries: readonly number[], duration?: number): number[] {
  const inside = boundaries
    .filter((time) => Number.isFinite(time))
    .map((time) => (duration === undefined ? time : Math.min(Math.max(time, 0), duration)))
    .sort((a, b) => a - b);
  return inside.filter((time, index) => index === 0 || time !== inside[index - 1]);
}

/**
 * Slice boundaries for a sound cut into equal parts: `count` slices need `count + 1` boundaries, in
 * seconds. `offset` moves the whole grid later, for a sound whose first hit is not at its start.
 */
export function sliceGrid(seconds: number, count: number, offset = 0): number[] {
  const slices = Math.min(MAX_SLICES, Math.max(1, Math.floor(count)));
  return Array.from({ length: slices + 1 }, (_, index) => offset + (seconds * index) / slices);
}

/**
 * Slice boundaries for a sound played to a steady beat: one every `step` at `bpm`, from `offset`
 * (where the first hit is) to the end of the sound, which is the last boundary.
 */
export function sliceByTempo(
  seconds: number,
  bpm: number,
  step: Duration = '1/16',
  offset = 0,
): number[] {
  const length = beatsToSeconds(durationToBeats(step), bpm);
  if (!(length > 0) || !Number.isFinite(length)) {
    throw new RangeError(`sliceByTempo needs a tempo and a step longer than nothing.`);
  }
  const boundaries: number[] = [];
  // The last step may be cut short by the end, but not to less than a click.
  for (let i = 0; i < MAX_SLICES && offset + i * length < seconds - MIN_SLICE; i++) {
    boundaries.push(offset + i * length);
  }
  boundaries.push(seconds);
  return boundaries;
}

/**
 * Slice boundaries where the hits of a sound begin, found by `detectOnsets` (which the options go
 * to): the start of the sound, every onset, and the end.
 */
export function sliceByOnsets(source: AudioSource, options: OnsetOptions = {}): number[] {
  const audio = audioData(source);
  const duration = (audio.channels[0]?.length ?? 0) / audio.sampleRate;
  const onsets = detectOnsets(audio, options).filter(
    (time) => time >= MIN_SLICE && time <= duration - MIN_SLICE,
  );
  return [0, ...onsets.slice(0, MAX_SLICES - 1), duration];
}

/**
 * The boundaries with one more, at `time`. Nothing is added within a millisecond of a boundary that
 * is already there, or (with `duration` given) outside the sound. Returns a new list.
 */
export function addSlice(boundaries: readonly number[], time: number, duration?: number): number[] {
  const current = normalizeSlices(boundaries, duration);
  if (!Number.isFinite(time) || time < 0 || (duration !== undefined && time > duration)) {
    return current;
  }
  if (current.some((other) => Math.abs(other - time) < MIN_SLICE)) return current;
  return normalizeSlices([...current, time]);
}

/**
 * The boundaries with the one at `index` moved to `time`. It stays between its neighbours, a
 * millisecond clear of each (and, with `duration` given, inside the sound), so the boundaries keep
 * their order and their number while one is dragged. Returns a new list.
 */
export function moveSlice(
  boundaries: readonly number[],
  index: number,
  time: number,
  duration?: number,
): number[] {
  const current = normalizeSlices(boundaries, duration);
  if (!Number.isInteger(index) || index < 0 || index >= current.length || !Number.isFinite(time)) {
    return current;
  }
  const low = index === 0 ? 0 : current[index - 1]! + MIN_SLICE;
  const high =
    index === current.length - 1 ? (duration ?? Infinity) : current[index + 1]! - MIN_SLICE;
  // Neighbours too close to move between: it stays where it is.
  if (high >= low) current[index] = Math.min(Math.max(time, low), high);
  return current;
}

/** The boundaries without the one at `index`. Returns a new list. */
export function removeSlice(
  boundaries: readonly number[],
  index: number,
  duration?: number,
): number[] {
  return normalizeSlices(boundaries, duration).filter((_, at) => at !== index);
}

/** Which slice a time falls in: the number to give `trigger({ slice })`. -1 outside every slice. */
export function sliceAt(boundaries: readonly number[], time: number): number {
  if (boundaries.length < 2 || !(time >= boundaries[0]!)) return -1;
  for (let index = 0; index < boundaries.length - 1; index++) {
    if (time < boundaries[index + 1]!) return index;
  }
  return -1;
}
