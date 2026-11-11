/**
 * Values that change at scheduled times. Used for parameters that are not AudioParams, so that code
 * running ahead of the audio clock can ask what a value will be at a given time.
 */
export class Timeline<V> {
  private events: { time: number; value: V }[] = [];

  constructor(private initial: V) {}

  /** Schedules a value. A second value at the same time replaces the first. */
  set(time: number, value: V): void {
    const events = this.events;
    let index = events.length;
    while (index > 0 && events[index - 1]!.time > time) index--;
    const before = events[index - 1];
    if (before && before.time === time) before.value = value;
    else events.splice(index, 0, { time, value });
  }

  valueAt(time: number): V {
    let value = this.initial;
    for (const event of this.events) {
      if (event.time > time) break;
      value = event.value;
    }
    return value;
  }

  /** Removes everything scheduled at or after the time. */
  truncate(time: number): void {
    this.events = this.events.filter((event) => event.time < time);
  }

  /** Folds events that are already in the past into the starting value, to keep the list short. */
  prune(now: number): void {
    let count = 0;
    for (const event of this.events) {
      if (event.time > now) break;
      this.initial = event.value;
      count++;
    }
    if (count > 0) this.events.splice(0, count);
  }

  get size(): number {
    return this.events.length;
  }
}
