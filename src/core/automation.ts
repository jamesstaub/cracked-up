type Kind = 'set' | 'linear' | 'exp';

interface AutomationEvent {
  readonly time: number;
  readonly value: number;
  readonly kind: Kind;
}

/** What `Automation.hold` and `Automation.cut` found at the time they were given. */
export interface Held {
  /** The value the parameter has at that time. */
  readonly value: number;
  /** When the ramp that was in flight would have ended, if there was one. */
  readonly rampEnd: number | null;
}

/**
 * Everything a parameter has scheduled on its AudioParam, kept as a list so the value at any time
 * can be worked out here: an AudioParam cannot be asked what it will be, and not every browser can
 * stop a ramp part-way and keep the value it has reached (Firefox has no `cancelAndHoldAtTime`).
 *
 * Events are kept in time order, and a ramp runs from the event before it to its own time and
 * value, as the Web Audio automation timeline does. All scheduling on the AudioParam goes through
 * this class so the list and the browser's timeline stay the same.
 */
export class Automation {
  private events: AutomationEvent[] = [];

  constructor(
    private readonly audio: AudioParam,
    private initial: number,
  ) {}

  /** The scheduled value at a time. */
  valueAt(time: number): number {
    const events = this.events;
    let index = events.length;
    while (index > 0 && events[index - 1]!.time > time) index--;
    const before = events[index - 1];
    const after = events[index];
    if (!before) return this.initial;
    if (!after || after.kind === 'set' || !(after.time > before.time)) return before.value;
    const position = (time - before.time) / (after.time - before.time);
    if (after.kind === 'exp') {
      // As the browser does it: an exponential ramp from 0, or across 0, stays where it started.
      if (before.value === 0 || Math.sign(before.value) !== Math.sign(after.value)) {
        return before.value;
      }
      return before.value * Math.pow(after.value / before.value, position);
    }
    return before.value + (after.value - before.value) * position;
  }

  /** A step to `value` at `time`. */
  set(value: number, time: number): void {
    this.audio.setValueAtTime(value, time);
    this.insert({ time, value, kind: 'set' });
  }

  /** A ramp from the event before `time` to `value` at `time`. */
  rampTo(value: number, time: number, kind: 'linear' | 'exp'): void {
    if (kind === 'exp') this.audio.exponentialRampToValueAtTime(value, time);
    else this.audio.linearRampToValueAtTime(value, time);
    this.insert({ time, value, kind });
  }

  /**
   * Removes everything scheduled after `at`, and stops a ramp that is in flight then at the value
   * it has reached, which the parameter keeps from `at` on.
   */
  hold(at: number): Held {
    return this.clear(at, false);
  }

  /**
   * Stops a ramp that is in flight at `at`, as `hold` does, and keeps what is scheduled to start
   * later. For a change made at `at` that the rest of an earlier ramp must not carry away.
   */
  cut(at: number): Held {
    return this.clear(at, true);
  }

  /** Removes everything scheduled at or after the time. A ramp in flight is dropped whole. */
  cancel(at: number): void {
    this.audio.cancelScheduledValues(at);
    this.events = this.events.filter((event) => event.time < at);
  }

  /** Forgets events that are in the past, keeping the last one: a ramp in flight starts from it. */
  prune(now: number): void {
    const events = this.events;
    let count = 0;
    while (count + 1 < events.length && events[count + 1]!.time <= now) count++;
    if (count === 0) return;
    this.initial = events[count - 1]!.value;
    events.splice(0, count);
  }

  private clear(at: number, keepLater: boolean): Held {
    const events = this.events;
    const value = this.valueAt(at);
    let first = events.length;
    while (first > 0 && events[first - 1]!.time >= at) first--;
    let after = first;
    while (after < events.length && events[after]!.time === at) after++;
    const next = events[after];
    const inFlight =
      next !== undefined && next.kind !== 'set' ? { ...next, kind: next.kind } : null;
    const held: Held = { value, rampEnd: inFlight ? inFlight.time : null };
    // Nothing to remove, or nothing in the way of a change that leaves later events alone.
    if (first === events.length || (keepLater && !inFlight)) return held;

    const same = events.slice(first, after);
    const later = keepLater ? events.slice(after + 1) : [];
    this.events = events.slice(0, first);
    // A ramp in flight is replaced by its first part, up to `at`. Where the browser can do that in
    // one step it is asked to: done as two, a block of audio rendered between them would be at the
    // value the ramp started from.
    const shorten = inFlight !== null && same.length === 0;
    if (shorten && typeof this.audio.cancelAndHoldAtTime === 'function') {
      this.audio.cancelAndHoldAtTime(at);
      this.events.push({ time: at, value, kind: inFlight.kind });
    } else {
      this.audio.cancelScheduledValues(at);
      for (const event of same) this.replay(event);
      if (shorten) this.rampTo(value, at, inFlight.kind);
    }
    for (const event of later) this.replay(event);
    return held;
  }

  private replay(event: AutomationEvent): void {
    if (event.kind === 'set') this.set(event.value, event.time);
    else this.rampTo(event.value, event.time, event.kind);
  }

  /** Adds an event after any others at the same time, as the browser orders them. */
  private insert(event: AutomationEvent): void {
    const events = this.events;
    let index = events.length;
    while (index > 0 && events[index - 1]!.time > event.time) index--;
    events.splice(index, 0, event);
  }
}
