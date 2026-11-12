import type {
  ClockSource,
  Duration,
  Pattern,
  Position,
  ScheduledEvent,
  Sequence,
  SequenceCallback,
  SequenceEvent,
  SequenceOptions,
  StepCallback,
  TransportEvents,
  TransportPosition,
  Unsubscribe,
} from '../api';
import { durationToBeats } from '../util/duration';
import { parsePattern } from '../util/pattern';
import type { EngineImpl } from './engine';
import { CrackedUpError, Emitter } from './errors';

/** Tolerance, in beats, for treating two positions as the same. Far below one sample at any tempo. */
const EPSILON = 1e-9;
/** Live only: an event this many seconds in the past is still played; anything older is skipped. */
const LATE_GRACE = 0.02;
/** Live only: how far ahead of "now" playback begins, so the first events are not already late. */
const START_DELAY = 0.05;

function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

/**
 * Something that produces events at positions on the transport. The scheduler repeatedly asks every
 * source for its next position and fires the earliest.
 */
interface Source {
  readonly order: number;
  readonly serial: number;
  /** Position in beats of the next event, or null when there is none. */
  peek(): number | null;
  /** Re-arms so the next event is the first at or after the position. */
  reset(position: number): void;
  /** Delivers the event at `peek()` and moves on to the following one. */
  fire(time: number, position: number, secondsPerBeat: number): void;
  /** Moves on without delivering (the event was too late to play). */
  skip(): void;
}

// ---------------------------------------------------------------------------------------------------
// Sequences
// ---------------------------------------------------------------------------------------------------

class SequenceImpl implements Source {
  readonly serial: number;
  name: string | null;
  muted = false;

  private raw: SequenceOptions;
  private callback: SequenceCallback;
  private values: number[] = [];
  private stepBeats = 0.25;
  private offsetBeats = 0;
  /** The step number to fire next. Step n sits at `positionOf(n)`, so phase always follows the transport. */
  private next = 0;
  /** How far after the sequence's offset the pattern's first step was last (re)started, in beats. */
  private originBeats = 0;
  private restartPending = false;
  /** Position of the step delivered most recently, so a change made at that moment does not repeat it. */
  private lastFired: number | null = null;

  constructor(
    private transport: TransportImpl,
    serial: number,
    name: string | null,
    options: SequenceOptions,
    callback: SequenceCallback,
  ) {
    this.serial = serial;
    this.name = name;
    this.raw = { ...options };
    this.callback = callback;
    this.layout();
  }

  get order(): number {
    return this.raw.order ?? 0;
  }

  get steps(): readonly number[] {
    return this.values;
  }

  get options(): Readonly<SequenceOptions> {
    return this.raw;
  }

  /** Works out the pattern and step length from the options and the transport's current settings. */
  layout(): void {
    const { steps, step, span } = this.raw;
    if (typeof steps === 'number') {
      if (!Number.isInteger(steps) || steps < 1) {
        throw new RangeError(
          'A sequence needs at least one step: "steps" must be a whole number above 0.',
        );
      }
      this.values = new Array<number>(steps).fill(1);
    } else {
      this.values = parsePattern(steps);
    }
    if (step !== undefined && span !== undefined) {
      throw new RangeError('Give a sequence either "step" or "span", not both.');
    }
    const signature = this.transport.timeSignature;
    this.stepBeats =
      span !== undefined
        ? durationToBeats(span, signature) / this.values.length
        : durationToBeats(step ?? this.transport.stepLength, signature);
    if (!(this.stepBeats > 1e-6)) throw new RangeError('A sequence step must be longer than zero.');
    this.offsetBeats =
      this.raw.offset === undefined ? 0 : durationToBeats(this.raw.offset, signature);
    const swing = this.raw.swing;
    if (swing !== undefined && !(swing > 0 && swing < 1)) {
      throw new RangeError('Swing must be between 0 and 1; 0.5 is straight.');
    }
  }

  /** Replaces the options and callback, as a named sequence does when its code is evaluated again. */
  replace(options: SequenceOptions, callback: SequenceCallback): void {
    const previous = this.raw;
    this.raw = { ...options };
    try {
      this.layout();
    } catch (error) {
      this.raw = previous;
      this.layout();
      throw error;
    }
    this.callback = callback;
  }

  private swing(): number {
    return this.raw.swing ?? this.transport.swing;
  }

  /** Where step n falls, in beats. Swing delays every second step. */
  private positionOf(n: number): number {
    const swung = n % 2 === 1 ? (2 * this.swing() - 1) * this.stepBeats : 0;
    return this.offsetBeats + n * this.stepBeats + swung;
  }

  peek(): number | null {
    return this.positionOf(this.next);
  }

  reset(position: number): void {
    let n = Math.max(0, Math.floor((position - this.offsetBeats) / this.stepBeats) - 1);
    while (this.positionOf(n) < position - EPSILON) n++;
    this.next = n;
    this.lastFired = null;
  }

  /**
   * Re-arms after the sequence itself was changed (replaced or updated). Unlike a plain reset, a step
   * this sequence has already delivered at the current position is not delivered a second time.
   */
  rearm(position: number): void {
    const delivered = this.lastFired;
    this.reset(position);
    if (delivered !== null && Math.abs(this.positionOf(this.next) - delivered) <= EPSILON)
      this.next++;
    this.lastFired = delivered;
  }

  skip(): void {
    this.next++;
  }

  fire(time: number, position: number, secondsPerBeat: number): void {
    const n = this.next++;
    this.lastFired = position;
    if (this.restartPending) {
      this.originBeats = n * this.stepBeats;
      this.restartPending = false;
    }
    const originStep = Math.round(this.originBeats / this.stepBeats);
    const relative = n - originStep;
    const length = this.values.length;
    const index = mod(relative, length);
    const value = this.values[index] ?? 0;

    if (this.muted) return;
    if (value === 0 && this.raw.rests === false) return;
    const probability = this.raw.probability;
    if (value !== 0 && probability !== undefined && probability < 1) {
      if (!this.transport.engine.random.chance(probability)) return;
    }

    const duration = (this.positionOf(n + 1) - this.positionOf(n)) * secondsPerBeat;
    const event: SequenceEvent = {
      time,
      duration,
      beat: position,
      bar: this.transport.barOf(position),
      index,
      value,
      steps: this.values,
      cycle: Math.floor(relative / length),
      sequence: this as unknown as Sequence,
      at: (fraction: number) => time + fraction * duration,
    };
    this.transport.deliver(event, this.callback);
  }

  setStep(index: number, value: number): this {
    if (!Number.isFinite(value)) throw new RangeError('A step value must be a finite number.');
    this.values[mod(Math.trunc(index), this.values.length)] = value;
    return this;
  }

  update(options: Partial<SequenceOptions>): this {
    this.replace({ ...this.raw, ...options }, this.callback);
    this.rearm(this.transport.armPosition());
    return this;
  }

  restart(): this {
    this.restartPending = true;
    return this;
  }

  stop(): void {
    this.transport.remove(this);
  }
}

/** A single callback at one position. */
class OneShot implements Source {
  readonly order = 0;
  private armed = false;
  private fired = false;

  constructor(
    private transport: TransportImpl,
    readonly serial: number,
    private position: number,
    private callback: (event: ScheduledEvent) => void,
  ) {}

  peek(): number | null {
    return this.armed && !this.fired ? this.position : null;
  }

  reset(position: number): void {
    this.armed = this.position >= position - EPSILON;
  }

  skip(): void {
    this.fired = true;
    this.transport.remove(this);
  }

  fire(time: number, position: number): void {
    this.fired = true;
    this.transport.remove(this);
    this.transport.deliver(
      { time, beat: position, bar: this.transport.barOf(position) },
      this.callback,
    );
  }
}

/** A callback repeated at a fixed interval. */
class Repeater implements Source {
  private next = 0;

  constructor(
    private transport: TransportImpl,
    readonly serial: number,
    private interval: number,
    private offset: number,
    readonly order: number,
    private callback: (event: ScheduledEvent) => void,
  ) {}

  peek(): number | null {
    return this.offset + this.next * this.interval;
  }

  reset(position: number): void {
    this.next = Math.max(0, Math.ceil((position - this.offset) / this.interval - EPSILON));
  }

  skip(): void {
    this.next++;
  }

  fire(time: number, position: number): void {
    this.next++;
    this.transport.deliver(
      { time, beat: position, bar: this.transport.barOf(position) },
      this.callback,
    );
  }
}

// ---------------------------------------------------------------------------------------------------
// The timer that wakes the scheduler
// ---------------------------------------------------------------------------------------------------

/**
 * Calls back at a steady interval. The timer runs in a Worker because browsers slow timers down in
 * background tabs on the main thread; where a Worker cannot be created it falls back to a plain timer.
 */
class Ticker {
  private worker: Worker | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  start(seconds: number, callback: () => void): void {
    this.stop();
    const ms = Math.max(1, seconds * 1000);
    const fallback = () => {
      this.worker?.terminate();
      this.worker = null;
      this.timer ??= setInterval(callback, ms);
    };
    try {
      const source = `let id;onmessage=(e)=>{clearInterval(id);if(e.data>0)id=setInterval(()=>postMessage(0),e.data);};`;
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      const worker = new Worker(url);
      URL.revokeObjectURL(url);
      worker.onmessage = callback;
      // A content security policy that forbids blob workers reports the failure asynchronously.
      worker.onerror = fallback;
      worker.postMessage(ms);
      this.worker = worker;
    } catch {
      fallback();
    }
  }

  stop(): void {
    this.worker?.terminate();
    this.worker = null;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
}

// ---------------------------------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------------------------------

/** A stretch of time over which position advances at one tempo. */
interface Segment {
  position: number;
  time: number;
  secondsPerBeat: number;
}

export class TransportImpl {
  readonly engine: EngineImpl;

  lookahead = 0.1;

  private tempo = 120;
  private swingAmount = 0.5;
  private signature: readonly [number, number] = [4, 4];
  private defaultStep: Duration = '1/16';
  private loopRegion: { start: Position; end: Position } | null = null;
  private wakeInterval = 0.025;

  private playState: 'stopped' | 'started' | 'paused' = 'stopped';
  /** Tempo segments, oldest first. The last one is what scheduling uses. */
  private segments: Segment[] = [{ position: 0, time: 0, secondsPerBeat: 0.5 }];
  /** Where playback resumes from while not started. */
  private restPosition = 0;
  /** Everything before this position has been handed to callbacks. */
  private processed = 0;
  private processing = false;

  private sources: Source[] = [];
  private named = new Map<string, SequenceImpl>();
  private serial = 0;

  private ticker = new Ticker();
  private events = new Emitter<TransportEvents>();
  private displayListeners = new Set<(event: SequenceEvent) => void>();
  private displayQueue: SequenceEvent[] = [];
  private frame: number | null = null;

  constructor(engine: EngineImpl) {
    this.engine = engine;
  }

  // --- Settings -----------------------------------------------------------------------------------

  get bpm(): number {
    return this.tempo;
  }

  set bpm(value: number) {
    if (!(value > 0) || !Number.isFinite(value))
      throw new RangeError('bpm must be a number above 0.');
    if (value === this.tempo) return;
    this.tempo = value;
    if (this.playState === 'started') {
      // Events already handed out keep their times; the new tempo applies from the next one on.
      this.pushSegment(this.processed, this.timeAt(this.processed));
    }
    this.events.emit('tempo', value);
  }

  get swing(): number {
    return this.swingAmount;
  }

  set swing(value: number) {
    if (!(value > 0 && value < 1))
      throw new RangeError('Swing must be between 0 and 1; 0.5 is straight.');
    this.swingAmount = value;
    this.rearm();
  }

  get timeSignature(): readonly [number, number] {
    return this.signature;
  }

  set timeSignature(value: readonly [number, number]) {
    if (!(value[0] > 0) || !(value[1] > 0))
      throw new RangeError('A time signature needs two numbers above 0.');
    this.signature = [value[0], value[1]];
    this.relayout();
  }

  get stepLength(): Duration {
    return this.defaultStep;
  }

  set stepLength(value: Duration) {
    this.beats(value);
    this.defaultStep = value;
    this.relayout();
  }

  get loop(): { start: Position; end: Position } | null {
    return this.loopRegion;
  }

  set loop(region: { start: Position; end: Position } | null) {
    if (region && !(this.beats(region.end) - this.beats(region.start) > 1e-6)) {
      throw new RangeError('A loop must end after it starts.');
    }
    this.loopRegion = region ? { ...region } : null;
  }

  get interval(): number {
    return this.wakeInterval;
  }

  set interval(seconds: number) {
    if (!(seconds > 0)) throw new RangeError('The scheduler interval must be above 0 seconds.');
    this.wakeInterval = seconds;
    if (this.playState === 'started' && !this.engine.offline) {
      this.ticker.start(seconds, () => this.tick());
    }
  }

  get clock(): ClockSource {
    return { kind: 'internal', bpm: null };
  }

  set clock(source: ClockSource) {
    if (source.kind !== 'internal') {
      throw new CrackedUpError('unsupported', 'External clock sources arrive with MIDI support.');
    }
  }

  // --- Position and conversions -------------------------------------------------------------------

  private beats(duration: Duration): number {
    return durationToBeats(duration, this.signature);
  }

  private get secondsPerBeat(): number {
    return 60 / this.tempo;
  }

  private get segment(): Segment {
    return this.segments[this.segments.length - 1]!;
  }

  private timeAt(position: number): number {
    const segment = this.segment;
    return segment.time + (position - segment.position) * segment.secondsPerBeat;
  }

  private positionAt(time: number): number {
    const segment = this.segment;
    return segment.position + (time - segment.time) / segment.secondsPerBeat;
  }

  private pushSegment(position: number, time: number): void {
    this.segments.push({ position, time, secondsPerBeat: this.secondsPerBeat });
    // Keep only what is needed to answer "where are we now": the segment in force and any after it.
    const now = this.engine.now();
    while (this.segments.length > 1 && this.segments[1]!.time <= now) this.segments.shift();
  }

  barOf(position: number): number {
    return Math.floor(position / ((this.signature[0] * 4) / this.signature[1]) + EPSILON);
  }

  get state(): 'stopped' | 'started' | 'paused' {
    return this.playState;
  }

  get position(): TransportPosition {
    let beats = this.restPosition;
    if (this.playState === 'started') {
      // Scheduling runs ahead, so the newest segment may begin in the future: use the one in force now.
      const now = this.engine.now();
      let current = this.segments[0]!;
      for (const segment of this.segments) if (segment.time <= now) current = segment;
      beats = Math.max(0, current.position + (now - current.time) / current.secondsPerBeat);
    }
    const perBar = (this.signature[0] * 4) / this.signature[1];
    return {
      beats,
      bar: Math.floor(beats / perBar + EPSILON),
      beatInBar: mod(beats, perBar),
      seconds: beats * this.secondsPerBeat,
    };
  }

  toAudioTime(position: Position): number {
    const beats = this.beats(position);
    if (this.playState === 'started') return this.timeAt(beats);
    return this.engine.now() + (beats - this.restPosition) * this.secondsPerBeat;
  }

  toBeats(audioTime: number): number {
    if (this.playState === 'started') return this.positionAt(audioTime);
    return this.restPosition + (audioTime - this.engine.now()) / this.secondsPerBeat;
  }

  seconds(duration: Duration): number {
    return this.beats(duration) * this.secondsPerBeat;
  }

  /** The position a source added or changed right now should be armed at. */
  armPosition(): number {
    return this.playState === 'started' ? this.processed : this.restPosition;
  }

  // --- Running ------------------------------------------------------------------------------------

  start(options: { at?: number; from?: Position } = {}): this {
    if (this.playState === 'started') return this;
    const time = options.at ?? (this.engine.offline ? 0 : this.engine.now() + START_DELAY);
    const position = options.from === undefined ? this.restPosition : this.beats(options.from);
    this.segments = [{ position, time, secondsPerBeat: this.secondsPerBeat }];
    this.processed = position;
    for (const source of this.sources) source.reset(position);
    this.playState = 'started';
    this.events.emit('start', { time, beat: position, bar: this.barOf(position) });
    if (!this.engine.offline) {
      this.ticker.start(this.wakeInterval, () => this.tick());
      this.tick();
    }
    return this;
  }

  stop(options: { at?: number } = {}): this {
    this.halt(options.at, 'stopped');
    return this;
  }

  pause(options: { at?: number } = {}): this {
    this.halt(options.at, 'paused');
    return this;
  }

  private halt(at: number | undefined, next: 'stopped' | 'paused'): void {
    if (this.playState !== 'started') {
      if (next === 'stopped') this.restPosition = 0;
      this.playState = next;
      return;
    }
    const time = at ?? this.engine.resolveAt(undefined);
    // Hand out whatever is due before the halt, unless we are already inside the scheduler.
    if (!this.processing) this.process(time);
    const position = Math.max(this.positionAt(time), 0);
    this.playState = next;
    // Resume after anything already handed out, so nothing plays twice. Inside a callback, `processed`
    // is the position of the event being delivered, so step just past it.
    const resumeFrom = this.processing ? this.processed + 4 * EPSILON : this.processed;
    this.restPosition = next === 'paused' ? Math.max(position, resumeFrom) : 0;
    this.ticker.stop();
    this.events.emit('stop', { time, beat: position, bar: this.barOf(position) });
  }

  seek(position: Position): this {
    const beats = this.beats(position);
    if (this.playState !== 'started') {
      this.restPosition = beats;
      return this;
    }
    this.pushSegment(beats, this.engine.resolveAt(undefined));
    this.processed = beats;
    for (const source of this.sources) source.reset(beats);
    return this;
  }

  /** Live: called by the timer. Hands out everything due within the look-ahead window. */
  private tick(): void {
    if (this.playState === 'started') this.process(this.engine.now() + this.lookahead);
  }

  /** Offline: hands out every event up to the end of the render in one pass. */
  runOffline(endTime: number): void {
    if (this.playState === 'started') this.process(endTime);
  }

  /**
   * The scheduler. Repeatedly finds the earliest pending event before the horizon and delivers it.
   * Working one position at a time means a callback can change the tempo, add or replace sequences,
   * or stop the transport, and everything after it follows the change.
   */
  private process(horizonTime: number): void {
    if (this.processing) return;
    this.processing = true;
    let skipped = 0;
    let behindBy = 0;
    try {
      for (let guard = 0; guard < 1_000_000; guard++) {
        if (this.playState !== 'started') break;
        const limit = this.positionAt(horizonTime);
        const loop = this.loopRegion
          ? { start: this.beats(this.loopRegion.start), end: this.beats(this.loopRegion.end) }
          : null;
        const wraps = loop !== null && this.processed < loop.end - EPSILON && limit >= loop.end;
        const end = wraps ? loop.end : limit;

        let earliest: number | null = null;
        for (const source of this.sources) {
          const position = source.peek();
          if (
            position !== null &&
            position < end - EPSILON &&
            (earliest === null || position < earliest)
          ) {
            earliest = position;
          }
        }

        if (earliest !== null) {
          const position = earliest;
          const time = this.timeAt(position);
          const batch = this.sources
            .filter((source) => {
              const next = source.peek();
              return next !== null && Math.abs(next - position) <= EPSILON;
            })
            .sort((a, b) => a.order - b.order || a.serial - b.serial);
          this.processed = position;
          const lateBy = this.engine.offline ? 0 : this.engine.now() - time;
          if (lateBy > LATE_GRACE) {
            for (const source of batch) source.skip();
            skipped += batch.length;
            behindBy = Math.max(behindBy, lateBy);
            continue;
          }
          const secondsPerBeat = this.secondsPerBeat;
          for (const source of batch) {
            // A callback earlier in the batch may have removed or re-armed this source.
            const next = source.peek();
            if (this.playState !== 'started') break;
            if (
              !this.sources.includes(source) ||
              next === null ||
              Math.abs(next - position) > EPSILON
            ) {
              continue;
            }
            source.fire(time, position, secondsPerBeat);
          }
          continue;
        }

        if (wraps) {
          this.pushSegment(loop.start, this.timeAt(loop.end));
          this.processed = loop.start;
          for (const source of this.sources) source.reset(loop.start);
          continue;
        }

        this.processed = Math.max(this.processed, limit);
        break;
      }
    } finally {
      this.processing = false;
    }
    if (skipped > 0) this.events.emit('late', { skipped, behindBy });
  }

  /** Runs a callback with the event's time as the default time for everything it does. */
  deliver<E extends ScheduledEvent>(event: E, callback: (event: E) => void): void {
    const previous = this.engine.eventTime;
    this.engine.eventTime = event.time;
    try {
      callback(event);
    } catch (thrown) {
      const message = thrown instanceof Error ? thrown.message : String(thrown);
      this.engine.report(
        new CrackedUpError('callback', `A transport callback threw: ${message}`, { cause: thrown }),
      );
    } finally {
      this.engine.eventTime = previous;
    }
    if ('sequence' in event && this.displayListeners.size > 0 && !this.engine.offline) {
      this.displayQueue.push(event as unknown as SequenceEvent);
      this.requestFrame();
    }
  }

  // --- Sequences and scheduled callbacks ----------------------------------------------------------

  sequence(options: SequenceOptions, callback: SequenceCallback): Sequence;
  sequence(name: string, options: SequenceOptions, callback: SequenceCallback): Sequence;
  sequence(
    first: string | SequenceOptions,
    second: SequenceOptions | SequenceCallback,
    third?: SequenceCallback,
  ): Sequence {
    const name = typeof first === 'string' ? first : null;
    const options = (typeof first === 'string' ? second : first) as SequenceOptions;
    const callback = (typeof first === 'string' ? third : second) as SequenceCallback;
    if (typeof callback !== 'function')
      throw new TypeError('A sequence needs a callback function.');

    const existing = name === null ? undefined : this.named.get(name);
    if (existing) {
      existing.replace(options, callback);
      existing.rearm(this.armPosition());
      return existing as unknown as Sequence;
    }
    const created = new SequenceImpl(this, this.serial++, name, options, callback);
    created.reset(this.armPosition());
    this.sources.push(created);
    if (name !== null) this.named.set(name, created);
    return created as unknown as Sequence;
  }

  steps(pattern: Pattern, callback: StepCallback): Sequence;
  steps(name: string, pattern: Pattern, callback: StepCallback): Sequence;
  steps(first: string | Pattern, second: Pattern | StepCallback, third?: StepCallback): Sequence {
    // Two strings and a function means (name, pattern, callback); otherwise the first argument is the pattern.
    const named = typeof third === 'function';
    const pattern = (named ? second : first) as Pattern;
    const callback = (named ? third : second) as StepCallback;
    if (typeof callback !== 'function') throw new TypeError('steps() needs a callback function.');
    const wrapped: SequenceCallback = (event) =>
      callback(event.index, event.value, event.steps, event);
    return named
      ? this.sequence(first as string, { steps: pattern }, wrapped)
      : this.sequence({ steps: pattern }, wrapped);
  }

  at(position: Position, callback: (event: ScheduledEvent) => void): Unsubscribe {
    const source = new OneShot(this, this.serial++, this.beats(position), callback);
    source.reset(this.armPosition());
    this.sources.push(source);
    return () => this.remove(source);
  }

  every(
    interval: Duration,
    callback: (event: ScheduledEvent) => void,
    options: { offset?: Duration; order?: number } = {},
  ): Unsubscribe {
    const beats = this.beats(interval);
    if (!(beats > 1e-6)) throw new RangeError('every() needs an interval longer than zero.');
    const offset = options.offset === undefined ? 0 : this.beats(options.offset);
    const source = new Repeater(this, this.serial++, beats, offset, options.order ?? 0, callback);
    source.reset(this.armPosition());
    this.sources.push(source);
    return () => this.remove(source);
  }

  get(name: string): Sequence | undefined {
    return this.named.get(name) as unknown as Sequence | undefined;
  }

  clear(name?: string): this {
    if (name === undefined) {
      this.sources = [];
      this.named.clear();
    } else {
      const sequence = this.named.get(name);
      if (sequence) this.remove(sequence);
    }
    return this;
  }

  remove(source: Source): void {
    this.sources = this.sources.filter((other) => other !== source);
    if (source instanceof SequenceImpl && source.name !== null) {
      if (this.named.get(source.name) === source) this.named.delete(source.name);
    }
  }

  /** Step lengths depend on the time signature and default step: recompute them, then re-arm. */
  private relayout(): void {
    for (const source of this.sources) if (source instanceof SequenceImpl) source.layout();
    this.rearm();
  }

  private rearm(): void {
    const position = this.armPosition();
    for (const source of this.sources) source.reset(position);
  }

  // --- Display sync -------------------------------------------------------------------------------

  onDisplay(listener: (event: SequenceEvent) => void): Unsubscribe {
    this.displayListeners.add(listener);
    return () => {
      this.displayListeners.delete(listener);
    };
  }

  private requestFrame(): void {
    if (this.frame !== null || typeof requestAnimationFrame !== 'function') return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      // An event is heard a little after its audio time: by however long the output device takes.
      const latency = (this.engine.context as AudioContext).outputLatency ?? 0;
      const heard = this.engine.now() - latency;
      let due = 0;
      while (due < this.displayQueue.length && this.displayQueue[due]!.time <= heard) due++;
      for (const event of this.displayQueue.splice(0, due)) {
        for (const listener of this.displayListeners) {
          try {
            listener(event);
          } catch (error) {
            console.error('cracked-up: an onDisplay listener threw', error);
          }
        }
      }
      if (this.displayQueue.length > 0) this.requestFrame();
    });
  }

  // --- Events and lifetime ------------------------------------------------------------------------

  on<E extends keyof TransportEvents>(event: E, listener: TransportEvents[E]): Unsubscribe {
    return this.events.on(event, listener);
  }

  dispose(): void {
    this.ticker.stop();
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.playState = 'stopped';
    this.sources = [];
    this.named.clear();
    this.displayListeners.clear();
    this.displayQueue = [];
    this.events.clear();
  }
}
