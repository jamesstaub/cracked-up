/**
 * Listening taps: one `AnalyserNode` per output being metered.
 *
 * A tap is a connection from an output to an analyser that leads nowhere. It adds nothing to the
 * signal path, so it cannot change the sound or delay it, and the analyser's only work on the audio
 * thread is copying samples into a buffer. An analyser was chosen over one shared worklet because it
 * needs no module loading, works the same in every browser and on any context, and reading it costs
 * one copy per tap per frame; a worklet would save little and would post its readings late.
 *
 * Taps exist only while something asks for them: `sync` is told which outputs are wanted now, makes
 * the missing taps, and removes the ones nobody has wanted for a moment.
 */

/** Seconds an unwanted tap is kept, so panning about does not make and remove taps continuously. */
const LINGER_SECONDS = 1;

interface Tap {
  source: AudioNode;
  analyser: AnalyserNode;
  /** Seconds since it was last wanted. */
  idle: number;
}

export class TapSet {
  private taps = new Map<string, Tap>();
  private buffer: Float32Array<ArrayBuffer>;

  /**
   * @param size samples per reading: a power of two. 1024 is 21 ms at 48 kHz, longer than a frame at
   * 60 per second, so consecutive readings leave no gap and no peak is missed.
   */
  constructor(
    private context: BaseAudioContext,
    readonly size = 1024,
    /** The analysers' own smoothing of their spectrum, 0 to 1. It does not affect the samples read. */
    private smoothing = 0,
  ) {
    this.buffer = new Float32Array(size);
  }

  get count(): number {
    return this.taps.size;
  }

  has(key: string): boolean {
    return this.taps.has(key);
  }

  /**
   * Makes the set match `wanted` (key to the output to listen to). A key whose output is a different
   * node than before is moved: bypassing a node for the first time gives it a new output.
   */
  sync(wanted: ReadonlyMap<string, AudioNode>, dt: number): void {
    for (const [key, tap] of this.taps) {
      const source = wanted.get(key);
      if (source === undefined) {
        tap.idle += dt;
        if (tap.idle > LINGER_SECONDS) this.remove(key);
      } else if (source !== tap.source) {
        this.remove(key);
      } else {
        tap.idle = 0;
      }
    }
    for (const [key, source] of wanted) {
      if (this.taps.has(key)) continue;
      const analyser = new AnalyserNode(this.context, {
        fftSize: this.size,
        smoothingTimeConstant: this.smoothing,
      });
      source.connect(analyser);
      this.taps.set(key, { source, analyser, idle: 0 });
    }
  }

  /**
   * The newest samples at a tap, all channels mixed to one, or null if there is no such tap. The
   * array is reused by the next call.
   */
  read(key: string): Float32Array | null {
    const tap = this.taps.get(key);
    if (!tap) return null;
    tap.analyser.getFloatTimeDomainData(this.buffer);
    return this.buffer;
  }

  /** The analyser at a tap, for a caller that wants its spectrum. */
  analyser(key: string): AnalyserNode | null {
    return this.taps.get(key)?.analyser ?? null;
  }

  remove(key: string): void {
    const tap = this.taps.get(key);
    if (!tap) return;
    this.taps.delete(key);
    try {
      tap.source.disconnect(tap.analyser);
    } catch {
      // The node was disposed, which already removed every connection from it.
    }
  }

  clear(): void {
    for (const key of [...this.taps.keys()]) this.remove(key);
  }
}
