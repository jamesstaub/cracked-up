/**
 * Transport and scheduling.
 *
 * The scheduler looks a short way ahead in musical time and calls each callback before its event is
 * due, passing the exact audio-clock time at which it should sound. Callbacks schedule audio at that
 * time, so timing is sample-accurate anywhere in a bar, not only on a step grid.
 *
 * There is one transport per engine, and every sequence belongs to it. All sequences read its one
 * position. Different step lengths and pattern lengths therefore
 * stay phase-locked, and a sequence added or replaced while playing takes its place from the position.
 */

import type { Unsubscribe } from './params';

/**
 * A musical length.
 * - number: beats (quarter notes). 0.25 is a sixteenth.
 * - '1/16', '1/8', '3/16': a fraction of a whole note.
 * - '1/8t': triplet (two thirds of the plain value). '1/8d': dotted (one and a half).
 * - '1 bar', '2 bars': bars in the current time signature.
 */
export type Duration =
  | number
  | `${number}/${number}`
  | `${number}/${number}t`
  | `${number}/${number}d`
  | `${number} bar`
  | `${number} bars`;

/** A musical position from the start of the transport. Same forms as Duration. */
export type Position = Duration;

/**
 * Steps of a sequence. 0 is a rest; any other number is a hit and is passed to the callback.
 * A string is shorthand: `'x..x..x.'` (x = 1, . = 0) or space-separated numbers `'1 0 0 2'`.
 */
export type Pattern = readonly number[] | string;

export interface SequenceOptions {
  /** The pattern, or a step count for an unvalued pulse (every step has value 1). */
  steps: Pattern | number;
  /** Length of one step. Default: the transport's `stepLength`. Give this or `span`, not both. */
  step?: Duration;
  /** Total length the steps are spread evenly across: `{ steps: 5, span: '1 bar' }` is five in a bar. */
  span?: Duration;
  /** 0.5 is straight; above 0.5 delays every second step. Default: the transport's swing. */
  swing?: number;
  /** Shifts the whole sequence later. */
  offset?: Duration;
  /** Chance from 0 to 1 that a non-rest step fires. Drawn from the engine's seeded random source. */
  probability?: number;
  /** Callbacks due at the same time run in ascending order. Default 0. */
  order?: number;
  /** Whether the callback is also called for rests (value 0). Default true. */
  rests?: boolean;
}

/** What a sequence callback receives. */
export interface SequenceEvent {
  /** Audio-clock time at which this step sounds. Pass to `at`, or omit `at` inside the callback. */
  readonly time: number;
  /** Seconds this step lasts, after swing. */
  readonly duration: number;
  /** Position in beats from the start of the transport. */
  readonly beat: number;
  /** Zero-based bar number. */
  readonly bar: number;
  readonly index: number;
  readonly value: number;
  readonly steps: readonly number[];
  /** How many times the sequence has wrapped. */
  readonly cycle: number;
  readonly sequence: Sequence;
  /** Audio time part-way through this step: `ev.at(0.5)` is halfway. For ratchets, flams and nudges. */
  at(fraction: number): number;
}

export type SequenceCallback = (event: SequenceEvent) => void;

/** The Cracked-style step callback used by `transport.steps`. */
export type StepCallback = (
  index: number,
  value: number,
  steps: readonly number[],
  event: SequenceEvent,
) => void;

export interface Sequence {
  readonly name: string | null;
  /** The current steps. Writing through `setStep` or `update` takes effect from the next step. */
  readonly steps: readonly number[];
  readonly options: Readonly<SequenceOptions>;
  muted: boolean;
  setStep(index: number, value: number): this;
  /** Changes options or the pattern in place, keeping phase with the transport. */
  update(options: Partial<SequenceOptions>): this;
  /** Restarts the pattern from its first step at the next step boundary. */
  restart(): this;
  stop(): void;
}

export interface ScheduledEvent {
  readonly time: number;
  readonly beat: number;
  readonly bar: number;
}

export interface TransportPosition {
  readonly beats: number;
  readonly bar: number;
  /** Beat within the bar, fractional. */
  readonly beatInBar: number;
  readonly seconds: number;
}

/**
 * Where the transport's sense of time comes from. The default follows the audio clock at the
 * transport's own tempo. A MIDI clock source (later phase) follows external pulses.
 */
export interface ClockSource {
  readonly kind: 'internal' | 'external';
  /** External sources report the tempo they measure; the transport's `bpm` becomes read-only. */
  readonly bpm: number | null;
}

export interface TransportEvents {
  start: (event: ScheduledEvent) => void;
  stop: (event: ScheduledEvent) => void;
  tempo: (bpm: number) => void;
  /** The scheduler fell behind by more than the look-ahead and skipped events it could not play on time. */
  late: (info: { skipped: number; behindBy: number }) => void;
}

export interface Transport {
  bpm: number;
  /** Default swing for sequences that do not set their own. 0.5 is straight. */
  swing: number;
  /** [beats per bar, beat unit], e.g. [4, 4]. */
  timeSignature: readonly [number, number];
  /** Default step length for sequences and `steps()`. Default '1/16'. */
  stepLength: Duration;

  readonly state: 'stopped' | 'started' | 'paused';
  readonly position: TransportPosition;

  start(options?: { at?: number; from?: Position }): this;
  /** Stops and returns to the start. */
  stop(options?: { at?: number }): this;
  /** Stops and keeps the position. */
  pause(options?: { at?: number }): this;
  seek(position: Position): this;
  /** Loops a region of the transport. null plays on without looping. */
  loop: { start: Position; end: Position } | null;

  /**
   * Adds a sequence. With a name, a later call with the same name replaces the earlier sequence in
   * place and in phase, which is how live code is re-evaluated.
   */
  sequence(options: SequenceOptions, callback: SequenceCallback): Sequence;
  sequence(name: string, options: SequenceOptions, callback: SequenceCallback): Sequence;

  /** Shorthand for a sequence at the default step length with a `(index, value, steps)` callback. */
  steps(pattern: Pattern, callback: StepCallback): Sequence;
  steps(name: string, pattern: Pattern, callback: StepCallback): Sequence;

  /** Calls back once at a position. */
  at(position: Position, callback: (event: ScheduledEvent) => void): Unsubscribe;
  /** Calls back repeatedly. */
  every(
    interval: Duration,
    callback: (event: ScheduledEvent) => void,
    options?: { offset?: Duration; order?: number },
  ): Unsubscribe;

  /** Looks up a named sequence. */
  get(name: string): Sequence | undefined;
  /** Removes one named sequence, or everything scheduled on the transport. */
  clear(name?: string): this;

  /**
   * Calls back on an animation frame at the moment each sequence event is heard. Use this, never the
   * sequence callback, to move playheads: sequence callbacks run ahead of the sound.
   */
  onDisplay(listener: (event: SequenceEvent) => void): Unsubscribe;

  /** Conversions through the tempo map. */
  toAudioTime(position: Position): number;
  toBeats(audioTime: number): number;
  /** Seconds a duration lasts at the current tempo. */
  seconds(duration: Duration): number;

  clock: ClockSource;

  /** How far ahead callbacks run, and how often the scheduler wakes. Seconds. Defaults 0.1 and 0.025. */
  lookahead: number;
  interval: number;

  on<E extends keyof TransportEvents>(event: E, listener: TransportEvents[E]): Unsubscribe;
}
