export function rms(buffer: AudioBuffer, channel = 0, startSample = 0, endSample?: number): number {
  const data = buffer.getChannelData(channel);
  const end = Math.min(endSample ?? data.length, data.length);
  if (end <= startSample) return 0;
  let sum = 0;
  for (let i = startSample; i < end; i++) {
    const v = data[i] ?? 0;
    sum += v * v;
  }
  return Math.sqrt(sum / (end - startSample));
}

export function peak(buffer: AudioBuffer, channel = 0): number {
  const data = buffer.getChannelData(channel);
  let max = 0;
  for (let i = 0; i < data.length; i++) max = Math.max(max, Math.abs(data[i] ?? 0));
  return max;
}

export interface OnsetOptions {
  threshold: number;
  minGapSamples: number;
  channel?: number;
}

/**
 * Sample indices where |signal| first reaches `threshold` after having been below it
 * for at least `minGapSamples` (the start of the buffer counts as a gap).
 */
export function findOnsets(
  buffer: AudioBuffer,
  { threshold, minGapSamples, channel = 0 }: OnsetOptions,
): number[] {
  const data = buffer.getChannelData(channel);
  const onsets: number[] = [];
  let below = minGapSamples;
  for (let i = 0; i < data.length; i++) {
    if (Math.abs(data[i] ?? 0) >= threshold) {
      if (below >= minGapSamples) onsets.push(i);
      below = 0;
    } else {
      below++;
    }
  }
  return onsets;
}

/** Estimate the dominant frequency in Hz from rising zero crossings (suits simple tones). */
export function dominantFrequency(buffer: AudioBuffer, channel = 0): number {
  const data = buffer.getChannelData(channel);
  let first = -1;
  let last = -1;
  let count = 0;
  for (let i = 1; i < data.length; i++) {
    const a = data[i - 1] ?? 0;
    const b = data[i] ?? 0;
    if (a < 0 && b >= 0) {
      const pos = i - 1 + -a / (b - a); // linear interpolation for sub-sample accuracy
      if (first < 0) first = pos;
      last = pos;
      count++;
    }
  }
  if (count < 2) return 0;
  return ((count - 1) * buffer.sampleRate) / (last - first);
}
