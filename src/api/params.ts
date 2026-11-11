/**
 * Parameters.
 *
 * A Param is the single place a node parameter's state lives inside the library. It keeps a base value
 * (what a slider would show), accepts temporary offsets on top of that, and knows which nodes are
 * modulating it at audio rate. Rebuilding the underlying native node never loses the base value.
 */

import type { Node } from './graph';

/** Values a parameter can hold. Buffers and other resources are node `init` options, not parameters. */
export type ParamValue = number | boolean | string;

/** Physical or musical unit. Used for display and for conversions; not enforced at runtime. */
export type Unit =
  | 'hz'
  | 'gain'
  | 'db'
  | 'seconds'
  | 'ms'
  | 'beats'
  | 'cents'
  | 'semitones'
  | 'ratio'
  | 'pan'
  | 'q'
  | 'normalized'
  | 'none';

/** How a control should travel between min and max. `log` suits frequency; `exp` suits times. */
export type Curve = 'linear' | 'log' | 'exp';

/**
 * How a parameter can be changed.
 * - `audio`: backed by an AudioParam. Schedulable to the sample, rampable, and a valid modulation target.
 * - `control`: a property or internal setting. Changes take effect at the scheduled time, without ramps.
 * - `init`: fixed when the node is built. Setting it rebuilds the node's internals (connections are kept).
 */
export type ParamRate = 'audio' | 'control' | 'init';

interface ParamMetaBase {
  readonly name: string;
  readonly rate: ParamRate;
  readonly description?: string;
}

export interface NumberParamMeta extends ParamMetaBase {
  readonly kind: 'number';
  readonly default: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly unit: Unit;
  readonly curve: Curve;
}

export interface BooleanParamMeta extends ParamMetaBase {
  readonly kind: 'boolean';
  readonly default: boolean;
}

export interface ChoiceParamMeta extends ParamMetaBase {
  readonly kind: 'choice';
  readonly default: string;
  readonly choices: readonly string[];
}

export type ParamMeta = NumberParamMeta | BooleanParamMeta | ChoiceParamMeta;

/** What a node definition writes for each parameter. `name` comes from the key; the rest default sensibly. */
export type ParamMetaInput =
  | (Omit<NumberParamMeta, 'name' | 'kind' | 'rate' | 'unit' | 'curve'> & {
      kind?: 'number';
      rate?: ParamRate;
      unit?: Unit;
      curve?: Curve;
    })
  | (Omit<BooleanParamMeta, 'name' | 'rate' | 'kind'> & { kind?: 'boolean'; rate?: ParamRate })
  | (Omit<ChoiceParamMeta, 'name' | 'rate' | 'kind'> & { kind?: 'choice'; rate?: ParamRate });

/**
 * When an operation takes effect, in audio-clock seconds (`context.currentTime` units).
 * Omitted: the current sequence event's time when called synchronously inside a transport callback,
 * otherwise "now".
 */
export interface At {
  at?: number;
}

export interface RampOptions extends At {
  /** Seconds. */
  duration: number;
  /** Shape of the ramp. `exp` cannot reach exactly 0; the library substitutes a very small value. */
  curve?: 'linear' | 'exp';
  /** Start value. Defaults to the parameter's value at `at`. */
  from?: number;
}

export interface OffsetOptions extends At {
  /** Seconds the offset lasts before the parameter returns to its base value. Omitted: until cleared. */
  duration?: number;
}

/** One audio-rate modulation connection onto a parameter. */
export interface Modulation {
  readonly source: Node;
  readonly target: Param<number>;
  /** Removes the connection. */
  disconnect(): void;
}

export type Unsubscribe = () => void;

export interface ParamChange<T extends ParamValue = ParamValue> {
  readonly param: Param<T>;
  readonly value: T;
  readonly previous: T;
  /** Audio time at which the change takes effect. */
  readonly at: number;
}

export interface Param<T extends ParamValue = ParamValue> {
  readonly node: Node;
  readonly name: string;
  readonly meta: ParamMeta;

  /**
   * The base value. Always readable, including 0 and false. Does not include offsets, ramps in flight,
   * or audio-rate modulation.
   */
  readonly value: T;

  /** Sets the base value. */
  set(value: T, options?: At): this;

  /** Base value as 0..1 through the parameter's curve, for controls. Number parameters only. */
  readonly normalized: number;
  setNormalized(position: number, options?: At): this;

  /** Ramps the base value. Number parameters with rate `audio` only. */
  ramp(target: number, options: RampOptions): this;

  /**
   * Adds a temporary amount on top of the base value without changing it. A later offset replaces an
   * earlier one. Number parameters only.
   */
  offset(amount: number, options?: OffsetOptions): this;
  clearOffset(options?: At): this;

  /** Cancels ramps and offsets scheduled at or after the given time. */
  cancel(options?: At): this;

  /** Returns the base value to the metadata default. */
  reset(options?: At): this;

  /** Audio-rate sources currently connected to this parameter. */
  readonly modulators: readonly Modulation[];

  /** Fires when the base value changes. Does not fire for offsets or modulation. */
  on(event: 'change', listener: (change: ParamChange<T>) => void): Unsubscribe;
  on(event: 'modulators', listener: (modulators: readonly Modulation[]) => void): Unsubscribe;
}

/** Conversions between a unit and the parameter's native value, in both directions. */
export interface UnitConversion {
  readonly unit: Unit;
  toNative(value: number): number;
  fromNative(native: number): number;
  format(native: number): string;
}
