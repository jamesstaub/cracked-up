/**
 * Waveform data for drawing: a sound reduced to a lowest and a highest value per bucket (one bucket
 * per pixel column, usually). Nothing here draws, and nothing needs a page or an audio context.
 */

/** Audio as plain arrays, for code that has no AudioBuffer (a Worker, a test). */
export interface AudioData {
  readonly sampleRate: number;
  /** One array of samples per channel, all the same length. */
  readonly channels: readonly Float32Array[];
}

/** What the audio helpers read: an `AudioBuffer`, anything shaped like one, or plain arrays. */
export type AudioSource =
  | AudioData
  | {
      readonly sampleRate: number;
      readonly length: number;
      readonly numberOfChannels: number;
      getChannelData(channel: number): Float32Array;
    };

/** The channels and sample rate of a source. */
export function audioData(source: AudioSource): AudioData {
  if ('channels' in source) return source;
  const channels: Float32Array[] = [];
  for (let c = 0; c < source.numberOfChannels; c++) channels.push(source.getChannelData(c));
  return { sampleRate: source.sampleRate, channels };
}

export interface WaveformOptions {
  /** How many buckets to reduce the range to: the number of values in each returned array. */
  buckets: number;
  /** Seconds. Default 0. */
  start?: number;
  /** Seconds. Default: the end of the sound. */
  end?: number;
  /** A channel number, or `'mix'` for the average of all channels. Default `'mix'`. */
  channel?: number | 'mix';
  /** Also give the RMS level of each bucket. */
  rms?: boolean;
}

export interface Waveform {
  /** The lowest sample in each bucket. */
  readonly min: Float32Array;
  /** The highest sample in each bucket. */
  readonly max: Float32Array;
  /** The RMS level of each bucket, when asked for. */
  readonly rms?: Float32Array;
  /** The range the buckets cover, in seconds, as asked. */
  readonly start: number;
  readonly end: number;
}

/** One view of a sound: a single channel, or all of them averaged. */
interface View {
  readonly data: readonly Float32Array[];
  readonly length: number;
}

function viewOf(audio: AudioData, channel: number | 'mix'): View {
  const length = audio.channels[0]?.length ?? 0;
  if (channel === 'mix') return { data: audio.channels, length };
  const one = audio.channels[Math.floor(channel)];
  if (!one) throw new RangeError(`The sound has no channel ${String(channel)}.`);
  return { data: [one], length };
}

/** Lowest, highest and sum of squares over the frames from `a` up to `b`. */
interface Reduction {
  min: number;
  max: number;
  squares: number;
}

function reduceRaw(view: View, a: number, b: number, into: Reduction): void {
  let { min, max, squares } = into;
  const data = view.data;
  if (data.length === 1) {
    const x = data[0]!;
    for (let i = a; i < b; i++) {
      const v = x[i]!;
      if (v < min) min = v;
      if (v > max) max = v;
      squares += v * v;
    }
  } else if (data.length === 2) {
    const x = data[0]!;
    const y = data[1]!;
    for (let i = a; i < b; i++) {
      const v = (x[i]! + y[i]!) * 0.5;
      if (v < min) min = v;
      if (v > max) max = v;
      squares += v * v;
    }
  } else {
    const scale = 1 / data.length;
    for (let i = a; i < b; i++) {
      let v = 0;
      for (let c = 0; c < data.length; c++) v += data[c]![i]!;
      v *= scale;
      if (v < min) min = v;
      if (v > max) max = v;
      squares += v * v;
    }
  }
  into.min = min;
  into.max = max;
  into.squares = squares;
}

/** The frames bucket `index` of `count` covers: at least one, so a zoomed-in line has no gaps. */
function bucketFrames(first: number, last: number, index: number, count: number): [number, number] {
  const a = Math.floor(first + ((last - first) * index) / count);
  const b = Math.floor(first + ((last - first) * (index + 1)) / count);
  return [a, b > a ? b : a + 1];
}

function reduce(
  audio: AudioData,
  options: WaveformOptions,
  range: (view: View, a: number, b: number, into: Reduction) => void,
  view: View,
): Waveform {
  const buckets = Math.max(0, Math.floor(options.buckets));
  const duration = view.length / audio.sampleRate;
  const start = options.start ?? 0;
  const end = options.end ?? duration;
  const min = new Float32Array(buckets);
  const max = new Float32Array(buckets);
  const rms = options.rms ? new Float32Array(buckets) : undefined;
  const first = start * audio.sampleRate;
  const last = end * audio.sampleRate;
  const result: Reduction = { min: 0, max: 0, squares: 0 };
  if (last > first) {
    for (let i = 0; i < buckets; i++) {
      const [from, to] = bucketFrames(first, last, i, buckets);
      const a = Math.max(0, from);
      const b = Math.min(view.length, to);
      // A bucket outside the sound is silence.
      if (b <= a) continue;
      result.min = Infinity;
      result.max = -Infinity;
      result.squares = 0;
      range(view, a, b, result);
      min[i] = result.min;
      max[i] = result.max;
      if (rms) rms[i] = Math.sqrt(result.squares / (b - a));
    }
  }
  return { min, max, ...(rms ? { rms } : {}), start, end };
}

/**
 * Reduces a sound, or a range of it, to the lowest and highest sample in each of `buckets` equal
 * parts, for drawing a waveform: one bucket per pixel column, a line from `min` to `max`.
 *
 * Every sample in the range is read once, so the time taken grows with the length of the range
 * (times the number of channels for `'mix'`) and not with the number of buckets. For a long sound
 * that is redrawn often, as on zoom and scroll, use `createWaveformCache`, which gives the same
 * numbers faster.
 *
 * A range that reaches outside the sound gives 0 for the buckets outside. When there are more
 * buckets than samples, neighbouring buckets repeat a sample.
 */
export function waveformPeaks(source: AudioSource, options: WaveformOptions): Waveform {
  const audio = audioData(source);
  return reduce(audio, options, reduceRaw, viewOf(audio, options.channel ?? 'mix'));
}

/** One level of a cache: the reduction of every block of `size` frames. */
interface Level {
  readonly size: number;
  readonly min: Float32Array;
  readonly max: Float32Array;
  readonly squares: Float64Array;
}

function buildLevels(view: View, blockSize: number): Level[] {
  const count = Math.ceil(view.length / blockSize);
  const base: Level = {
    size: blockSize,
    min: new Float32Array(count),
    max: new Float32Array(count),
    squares: new Float64Array(count),
  };
  const result: Reduction = { min: 0, max: 0, squares: 0 };
  for (let block = 0; block < count; block++) {
    result.min = Infinity;
    result.max = -Infinity;
    result.squares = 0;
    reduceRaw(view, block * blockSize, Math.min(view.length, (block + 1) * blockSize), result);
    base.min[block] = result.min;
    base.max[block] = result.max;
    base.squares[block] = result.squares;
  }
  const levels = [base];
  for (let below = base; below.min.length > 1;) {
    const length = Math.ceil(below.min.length / 2);
    const level: Level = {
      size: below.size * 2,
      min: new Float32Array(length),
      max: new Float32Array(length),
      squares: new Float64Array(length),
    };
    for (let i = 0; i < length; i++) {
      const left = 2 * i;
      const right = Math.min(left + 1, below.min.length - 1);
      level.min[i] = Math.min(below.min[left]!, below.min[right]!);
      level.max[i] = Math.max(below.max[left]!, below.max[right]!);
      level.squares[i] = below.squares[left]! + (right > left ? below.squares[right]! : 0);
    }
    levels.push(level);
    below = level;
  }
  return levels;
}

export interface WaveformCache {
  /** The same result as `waveformPeaks` on the sound the cache was made from. */
  peaks(options: WaveformOptions): Waveform;
}

/**
 * Prepares a sound for being drawn again and again at different zooms. `peaks()` gives what
 * `waveformPeaks` gives (the same lowest and highest values exactly; RMS to within rounding), in a
 * time that grows with the number of buckets and hardly at all with the length of the sound.
 *
 * It keeps the reduction of every block of `blockSize` frames, then of every two blocks, every
 * four, and so on. A bucket is put together from the largest blocks that fit inside it, and from
 * the samples themselves at its two ends, so at most `2 * blockSize` samples are read per bucket.
 * The levels for a channel (or for the mix) are made the first time it is asked for: one pass over
 * the sound. They take about `24 / blockSize` bytes per frame: 1.3 MB for five minutes at 48 kHz.
 *
 * The cache does not notice the samples changing. Make a new one when the sound does (the buffer
 * store's `ready` event says when).
 */
export function createWaveformCache(
  source: AudioSource,
  options: { blockSize?: number } = {},
): WaveformCache {
  const audio = audioData(source);
  const blockSize = Math.max(16, Math.floor(options.blockSize ?? 256));
  const built = new Map<number | 'mix', { view: View; levels: Level[] }>();

  return {
    peaks(request) {
      const channel = request.channel ?? 'mix';
      let entry = built.get(channel);
      if (!entry) {
        const view = viewOf(audio, channel);
        entry = { view, levels: buildLevels(view, blockSize) };
        built.set(channel, entry);
      }
      const levels = entry.levels;
      const range = (view: View, a: number, b: number, into: Reduction): void => {
        let p = a;
        while (p < b) {
          if (p % blockSize !== 0 || p + blockSize > b) {
            // Not on a block, or less than a block left: read samples up to the next block or the end.
            const next = Math.min(b, (Math.floor(p / blockSize) + 1) * blockSize);
            reduceRaw(view, p, next, into);
            p = next;
            continue;
          }
          // The largest block that starts here and ends inside the range.
          let k = 0;
          while (
            k + 1 < levels.length &&
            p % levels[k + 1]!.size === 0 &&
            p + levels[k + 1]!.size <= b
          ) {
            k++;
          }
          const level = levels[k]!;
          const index = p / level.size;
          if (level.min[index]! < into.min) into.min = level.min[index]!;
          if (level.max[index]! > into.max) into.max = level.max[index]!;
          into.squares += level.squares[index]!;
          p += level.size;
        }
      };
      return reduce(audio, request, range, entry.view);
    },
  };
}
