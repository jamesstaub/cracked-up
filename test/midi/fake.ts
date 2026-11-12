import type { MidiAccessLike, MidiEventLike, MidiInputLike, MidiOutputLike } from '../../src/midi';

/** A pretend MIDI input: the test calls `emit` to play something into it. */
export class FakeInput implements MidiInputLike {
  private listeners = new Set<(event: MidiEventLike) => void>();
  constructor(
    readonly id: string,
    readonly name: string = id,
  ) {}

  addEventListener(_type: 'midimessage', listener: (event: MidiEventLike) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'midimessage', listener: (event: MidiEventLike) => void): void {
    this.listeners.delete(listener);
  }

  get listening(): boolean {
    return this.listeners.size > 0;
  }

  emit(data: number[], timeStamp = 0): void {
    for (const listener of [...this.listeners]) listener({ data, timeStamp });
  }
}

/** A pretend MIDI output that remembers what was sent and when. */
export class FakeOutput implements MidiOutputLike {
  sent: { data: number[]; at: number | undefined }[] = [];
  constructor(
    readonly id: string,
    readonly name: string = id,
  ) {}

  send(data: number[], timestamp?: number): void {
    this.sent.push({ data, at: timestamp });
  }
}

export class FakeAccess implements MidiAccessLike {
  inputs = new Map<string, FakeInput>();
  outputs = new Map<string, FakeOutput>();
  private listeners = new Set<() => void>();

  constructor(inputs: FakeInput[] = [], outputs: FakeOutput[] = []) {
    for (const input of inputs) this.inputs.set(input.id, input);
    for (const output of outputs) this.outputs.set(output.id, output);
  }

  addEventListener(_type: 'statechange', listener: () => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'statechange', listener: () => void): void {
    this.listeners.delete(listener);
  }

  /** Plugs a device in or pulls one out, as the browser would report it. */
  change(edit: (access: FakeAccess) => void): void {
    edit(this);
    for (const listener of [...this.listeners]) listener();
  }
}

/** Times in tests: MIDI milliseconds are simply audio seconds times 1000. */
export const plainTiming = {
  toAudioTime: (milliseconds: number): number => milliseconds / 1000,
  toMilliseconds: (audioTime: number): number => audioTime * 1000,
};
