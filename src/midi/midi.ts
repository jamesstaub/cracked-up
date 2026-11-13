import type { ClockSource, Engine, Node, Param, Selection, Transport, Unsubscribe } from '../api';
import { CrackedUpError } from '../core/errors';
import { ClockFollower } from './clock';
import type { FollowOptions } from './clock';
import { encodeMidi, parseMidi } from './messages';
import type { MidiMessage, MidiMessageType } from './messages';

// ---------------------------------------------------------------------------------------------------
// What this module needs from Web MIDI. The browser's MIDIAccess fits; so does a stand-in for tests.
// ---------------------------------------------------------------------------------------------------

export interface MidiInputLike {
  readonly id: string;
  readonly name?: string | null;
  readonly manufacturer?: string | null;
  readonly state?: string;
  addEventListener(type: 'midimessage', listener: (event: MidiEventLike) => void): void;
  removeEventListener(type: 'midimessage', listener: (event: MidiEventLike) => void): void;
}

export interface MidiEventLike {
  readonly data: ArrayLike<number> | null;
  /** Milliseconds on the `performance.now()` clock. */
  readonly timeStamp: number;
}

export interface MidiOutputLike {
  readonly id: string;
  readonly name?: string | null;
  readonly manufacturer?: string | null;
  readonly state?: string;
  /** `timestamp` is in milliseconds on the `performance.now()` clock; omitted means now. */
  send(data: number[], timestamp?: number): void;
}

export interface MidiAccessLike {
  readonly inputs: { values(): Iterable<MidiInputLike> };
  readonly outputs: { values(): Iterable<MidiOutputLike> };
  addEventListener?(type: 'statechange', listener: () => void): void;
  removeEventListener?(type: 'statechange', listener: () => void): void;
}

/** Converts between the audio clock (seconds) and the clock MIDI uses (milliseconds). */
export interface MidiTiming {
  toAudioTime(milliseconds: number): number;
  toMilliseconds(audioTime: number): number;
}

export interface MidiOptions {
  /** Replaces how times are converted. For tests and unusual setups. */
  timing?: MidiTiming;
}

// ---------------------------------------------------------------------------------------------------
// The public shape
// ---------------------------------------------------------------------------------------------------

export interface MidiPort {
  readonly id: string;
  readonly name: string;
  readonly manufacturer: string;
}

/** A received message, with when it happened on the audio clock and which input it came from. */
export type MidiEvent<T extends MidiMessageType = MidiMessageType> = Extract<
  MidiMessage,
  { type: T }
> & {
  readonly time: number;
  readonly input: MidiPort;
};

export interface MidiFilter {
  /** 1 to 16. Omitted: every channel. */
  channel?: number;
  /** An input's id or name. Omitted: every input. */
  input?: string;
}

/** What a controller is tied to: a parameter, or a function that finds it each time (which keeps working after a rebuild replaces the node). */
export type ParamTarget = Param | (() => Param | undefined);

export interface MidiBinding {
  readonly controller: number;
  readonly channel: number | null;
  readonly input: string | null;
  remove(): void;
}

export interface SendOptions {
  /** Audio time. Omitted: the current sequence event's time inside a callback, otherwise now. */
  at?: number;
  /** 1 to 16. Default: the output's channel. */
  channel?: number;
}

export interface MidiOut {
  readonly port: MidiPort;
  /** The channel used when a call gives none. Default 1. */
  channel: number;
  noteOn(note: number, velocity?: number, options?: SendOptions): this;
  noteOff(note: number, options?: SendOptions): this;
  /** A note-on now (or at `at`) and its note-off `duration` seconds later. */
  note(note: number, options?: SendOptions & { duration?: number; velocity?: number }): this;
  cc(controller: number, value: number, options?: SendOptions): this;
  pitchBend(value: number, options?: SendOptions): this;
  program(program: number, options?: SendOptions): this;
  /** Any message, or raw bytes. */
  send(message: MidiMessage | readonly number[], options?: { at?: number }): this;
}

export interface ClockFollow {
  /** The tempo measured from the incoming clock; null until it has heard enough of it. */
  readonly bpm: number | null;
  /** How far the transport currently is from the incoming clock, in seconds. Positive: behind. */
  readonly error: number;
  /** Stops following and gives the tempo back to the transport. */
  stop(): void;
}

export interface Midi {
  readonly inputs: readonly MidiPort[];
  readonly outputs: readonly MidiPort[];

  /** Called when a device is plugged in or removed. */
  on(event: 'devices', listener: () => void): Unsubscribe;
  /** Called for every message of one kind, or with `'message'` for all of them. Any number of listeners. */
  on<T extends MidiMessageType>(
    event: T,
    listener: (event: MidiEvent<T>) => void,
    filter?: MidiFilter,
  ): Unsubscribe;
  on(event: 'message', listener: (event: MidiEvent) => void, filter?: MidiFilter): Unsubscribe;

  /** Plays notes that arrive on the selected nodes: note-on triggers with the pitch, note-off releases it. */
  play(target: Selection | Node | (() => Selection), filter?: MidiFilter): Unsubscribe;

  /** Ties a controller to a parameter. The controller's travel covers the parameter's control range. */
  bind(controller: { controller: number } & MidiFilter, target: ParamTarget): MidiBinding;
  /** Ties the next controller that is moved to the parameter. Resolves once one has been. */
  learn(target: ParamTarget, filter?: MidiFilter): Promise<MidiBinding>;
  cancelLearn(): void;
  readonly bindings: readonly MidiBinding[];

  /** An output by id or name; the first one when no name is given. */
  output(idOrName?: string): MidiOut;

  /**
   * Sends MIDI clock so that other gear follows the transport: 24 pulses per quarter note, Start,
   * Stop, and Continue with a song position when playback begins part-way through.
   */
  sendClock(output?: string | MidiOut): Unsubscribe;

  /**
   * Makes the transport follow MIDI clock arriving on an input: its Start, Stop and Continue, its
   * tempo, and its position. While following, setting `transport.bpm` does nothing.
   */
  follow(input?: string, options?: FollowOptions): ClockFollow;

  /**
   * For code that is run again and again, such as a script re-run on every edit. `run` is given a
   * midi object to make its calls on, and when it returns those calls replace the ones the last
   * `build` made: listeners, bindings and `play` are swapped, and a `follow` or `sendClock` with the
   * same arguments as one already running is left running, so the sync is not restarted. Calls the
   * new run no longer makes are stopped. If `run` throws, nothing changes.
   */
  build<T>(run: (midi: Midi) => T): T;
  /**
   * `build` in two steps, for when success is known only later: make calls on `session.midi`, then
   * `commit()` to put them in place of the last session's, or `rollback()` to drop them.
   */
  session(): MidiSession;

  dispose(): void;
}

export interface MidiSession {
  /** Stands in for the midi object. Nothing called on it takes effect until `commit`. */
  readonly midi: Midi;
  commit(): void;
  rollback(): void;
}

// ---------------------------------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------------------------------

/** The engine's internals this module uses. */
interface EngineInternals {
  resolveAt(at: number | undefined): number;
  transportImpl: {
    view(owner: object): Transport;
    release(owner: object): void;
    driveTempo(bpm: number): void;
  };
}

const describePort = (port: {
  id: string;
  name?: string | null;
  manufacturer?: string | null;
}): MidiPort => ({
  id: port.id,
  name: port.name ?? port.id,
  manufacturer: port.manufacturer ?? '',
});

function defaultTiming(context: BaseAudioContext): MidiTiming {
  /** A matching pair of readings from the two clocks. */
  const reference = (): { audio: number; milliseconds: number } => {
    const live = context as AudioContext;
    // The audio that is leaving the speakers now, and when "now" is. This accounts for output
    // latency, so MIDI lines up with what is heard rather than with what has been computed.
    const stamp = typeof live.getOutputTimestamp === 'function' ? live.getOutputTimestamp() : null;
    if (stamp && stamp.performanceTime && stamp.contextTime) {
      return { audio: stamp.contextTime, milliseconds: stamp.performanceTime };
    }
    return { audio: context.currentTime, milliseconds: performance.now() };
  };
  return {
    toAudioTime(milliseconds) {
      const now = reference();
      return now.audio + (milliseconds - now.milliseconds) / 1000;
    },
    toMilliseconds(audioTime) {
      const now = reference();
      return now.milliseconds + (audioTime - now.audio) * 1000;
    },
  };
}

type Listener = {
  type: MidiMessageType | 'message';
  filter: MidiFilter;
  call: (event: MidiEvent) => void;
};

/**
 * MIDI for an engine: messages in, notes and controllers out, and clock in both directions.
 * `access` is what `navigator.requestMIDIAccess()` resolves to (see `requestMidi`).
 */
export function createMidi(
  engine: Engine,
  access: MidiAccessLike,
  options: MidiOptions = {},
): Midi {
  const internals = engine as unknown as EngineInternals;
  const timing = options.timing ?? defaultTiming(engine.context);
  /** Owns what this module schedules on the transport, so a script's rebuild cannot remove it. */
  const owner = {};
  const transport = internals.transportImpl.view(owner);

  const listeners = new Set<Listener>();
  const deviceListeners = new Set<() => void>();
  const bindings: MidiBinding[] = [];
  const attached = new Map<MidiInputLike, (event: MidiEventLike) => void>();
  const cleanups = new Set<() => void>();
  let learning: { cancel(): void } | null = null;
  let disposed = false;

  const matches = (filter: MidiFilter, message: MidiMessage, port: MidiPort): boolean => {
    if (filter.input !== undefined && filter.input !== port.id && filter.input !== port.name) {
      return false;
    }
    if (filter.channel !== undefined) {
      return 'channel' in message && message.channel === filter.channel;
    }
    return true;
  };

  const receive = (input: MidiInputLike, event: MidiEventLike): void => {
    if (!event.data || event.data.length === 0) return;
    const port = describePort(input);
    const message = parseMidi(event.data);
    const full = {
      ...message,
      time: timing.toAudioTime(event.timeStamp),
      input: port,
    } as MidiEvent;
    for (const listener of [...listeners]) {
      if (listener.type !== 'message' && listener.type !== message.type) continue;
      if (!matches(listener.filter, message, port)) continue;
      try {
        listener.call(full);
      } catch (error) {
        console.error('cracked-up: a MIDI listener threw', error);
      }
    }
  };

  /** Listens to every input present, and stops listening to ones that have gone. */
  const attachInputs = (): void => {
    const present = new Set(access.inputs.values());
    for (const [input, handler] of attached) {
      if (present.has(input)) continue;
      input.removeEventListener('midimessage', handler);
      attached.delete(input);
    }
    for (const input of present) {
      if (attached.has(input)) continue;
      const handler = (event: MidiEventLike): void => receive(input, event);
      input.addEventListener('midimessage', handler);
      attached.set(input, handler);
    }
  };

  const onStateChange = (): void => {
    attachInputs();
    for (const listener of [...deviceListeners]) listener();
  };
  attachInputs();
  access.addEventListener?.('statechange', onStateChange);

  const on = (
    type: MidiMessageType | 'message' | 'devices',
    listener: (event: never) => void,
    filter: MidiFilter = {},
  ): Unsubscribe => {
    if (type === 'devices') {
      const call = listener as () => void;
      deviceListeners.add(call);
      return () => {
        deviceListeners.delete(call);
      };
    }
    const entry: Listener = { type, filter, call: listener as (event: MidiEvent) => void };
    listeners.add(entry);
    return () => {
      listeners.delete(entry);
    };
  };

  const resolveParam = (target: ParamTarget): Param | undefined => {
    try {
      return typeof target === 'function' ? target() : target;
    } catch {
      // The node it pointed at is gone for now (for example, mid-rebuild).
      return undefined;
    }
  };

  /** Moves a parameter to where a controller at `value` (0 to 1) puts it. */
  const applyController = (target: ParamTarget, value: number, at: number): void => {
    const param = resolveParam(target);
    if (!param) return;
    const meta = param.meta;
    if (meta.kind === 'number') param.setNormalized(value, { at });
    else if (meta.kind === 'boolean') param.set(value >= 0.5, { at });
    else {
      const index = Math.min(meta.choices.length - 1, Math.floor(value * meta.choices.length));
      const choice = meta.choices[index];
      if (choice !== undefined) param.set(choice, { at });
    }
  };

  const bind = (source: { controller: number } & MidiFilter, target: ParamTarget): MidiBinding => {
    const off = on(
      'cc',
      (event: MidiEvent<'cc'>) => {
        if (event.controller === source.controller) {
          applyController(target, event.value, internals.resolveAt(undefined));
        }
      },
      source,
    );
    const binding: MidiBinding = {
      controller: source.controller,
      channel: source.channel ?? null,
      input: source.input ?? null,
      remove() {
        off();
        const index = bindings.indexOf(binding);
        if (index !== -1) bindings.splice(index, 1);
      },
    };
    bindings.push(binding);
    return binding;
  };

  const findOutput = (idOrName?: string): MidiOutputLike => {
    const all = [...access.outputs.values()];
    const found =
      idOrName === undefined
        ? all[0]
        : all.find((port) => port.id === idOrName || port.name === idOrName);
    if (!found) {
      const names = all.map((port) => port.name ?? port.id).join(', ') || 'none';
      throw new CrackedUpError(
        'missing-target',
        idOrName === undefined
          ? 'There is no MIDI output connected.'
          : `There is no MIDI output called "${idOrName}". Outputs: ${names}.`,
      );
    }
    return found;
  };

  const makeOut = (port: MidiOutputLike): MidiOut => {
    const sendBytes = (bytes: readonly number[], at: number | undefined): void => {
      port.send([...bytes], timing.toMilliseconds(internals.resolveAt(at)));
    };
    const out: MidiOut = {
      port: describePort(port),
      channel: 1,
      noteOn(note, velocity = 0.8, sendOptions) {
        const channel = sendOptions?.channel ?? out.channel;
        sendBytes(encodeMidi({ type: 'noteon', channel, note, velocity }), sendOptions?.at);
        return out;
      },
      noteOff(note, sendOptions) {
        const channel = sendOptions?.channel ?? out.channel;
        sendBytes(encodeMidi({ type: 'noteoff', channel, note, velocity: 0 }), sendOptions?.at);
        return out;
      },
      note(note, noteOptions) {
        const at = internals.resolveAt(noteOptions?.at);
        const channel = noteOptions?.channel ?? out.channel;
        out.noteOn(note, noteOptions?.velocity ?? 0.8, { at, channel });
        out.noteOff(note, { at: at + (noteOptions?.duration ?? 0.1), channel });
        return out;
      },
      cc(controller, value, sendOptions) {
        const channel = sendOptions?.channel ?? out.channel;
        sendBytes(encodeMidi({ type: 'cc', channel, controller, value }), sendOptions?.at);
        return out;
      },
      pitchBend(value, sendOptions) {
        const channel = sendOptions?.channel ?? out.channel;
        sendBytes(encodeMidi({ type: 'pitchbend', channel, value }), sendOptions?.at);
        return out;
      },
      program(program, sendOptions) {
        const channel = sendOptions?.channel ?? out.channel;
        sendBytes(encodeMidi({ type: 'program', channel, program }), sendOptions?.at);
        return out;
      },
      send(message, sendOptions) {
        const bytes = 'type' in message ? encodeMidi(message) : message;
        sendBytes(bytes, sendOptions?.at);
        return out;
      },
    };
    return out;
  };

  // --- Sessions: calls that replace the last run's ---------------------------------------------------

  /** One call made in a session: how to start it, and how to stop it once started. */
  interface Declared {
    /** Calls with the same key are the same thing and are kept running across sessions. */
    key: string | null;
    start(): () => void;
    stop: (() => void) | null;
    /** What the real call returned, for a handle to read from. */
    value: unknown;
    dropped: boolean;
  }
  /** What the last committed session declared, running now. */
  let current: Declared[] = [];

  const makeSession = (): MidiSession => {
    const declared: Declared[] = [];
    let state: 'open' | 'committed' | 'dropped' = 'open';

    const declare = (key: string | null, start: (entry: Declared) => () => void): Declared => {
      const entry: Declared = {
        key,
        start: () => start(entry),
        stop: null,
        value: undefined,
        dropped: false,
      };
      if (state === 'open') declared.push(entry);
      else if (state === 'committed') {
        // Called late, from a callback of a run that is in place: it takes effect at once.
        entry.stop = entry.start();
        current.push(entry);
      } else entry.dropped = true;
      return entry;
    };
    const drop = (entry: Declared): void => {
      entry.dropped = true;
      entry.stop?.();
      entry.stop = null;
      const index = current.indexOf(entry);
      if (index >= 0) current.splice(index, 1);
    };
    const simple = (start: () => () => void): Unsubscribe => {
      const entry = declare(null, start);
      return () => drop(entry);
    };
    const bindingOf = (
      entry: Declared,
      controller: { controller: number } & MidiFilter,
    ): MidiBinding => ({
      controller: controller.controller,
      channel: controller.channel ?? null,
      input: controller.input ?? null,
      remove: () => drop(entry),
    });

    const facade: Midi = {
      get inputs() {
        return midi.inputs;
      },
      get outputs() {
        return midi.outputs;
      },
      get bindings() {
        return midi.bindings;
      },
      on: ((event: never, listener: never, filter?: MidiFilter) =>
        simple(() =>
          (midi.on as (...args: unknown[]) => Unsubscribe)(event, listener, filter),
        )) as Midi['on'],
      play: (target, filter) => simple(() => midi.play(target, filter)),
      bind(controller, target) {
        const entry = declare(null, () => {
          const binding = midi.bind(controller, target);
          return () => binding.remove();
        });
        return bindingOf(entry, controller);
      },
      learn(target, filter) {
        return new Promise<MidiBinding>((resolve, reject) => {
          const entry = declare(null, () => {
            let binding: MidiBinding | null = null;
            let over = false;
            midi.learn(target, filter).then((made) => {
              if (over) return made.remove();
              binding = made;
              resolve({ ...made, remove: () => drop(entry) });
            }, reject);
            return () => {
              over = true;
              if (binding) binding.remove();
              else midi.cancelLearn();
            };
          });
        });
      },
      cancelLearn: () => midi.cancelLearn(),
      output: (idOrName) => midi.output(idOrName),
      sendClock(output) {
        const name = typeof output === 'string' ? output : (output?.port.id ?? '');
        const entry = declare(`sendClock:${name}`, () => midi.sendClock(output));
        return () => drop(entry);
      },
      follow(input, followOptions) {
        const key = `follow:${JSON.stringify([input ?? null, followOptions ?? null])}`;
        const entry = declare(key, (self) => {
          const real = midi.follow(input, followOptions);
          self.value = real;
          return real.stop;
        });
        const real = (): ClockFollow | undefined => entry.value as ClockFollow | undefined;
        return {
          get bpm() {
            return real()?.bpm ?? null;
          },
          get error() {
            return real()?.error ?? 0;
          },
          stop: () => drop(entry),
        };
      },
      build: (run) => midi.build(run),
      session: () => midi.session(),
      dispose() {
        for (const entry of declared) drop(entry);
        state = 'dropped';
      },
    };

    return {
      midi: facade,
      commit() {
        if (state !== 'open' || disposed) return;
        state = 'committed';
        // What is already running under the same key carries on, with its state.
        const running = new Map<string, Declared>();
        for (const entry of current) if (entry.key !== null) running.set(entry.key, entry);
        const kept = new Set<Declared>();
        for (const entry of declared) {
          const same = entry.key === null || entry.dropped ? undefined : running.get(entry.key);
          if (!same || kept.has(same)) continue;
          kept.add(same);
          entry.stop = same.stop;
          entry.value = same.value;
          same.stop = null;
        }
        // The rest of the last session stops before anything new starts.
        for (const entry of current) {
          entry.stop?.();
          entry.stop = null;
        }
        for (const entry of declared) {
          if (!entry.dropped && entry.stop === null) entry.stop = entry.start();
        }
        current = declared.filter((entry) => !entry.dropped);
      },
      rollback() {
        if (state !== 'open') return;
        state = 'dropped';
        for (const entry of declared) entry.dropped = true;
      },
    };
  };

  const midi: Midi = {
    get inputs() {
      return [...access.inputs.values()].map(describePort);
    },
    get outputs() {
      return [...access.outputs.values()].map(describePort);
    },
    on: on as Midi['on'],

    play(target, filter = {}) {
      const selection = (): { trigger(o: object): unknown; release(o: object): unknown } =>
        (typeof target === 'function' ? target() : target) as never;
      const offs = [
        on(
          'noteon',
          (event: MidiEvent<'noteon'>) => {
            selection().trigger({ pitch: event.note, velocity: event.velocity });
          },
          filter,
        ),
        on(
          'noteoff',
          (event: MidiEvent<'noteoff'>) => {
            selection().release({ pitch: event.note });
          },
          filter,
        ),
      ];
      return () => offs.forEach((off) => off());
    },

    bind,
    learn(target, filter = {}) {
      learning?.cancel();
      return new Promise<MidiBinding>((resolve, reject) => {
        const off = on(
          'cc',
          (event: MidiEvent<'cc'>) => {
            off();
            learning = null;
            // Tied to the channel and input it came from, unless the caller asked for something wider.
            const binding = bind(
              {
                controller: event.controller,
                channel: event.channel,
                input: event.input.id,
                ...filter,
              },
              target,
            );
            applyController(target, event.value, internals.resolveAt(undefined));
            resolve(binding);
          },
          filter,
        );
        learning = {
          cancel() {
            off();
            learning = null;
            reject(new CrackedUpError('missing-target', 'MIDI learn was cancelled.'));
          },
        };
      });
    },
    cancelLearn() {
      learning?.cancel();
    },
    get bindings() {
      return [...bindings];
    },

    output(idOrName) {
      return makeOut(findOutput(idOrName));
    },

    sendClock(output) {
      const out =
        typeof output === 'object' && output !== null ? output : makeOut(findOutput(output));
      const offs = [
        transport.on('start', (event) => {
          if (event.beat < 1e-6) {
            out.send({ type: 'start' }, { at: event.time });
          } else {
            out.send({ type: 'songposition', beats: event.beat }, { at: event.time });
            out.send({ type: 'continue' }, { at: event.time });
          }
        }),
        transport.on('stop', (event) => out.send({ type: 'stop' }, { at: event.time })),
        // Runs ahead of time like any transport callback, so each pulse carries its exact time.
        transport.every(1 / 24, (event) => out.send({ type: 'clock' }, { at: event.time }), {
          order: -1000,
        }),
      ];
      const stop = (): void => {
        offs.forEach((off) => off());
        cleanups.delete(stop);
      };
      cleanups.add(stop);
      return stop;
    },

    follow(input, followOptions) {
      const follower = new ClockFollower(
        {
          get state() {
            return engine.transport.state;
          },
          toBeats: (time) => engine.transport.toBeats(time),
          drive: (bpm) => internals.transportImpl.driveTempo(bpm),
          start: (at, from) => {
            engine.transport.start(from === undefined ? { at } : { at, from });
          },
          pause: (at) => {
            engine.transport.pause({ at });
          },
          seek: (beats) => {
            engine.transport.seek(beats);
          },
        },
        followOptions,
      );
      const filter: MidiFilter = input === undefined ? {} : { input };
      const offs = [
        on('clock', (event: MidiEvent<'clock'>) => follower.pulse(event.time), filter),
        on('start', () => follower.start(), filter),
        on('continue', () => follower.continue(), filter),
        on('stop', (event: MidiEvent<'stop'>) => follower.stop(event.time), filter),
        on(
          'songposition',
          (event: MidiEvent<'songposition'>) => follower.songPosition(event.beats),
          filter,
        ),
      ];
      const source: ClockSource = {
        kind: 'external',
        get bpm() {
          return follower.bpm;
        },
      };
      engine.transport.clock = source;
      const stop = (): void => {
        offs.forEach((off) => off());
        // Only if this is still the clock being followed: a later follow() may have taken over.
        if (engine.transport.clock === source) {
          engine.transport.clock = { kind: 'internal', bpm: null };
        }
        cleanups.delete(stop);
      };
      cleanups.add(stop);
      return {
        get bpm() {
          return follower.bpm;
        },
        get error() {
          return (follower.error * 60) / engine.transport.bpm;
        },
        stop,
      };
    },

    build(run) {
      const session = makeSession();
      let result;
      try {
        result = run(session.midi);
      } catch (thrown) {
        session.rollback();
        throw thrown;
      }
      session.commit();
      return result;
    },
    session: makeSession,

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const entry of current) entry.stop?.();
      current = [];
      for (const cleanup of [...cleanups]) cleanup();
      learning?.cancel();
      for (const [input, handler] of attached) input.removeEventListener('midimessage', handler);
      attached.clear();
      access.removeEventListener?.('statechange', onStateChange);
      internals.transportImpl.release(owner);
      listeners.clear();
      deviceListeners.clear();
    },
  };
  return midi;
}

/**
 * Asks the browser for MIDI access and returns MIDI for the engine. The browser may ask the person for
 * permission. Fails with a clear message where there is no Web MIDI (Safari, at the time of writing).
 */
export async function requestMidi(engine: Engine, options: MidiOptions = {}): Promise<Midi> {
  const request = (navigator as { requestMIDIAccess?: () => Promise<unknown> }).requestMIDIAccess;
  if (typeof request !== 'function') {
    throw new CrackedUpError(
      'unsupported',
      'This browser has no Web MIDI. Chrome, Edge and Firefox do; Safari does not.',
    );
  }
  try {
    const access = (await request.call(navigator)) as MidiAccessLike;
    return createMidi(engine, access, options);
  } catch (thrown) {
    throw new CrackedUpError(
      'unsupported',
      `MIDI access was refused or failed (${thrown instanceof Error ? thrown.message : String(thrown)}).`,
      { cause: thrown },
    );
  }
}
