/** What a clock follower steers. The MIDI module gives it the engine's transport. */
export interface FollowTarget {
  readonly state: 'stopped' | 'started' | 'paused';
  /** The transport's position in beats at an audio time. */
  toBeats(time: number): number;
  /** Sets the tempo. */
  drive(bpm: number): void;
  /** Starts at an audio time, from a position in beats or from where it was paused. */
  start(at: number, from?: number): void;
  pause(at: number): void;
  seek(beats: number): void;
}

export interface FollowOptions {
  /**
   * How firmly the transport is pulled back when it drifts from the incoming clock. 1 closes a gap in
   * about a beat. Lower is smoother and slower. Default 1.
   */
  pull?: number;
  /** How many pulses the tempo is averaged over. 24 is one beat. Default 24. */
  window?: number;
}

const PULSES_PER_BEAT = 24;
/** The transport is nudged this many times per beat. */
const STEER_EVERY = 3;
/** A gap bigger than this, in beats, is jumped rather than chased. */
const JUMP = 0.25;

/**
 * Follows MIDI clock: measures the tempo from the spacing of the pulses and keeps the transport's
 * position on the pulse count.
 *
 * Pulses arrive with a little timing noise. The tempo is therefore taken from the average spacing over
 * a window of pulses, and position is corrected gently, by running the transport slightly fast or slow
 * until it is back on the count, so the music does not jump.
 */
export class ClockFollower {
  /** The measured tempo, or null until enough pulses have arrived. */
  bpm: number | null = null;
  /** The latest gap between where the transport is and where the clock says, in beats, smoothed. */
  error = 0;

  private times: number[] = [];
  /** Position of the pulse that `count` is counted from; null until locked. */
  private origin: number | null = null;
  private count = 0;
  /** Set by `start` and `continue`: the next pulse starts the transport. */
  private pending: { from: number | undefined } | null = null;
  private readonly pull: number;
  private readonly window: number;

  constructor(
    private target: FollowTarget,
    options: FollowOptions = {},
  ) {
    this.pull = options.pull ?? 1;
    this.window = Math.max(2, Math.round(options.window ?? PULSES_PER_BEAT));
  }

  /** MIDI Start: play from the beginning, beginning on the next pulse. */
  start(): void {
    this.pending = { from: 0 };
  }

  /** MIDI Continue: play on from where it stopped, beginning on the next pulse. */
  continue(): void {
    this.pending = { from: undefined };
  }

  /** MIDI Stop. The position is kept, so a Continue can resume. */
  stop(time: number): void {
    this.pending = null;
    this.origin = null;
    if (this.target.state === 'started') this.target.pause(time);
  }

  /** MIDI Song Position: where the next Continue resumes. */
  songPosition(beats: number): void {
    if (this.target.state !== 'started') this.target.seek(beats);
  }

  /** One of the 24 pulses per quarter note, with the audio time at which it arrived. */
  pulse(time: number): void {
    this.times.push(time);
    if (this.times.length > this.window + 1) this.times.shift();
    if (this.times.length >= 3) {
      const span = time - this.times[0]!;
      if (span > 0) this.bpm = 60 / ((PULSES_PER_BEAT * span) / (this.times.length - 1));
    }

    if (this.pending) {
      // The pulse after Start is the downbeat.
      const from = this.pending.from;
      this.pending = null;
      if (this.bpm !== null) this.target.drive(this.bpm);
      if (this.target.state !== 'started') {
        this.target.start(time, from);
        this.origin = this.target.toBeats(time);
      } else if (from !== undefined) {
        // Already playing, started by hand: Start still means "this pulse is the beginning".
        this.target.seek(from);
        this.origin = from;
      } else {
        // Continue while playing: carry on from here, in step with the pulses.
        this.origin = this.target.toBeats(time);
      }
      this.count = 0;
      this.error = 0;
      return;
    }

    // Every pulse counts, including those that arrive before the tempo is known.
    if (this.origin !== null) this.count++;
    if (this.bpm === null) return;
    if (this.target.state !== 'started') {
      // Not playing: just keep the tempo ready.
      this.target.drive(this.bpm);
      return;
    }
    if (this.origin === null) {
      // Joined a clock that was already running: lock to the nearest pulse.
      const position = this.target.toBeats(time);
      // A pulse from before the transport's own start has no place in it yet: wait for the next.
      if (position < 0) return;
      this.origin = Math.round(position * PULSES_PER_BEAT) / PULSES_PER_BEAT;
      this.count = 0;
      this.error = 0;
    }

    const expected = this.origin + this.count / PULSES_PER_BEAT;
    const gap = expected - this.target.toBeats(time);
    if (Math.abs(gap) > JUMP) {
      this.target.seek(Math.max(0, expected));
      this.target.drive(this.bpm);
      this.error = 0;
      return;
    }
    this.error += 0.25 * (gap - this.error);
    if (this.count % STEER_EVERY !== 0) return;
    const nudge = Math.min(0.1, Math.max(-0.1, this.error * this.pull));
    this.target.drive(this.bpm * (1 + nudge));
  }
}
