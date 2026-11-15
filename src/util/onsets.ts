import { audioData } from './waveform';
import type { AudioSource } from './waveform';

export interface OnsetOptions {
  /**
   * 0 to 1. Higher finds quieter and softer-edged hits, and is more easily fooled. Default 0.5.
   * A hit counts when the level jumps by 15 dB at 0, 9 dB at 0.5 and 3 dB at 1 within about 10 ms,
   * and is no further below the loudest moment of the sound than 20 dB at 0, 40 dB at 0.5 and
   * 60 dB at 1.
   */
  sensitivity?: number;
  /** Seconds: the least time between two onsets. Default 0.05. */
  minGap?: number;
  /** Seconds: where to start looking. Default 0. */
  start?: number;
  /** Seconds: where to stop looking. Default: the end of the sound. */
  end?: number;
}

/** Hops of energy that make up the window a new sound is measured in. */
const AHEAD = 4;
/** Hops of energy before it that it is compared with. */
const BEHIND = 8;

/**
 * Finds where sounds begin: the times, in seconds, at which the level jumps. For cutting a recording
 * at its hits (`sliceByOnsets`) or showing them.
 *
 * It measures energy in steps of about 3 ms, over the whole signal and over its high frequencies
 * alone (so a hi-hat over a ringing kick is found), and reports a time when the 12 ms that follow
 * are louder than the 23 ms before by more than the sensitivity asks. The time is then moved to the
 * first sample that rises above what came just before. Before the start of the sound counts as
 * silence, so a sound that begins at once has an onset at its start, and so, at the default
 * sensitivity and above, does one that fades in from nothing, near where it becomes audible.
 *
 * The same input always gives the same answer. All channels are averaged first. It reads every
 * sample three times and keeps two numbers per 3 ms, so a five-minute sound takes tens of
 * milliseconds. A sound that swells slowly out of another has no onset to find; a low note below
 * about 30 Hz can be mistaken for hits at the highest sensitivity.
 */
export function detectOnsets(source: AudioSource, options: OnsetOptions = {}): number[] {
  const { sampleRate, channels } = audioData(source);
  const total = channels[0]?.length ?? 0;
  const sensitivity = Math.min(1, Math.max(0, options.sensitivity ?? 0.5));
  const minGap = Math.max(0, options.minGap ?? 0.05);
  const first = Math.min(total, Math.max(0, Math.round((options.start ?? 0) * sampleRate)));
  const last = Math.min(
    total,
    Math.max(first, Math.round((options.end ?? total / sampleRate) * sampleRate)),
  );
  const hop = Math.max(8, Math.round(sampleRate * 0.0029));
  // What comes just before `start` is read too, so a sound already going there is not an onset.
  const origin = Math.max(0, first - BEHIND * hop);
  const hops = Math.ceil((last - origin) / hop);
  if (hops === 0 || channels.length === 0) return [];

  const scale = 1 / channels.length;
  const sample = (index: number): number => {
    let value = 0;
    for (let c = 0; c < channels.length; c++) value += channels[c]![index]!;
    return value * scale;
  };

  // Running totals of energy per hop: of the signal, and of its sample-to-sample difference, which
  // is the signal with its low frequencies turned down.
  const full = new Float64Array(hops + 1);
  const high = new Float64Array(hops + 1);
  let before = 0;
  for (let k = 0; k < hops; k++) {
    let energy = 0;
    let edges = 0;
    const end = Math.min(last, origin + (k + 1) * hop);
    for (let i = origin + k * hop; i < end; i++) {
      const value = sample(i);
      energy += value * value;
      edges += (value - before) * (value - before);
      before = value;
    }
    full[k + 1] = full[k]! + energy;
    high[k + 1] = high[k]! + edges;
  }

  /** Mean energy per hop of hops `from` up to `to`. Hops before the start are silence. */
  const mean = (sums: Float64Array, from: number, to: number): number =>
    (sums[Math.min(hops, Math.max(0, to))]! - sums[Math.min(hops, Math.max(0, from))]!) /
    (to - from);

  const loudest = (sums: Float64Array): number => {
    let most = 0;
    for (let k = 0; k < hops; k++) most = Math.max(most, mean(sums, k, k + AHEAD));
    return most;
  };
  const jump = 10 ** ((15 - 12 * sensitivity) / 10);
  const gate = 10 ** (-(20 + 40 * sensitivity) / 10);
  const bands = [full, high].map((sums) => ({ sums, loudest: loudest(sums) }));

  const rises = (k: number): boolean =>
    bands.some(({ sums, loudest: most }) => {
      if (most <= 0) return false;
      const ahead = mean(sums, k, k + AHEAD);
      const behind = mean(sums, k - BEHIND, k);
      // The floor keeps near-silence before a hit from making every hit an enormous jump, and
      // noise in near-silence from being one.
      const floor = most * 1e-6;
      return ahead >= most * gate && ahead + floor >= (behind + floor) * jump;
    });

  const peak = (from: number, to: number): number => {
    let most = 0;
    for (let i = Math.max(origin, from); i < Math.min(last, to); i++) {
      most = Math.max(most, Math.abs(sample(i)));
    }
    return most;
  };

  /** The first sample of the hit that hop `k` sees coming: the first to rise above what came before. */
  const refine = (k: number): number => {
    const from = Math.max(first, origin + k * hop);
    const to = Math.min(last, origin + (k + AHEAD) * hop);
    const threshold = Math.max(peak(from - AHEAD * hop, from), 0.2 * peak(from, to));
    for (let i = from; i < to; i++) if (Math.abs(sample(i)) > threshold) return i;
    // Nothing stands out sample by sample (a hit under something louder): the newest hop in view.
    return Math.max(first, Math.min(last - 1, origin + (k + AHEAD - 1) * hop));
  };

  const onsets: number[] = [];
  let next = 0;
  for (let k = 0; k < hops; k++) {
    // Not a hop whose view ends before `start`, nor one inside the gap after the last onset.
    if (origin + (k + AHEAD) * hop <= first || origin + k * hop < next || !rises(k)) continue;
    const frame = refine(k);
    onsets.push(frame / sampleRate);
    // Not again until this hit has left the window, nor within the gap asked for.
    next = Math.max(frame + minGap * sampleRate, frame + (AHEAD + 1) * hop);
  }
  return onsets;
}
