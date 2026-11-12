import type {
  At,
  Modulation,
  Node,
  OffsetOptions,
  Param,
  ParamChange,
  ParamHandler,
  ParamMeta,
  ParamValue,
  RampOptions,
  Unsubscribe,
} from '../api';
import { fromNormalized, toNormalized } from '../util/curves';
import { CrackedUpError, Emitter } from './errors';
import { Timeline } from './timeline';
import type { NodeImpl } from './node';

type ParamEvents = {
  change: (change: ParamChange) => void;
  modulators: (modulators: readonly Modulation[]) => void;
};

/** An inner parameter that a macro's exposed parameter drives. */
export interface ParamLink {
  readonly param: ParamImpl;
  readonly scale?: (value: number) => number;
}

/** What a parameter drives: a native AudioParam, a function, or nothing yet. */
export type ParamTarget = AudioParam | ParamHandler | undefined;

function isAudioParam(target: ParamTarget): target is AudioParam {
  return typeof target === 'object' && target !== null && 'setValueAtTime' in target;
}

/** Implements the public `Param` interface; typed loosely inside the library and cast at its edges. */
export class ParamImpl {
  readonly node: NodeImpl;
  readonly name: string;
  readonly meta: ParamMeta;

  private base: ParamValue;
  /** The base value over time, so voices started in the future read the value they will start with. */
  private baseLine: Timeline<ParamValue>;
  private offsetLine = new Timeline<number>(0);
  private target: ParamTarget;
  /** For a macro's exposed parameter: finds the inner parameters it drives right now. */
  private links: (() => readonly ParamLink[]) | null = null;
  /** Offsets on an AudioParam are a separate constant signal added to it, so they never disturb the base. */
  private offsetSource: ConstantSourceNode | null = null;
  private mods: Modulation[] = [];
  private events = new Emitter<ParamEvents>();

  constructor(node: NodeImpl, meta: ParamMeta, initial: ParamValue | undefined) {
    this.node = node;
    this.name = meta.name;
    this.meta = meta;
    this.base = initial === undefined ? meta.default : this.coerce(initial);
    this.baseLine = new Timeline<ParamValue>(this.base);
  }

  /** Attaches the parameter to what the node's build returned, and applies the starting value. */
  bind(target: ParamTarget): void {
    this.target = target;
    if (isAudioParam(target)) {
      target.value = this.base as number;
    } else if (target) {
      target(this.base, this.node.engine.now());
    }
  }

  /**
   * Makes this a macro's exposed parameter: setting it sets the inner parameters `resolve` returns.
   * They are looked up on every change, so nodes the macro creates later follow too.
   */
  bindLinks(resolve: () => readonly ParamLink[]): void {
    this.links = resolve;
    this.bind((value, at) => {
      for (const link of resolve()) {
        link.param.applySet(
          link.scale && typeof value === 'number' ? link.scale(value) : value,
          at,
        );
      }
    });
  }

  /** Every native AudioParam a modulator of this parameter should be connected to. */
  audioParams(): AudioParam[] {
    if (isAudioParam(this.target)) return [this.target];
    if (!this.links) return [];
    // A scaled link cannot be modulated faithfully: the scaling happens in code, not in the signal.
    return this.links()
      .filter((link) => !link.scale)
      .flatMap((link) => link.param.audioParams());
  }

  get value(): ParamValue {
    return this.base;
  }

  /** The native AudioParam behind this parameter, or null when it is not audio-rate. */
  get audioParam(): AudioParam | null {
    return isAudioParam(this.target) ? this.target : null;
  }

  set(value: ParamValue, options?: At): this {
    this.applySet(value, this.node.engine.resolveAt(options?.at));
    return this;
  }

  applySet(value: ParamValue, at: number): void {
    const next = this.coerce(value);
    const previous = this.base;
    this.base = next;
    this.baseLine.prune(this.node.engine.now());
    this.baseLine.set(at, next);
    if (isAudioParam(this.target)) {
      this.target.setValueAtTime(next as number, at);
    } else if (this.target) {
      this.target(this.effectiveAt(at), at);
    }
    if (next !== previous) {
      this.events.emit('change', { param: this.asPublic(), value: next, previous, at });
    }
  }

  get normalized(): number {
    const meta = this.meta;
    if (meta.kind === 'number') return toNormalized(this.base as number, meta);
    if (meta.kind === 'boolean') return this.base ? 1 : 0;
    const index = meta.choices.indexOf(this.base as string);
    return meta.choices.length > 1 ? Math.max(index, 0) / (meta.choices.length - 1) : 0;
  }

  setNormalized(position: number, options?: At): this {
    const meta = this.meta;
    const clamped = Math.min(1, Math.max(0, position));
    if (meta.kind === 'number') return this.set(fromNormalized(clamped, meta), options);
    if (meta.kind === 'boolean') return this.set(clamped >= 0.5, options);
    const index = Math.round(clamped * (meta.choices.length - 1));
    return this.set(meta.choices[index] ?? meta.default, options);
  }

  ramp(target: number, options: RampOptions): this {
    this.applyRamp(target, this.node.engine.resolveAt(options.at), options);
    return this;
  }

  applyRamp(target: number, at: number, options: Omit<RampOptions, 'at'>): void {
    const audio = this.audioParam;
    if (this.meta.kind === 'number' && !audio && this.links) {
      // A macro's exposed parameter: ramp each inner parameter it drives.
      const to = this.coerce(target) as number;
      const from = options.from;
      for (const link of this.links()) {
        const scale = link.scale ?? ((value: number) => value);
        link.param.applyRamp(scale(to), at, {
          ...options,
          ...(from === undefined ? {} : { from: scale(from) }),
        });
      }
      const previous = this.base;
      const end = at + options.duration;
      this.base = to;
      this.baseLine.set(end, to);
      if (to !== previous) {
        this.events.emit('change', { param: this.asPublic(), value: to, previous, at: end });
      }
      return;
    }
    if (this.meta.kind !== 'number' || !audio) {
      throw this.error(`cannot be ramped: only audio-rate number parameters can`);
    }
    if (!(options.duration >= 0)) throw this.error(`ramp needs a duration of 0 or more seconds`);
    const to = this.coerce(target) as number;
    const from = options.from === undefined ? (this.base as number) : options.from;
    const end = at + options.duration;
    audio.setValueAtTime(from, at);
    if (options.curve === 'exp') {
      // An exponential ramp cannot start at, end at, or cross zero.
      const floor = 1e-4;
      const safeFrom = Math.abs(from) < floor ? floor * (to < 0 ? -1 : 1) : from;
      const safeTo = Math.abs(to) < floor ? floor * (safeFrom < 0 ? -1 : 1) : to;
      if (safeFrom !== from) audio.setValueAtTime(safeFrom, at);
      if (Math.sign(safeFrom) === Math.sign(safeTo))
        audio.exponentialRampToValueAtTime(safeTo, end);
      else audio.linearRampToValueAtTime(to, end);
    } else {
      audio.linearRampToValueAtTime(to, end);
    }
    const previous = this.base;
    this.base = to;
    this.baseLine.set(end, to);
    if (to !== previous) {
      this.events.emit('change', { param: this.asPublic(), value: to, previous, at: end });
    }
  }

  offset(amount: number, options?: OffsetOptions): this {
    this.applyOffset(amount, this.node.engine.resolveAt(options?.at), options?.duration);
    return this;
  }

  applyOffset(amount: number, at: number, duration?: number): void {
    if (this.meta.kind !== 'number') throw this.error(`cannot be offset: it is not a number`);
    if (!Number.isFinite(amount)) throw this.error(`offset must be a finite number`);
    const end = duration === undefined ? undefined : at + duration;
    this.offsetLine.prune(this.node.engine.now());
    this.offsetLine.set(at, amount);
    if (end !== undefined) this.offsetLine.set(end, 0);

    const audio = this.audioParam;
    if (audio) {
      const source = this.ensureOffsetSource(audio);
      source.offset.setValueAtTime(amount, at);
      if (end !== undefined) source.offset.setValueAtTime(0, end);
    } else if (this.target && !isAudioParam(this.target)) {
      this.target(this.effectiveAt(at), at);
      if (end !== undefined) this.target(this.effectiveAt(end), end);
    }
  }

  clearOffset(options?: At): this {
    this.applyOffset(0, this.node.engine.resolveAt(options?.at));
    return this;
  }

  cancel(options?: At): this {
    this.applyCancel(this.node.engine.resolveAt(options?.at));
    return this;
  }

  applyCancel(at: number): void {
    this.audioParam?.cancelScheduledValues(at);
    this.offsetSource?.offset.cancelScheduledValues(at);
    this.baseLine.truncate(at);
    this.offsetLine.truncate(at);
    this.base = this.baseLine.valueAt(Number.POSITIVE_INFINITY);
  }

  reset(options?: At): this {
    return this.set(this.meta.default, options);
  }

  /** Base value plus any offset active at the time. */
  effectiveAt(time: number): ParamValue {
    const base = this.baseLine.valueAt(time);
    return typeof base === 'number' ? base + this.offsetLine.valueAt(time) : base;
  }

  get modulators(): readonly Modulation[] {
    return this.mods;
  }

  /** Records that a node's output now feeds this parameter. The native connection is made by the caller. */
  addModulation(source: NodeImpl, disconnect: () => void): Modulation {
    const modulation: Modulation = {
      source: source as unknown as Node,
      target: this as unknown as Param<number>,
      disconnect,
    };
    this.mods = [...this.mods, modulation];
    this.events.emit('modulators', this.mods);
    return modulation;
  }

  removeModulation(source: NodeImpl): void {
    const next = this.mods.filter((modulation) => (modulation.source as unknown) !== source);
    if (next.length === this.mods.length) return;
    this.mods = next;
    this.events.emit('modulators', this.mods);
  }

  on(event: 'change', listener: (change: ParamChange) => void): Unsubscribe;
  on(event: 'modulators', listener: (modulators: readonly Modulation[]) => void): Unsubscribe;
  on(
    event: keyof ParamEvents,
    listener: ((change: ParamChange) => void) | ((modulators: readonly Modulation[]) => void),
  ): Unsubscribe {
    return this.events.on(event, listener as ParamEvents[typeof event]);
  }

  private asPublic(): Param {
    return this as unknown as Param;
  }

  dispose(): void {
    if (this.offsetSource) {
      try {
        this.offsetSource.stop();
      } catch {
        // already stopped
      }
      this.offsetSource.disconnect();
      this.offsetSource = null;
    }
    this.mods = [];
    this.events.clear();
    this.target = undefined;
  }

  /** Checks a value against the parameter's kind. */
  private coerce(value: ParamValue): ParamValue {
    const meta = this.meta;
    if (meta.kind === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw this.error(`needs a finite number, got ${JSON.stringify(value)}`);
      }
      // The metadata range is the range a control covers, not a limit: modulation depths and the like
      // legitimately go beyond it, and the AudioParam enforces its own hard limits.
      return value;
    }
    if (meta.kind === 'boolean') {
      if (typeof value === 'boolean') return value;
      if (value === 0 || value === 1) return value === 1;
      throw this.error(`needs true or false, got ${JSON.stringify(value)}`);
    }
    if (typeof value !== 'string' || !meta.choices.includes(value)) {
      throw this.error(`must be one of ${meta.choices.join(', ')}; got ${JSON.stringify(value)}`);
    }
    return value;
  }

  private ensureOffsetSource(audio: AudioParam): ConstantSourceNode {
    if (!this.offsetSource) {
      const source = new ConstantSourceNode(this.node.engine.context, { offset: 0 });
      source.connect(audio);
      source.start();
      this.offsetSource = source;
    }
    return this.offsetSource;
  }

  private error(problem: string): CrackedUpError {
    return new CrackedUpError(
      'invalid-param',
      `"${this.name}" on ${this.node.type} "${this.node.id}" ${problem}.`,
      { nodeId: this.node.id },
    );
  }
}
