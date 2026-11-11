/**
 * Node types and how they are defined.
 *
 * Every node type, built-in or user-made, is described by one definition object that declares its
 * parameters. The chain methods (`.lowpass()`, `.sampler()`), the runtime metadata, the exported JSON
 * for host autocomplete, and the TypeScript types below all come from those definitions.
 *
 * The NodeTypeMap here lists a representative subset so the rest of the API can be type-checked.
 * In the implementation it is generated from the definitions.
 */

import type { At, ParamMetaInput, ParamValue } from './params';
import type { BufferRef, BufferSource } from './engine';
import type { ScopeApi } from './graph';

type None = Record<never, never>;

/**
 * The compile-time shape of one node type.
 * - `params`: live parameters (each becomes a Param).
 * - `init`: creation-only options that are not parameters, such as a buffer.
 * - `shorthand`: what a bare argument means, e.g. `.gain(0.5)`.
 * - `trigger`: extra options `trigger()` accepts, or null if the node cannot be triggered.
 */
export interface NodeShape<
  P extends object = None,
  I extends object = None,
  S = never,
  T extends object | null = null,
> {
  params: P;
  init: I;
  shorthand: S;
  trigger: T;
}

export interface FilterParams {
  frequency: number;
  q: number;
}

export interface ShelfParams {
  frequency: number;
  /** Boost or cut in decibels. */
  gain: number;
}

export interface OscillatorParams {
  frequency: number;
  detune: number;
}

export interface SamplerParams {
  /** Playback rate. Negative is not reverse; use `reverse`. */
  speed: number;
  /** Start and end of the played region, in seconds of the buffer. An `end` at or before `start` means the end of the buffer. */
  start: number;
  end: number;
  loop: boolean;
  reverse: boolean;
  gain: number;
}

export interface EnvelopeParams {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

export interface OscillatorInit {
  /**
   * Oscillators run from creation. With the gate open (the default) they are heard at once, as a drone;
   * `release()` closes the gate and `trigger()` opens it. Start with `'closed'` for a voice that is
   * silent until triggered.
   */
  gate?: 'open' | 'closed';
}

/** Options for anything with a gate: oscillators behind an envelope, envelopes, synth voices. */
export interface GateTrigger {
  /** Seconds until an automatic release. Omitted: held until `release()`. */
  duration?: number;
  /** 0..1. */
  velocity?: number;
}

export interface SamplerTrigger extends GateTrigger {
  /** Index into the buffer's slice boundaries. Overrides `start` and `end` for this voice. */
  slice?: number;
}

export interface NoteTrigger extends GateTrigger {
  /** MIDI note number; fractional values are allowed. */
  pitch: number;
}

/** Augment this interface (declaration merging) when registering custom node types. */
export interface NodeTypeMap {
  gain: NodeShape<{ gain: number }, None, number>;
  panner: NodeShape<{ pan: number }, None, number>;
  lowpass: NodeShape<FilterParams, None, number>;
  highpass: NodeShape<FilterParams, None, number>;
  bandpass: NodeShape<FilterParams, None, number>;
  notch: NodeShape<FilterParams, None, number>;
  allpass: NodeShape<FilterParams, None, number>;
  lowshelf: NodeShape<ShelfParams, None, number>;
  highshelf: NodeShape<ShelfParams, None, number>;
  peaking: NodeShape<FilterParams & { gain: number }, None, number>;
  sine: NodeShape<OscillatorParams, OscillatorInit, number, GateTrigger>;
  saw: NodeShape<OscillatorParams, OscillatorInit, number, GateTrigger>;
  square: NodeShape<OscillatorParams, OscillatorInit, number, GateTrigger>;
  triangle: NodeShape<OscillatorParams, OscillatorInit, number, GateTrigger>;
  noise: NodeShape<{ gain: number }, { color?: 'white' | 'pink' | 'brown' }>;
  sampler: NodeShape<
    SamplerParams,
    {
      buffer?: BufferSource;
      /** A new trigger cuts off voices that are still sounding. Default true. */
      choke?: boolean;
      /** Maximum simultaneous voices when `choke` is false. */
      voices?: number;
    },
    never,
    SamplerTrigger
  >;
  adsr: NodeShape<EnvelopeParams, None, never, GateTrigger>;
  lfo: NodeShape<
    { frequency: number; depth: number },
    {
      shape?: 'sine' | 'saw' | 'square' | 'triangle' | 'random';
      /** Shorthand: when chained into another node, connect to this parameter of it instead of its input. */
      modulates?: string;
    }
  >;
  delay: NodeShape<
    { time: number; feedback: number; damping: number; cutoff: number; mix: number },
    None,
    number
  >;
  reverb: NodeShape<
    { mix: number },
    { seconds?: number; decay?: number; reverse?: boolean; impulse?: BufferSource }
  >;
  overdrive: NodeShape<{ drive: number; color: number; postCut: number }, None, number>;
  bitcrusher: NodeShape<{ bits: number; rate: number }>;
  compressor: NodeShape<{
    threshold: number;
    knee: number;
    ratio: number;
    attack: number;
    release: number;
  }>;
  polysynth: NodeShape<
    {
      cutoff: number;
      resonance: number;
      attack: number;
      decay: number;
      sustain: number;
      release: number;
      lfoRate: number;
      lfoDepth: number;
      gain: number;
    },
    { shape?: 'sine' | 'saw' | 'square' | 'triangle'; voices?: number },
    never,
    NoteTrigger
  >;
}

export type NodeType = keyof NodeTypeMap & string;
export type ParamsOf<K extends NodeType> = NodeTypeMap[K]['params'];
export type TriggerOf<K extends NodeType> = NodeTypeMap[K]['trigger'];

/** Options every node accepts at creation. */
export interface CommonInit {
  /** Unique within the node's scope. Generated when omitted; give one to anything a host or script refers to. */
  id?: string;
  /** One or more classes. A string may hold several, separated by spaces. */
  class?: string | readonly string[];
  /** Arbitrary key/value tags, matched by attribute selectors such as `[role=send]`. */
  tags?: Readonly<Record<string, string | number | boolean>>;
  bypass?: boolean;
}

/** What a chain method accepts: `.lowpass({ frequency: 800, id: 'filter' })`. */
export type NodeInit<K extends NodeType> = Partial<ParamsOf<K>> &
  NodeTypeMap[K]['init'] &
  CommonInit;

/** `trigger()` options for a node type: timing, the type's own options, and per-voice parameter overrides. */
export type TriggerOptions<K extends NodeType = NodeType> = [NodeType] extends [K]
  ? LooseTriggerOptions
  : At & (TriggerOf<K> extends object ? TriggerOf<K> : GateTrigger) & Partial<ParamsOf<K>>;

/** `trigger()` options when the node type is not known statically (a selection made from a selector string). */
export type LooseTriggerOptions = At &
  GateTrigger & { slice?: number; pitch?: number } & {
    readonly [param: string]: ParamValue | undefined;
  };

/** Parameter names of a node type; any string when the type is not known statically. */
export type ParamNameOf<K extends NodeType> = [NodeType] extends [K]
  ? string
  : keyof ParamsOf<K> & string;

/** Parameter values of a node type; any name to value map when the type is not known statically. */
export type ParamValuesOf<K extends NodeType> = [NodeType] extends [K]
  ? Readonly<Record<string, ParamValue>>
  : Partial<ParamsOf<K>>;

export interface ReleaseOptions extends At {
  /** For polyphonic nodes: which note to release. Omitted: all. */
  pitch?: number;
}

// ---------------------------------------------------------------------------------------------------
// Defining node types
// ---------------------------------------------------------------------------------------------------

export type NodeCategory =
  | 'source'
  | 'filter'
  | 'dynamics'
  | 'delay'
  | 'distortion'
  | 'modulator'
  | 'envelope'
  | 'utility'
  | 'io'
  | 'synth';

/** What `build` receives. Everything a node needs comes from here; nothing is global. */
export interface BuildContext {
  readonly audio: BaseAudioContext;
  /** Seeded random source, so offline renders repeat exactly. Returns 0 <= n < 1. */
  random(): number;
  /** Resolves a buffer source through the engine's shared store. The entry may still be loading. */
  buffer(source: BufferSource): BufferRef;
  /**
   * The effective value of one of this node's own parameters at an audio time (base value plus any
   * offset active then). For nodes that create voices on trigger and need the value the voice starts with.
   */
  value(name: string, at: number): ParamValue;
  /** Creates an AudioWorkletNode for a processor the library or the host has registered. */
  worklet(name: string, options?: AudioWorkletNodeOptions): AudioWorkletNode;
}

/** A parameter that is not a plain AudioParam: called with the value and the audio time it applies at. */
export type ParamHandler = (value: ParamValue, at: number) => void;

/** What `build` returns: the native pieces the library wires up and controls. */
export interface BuiltNode {
  /** Where incoming connections attach. Omit for pure sources. */
  input?: AudioNode;
  /** Where outgoing connections leave. Omit for sinks. */
  output?: AudioNode;
  /** How each declared parameter is applied. */
  params: Record<string, AudioParam | ParamHandler>;
  trigger?(options: At & Record<string, unknown>, at: number): void;
  release?(options: ReleaseOptions, at: number): void;
  /** Extra operations, reachable as `node.call(name, args)` and as `call` commands. */
  methods?: Record<string, (args: Readonly<Record<string, unknown>>, at: number) => void>;
  dispose?(): void;
}

export interface NodeDefinition<K extends string = string> {
  readonly type: K;
  readonly category: NodeCategory;
  readonly description?: string;
  readonly params: Readonly<Record<string, ParamMetaInput>>;
  /** Which parameter a bare argument sets, e.g. `'frequency'` so that `.lowpass(800)` works. */
  readonly shorthand?: string;
  /** Whether `trigger()` and `release()` do anything on this type. */
  readonly triggerable?: boolean;
  build(context: BuildContext, init: Readonly<Record<string, unknown>>): BuiltNode;
}

/** An exposed macro parameter and the inner parameters it drives. */
export type MacroParam = ParamMetaInput & {
  /** Inner targets, selected within the macro's own scope. */
  drives: readonly { select: string; param: string; scale?: (value: number) => number }[];
};

export interface MacroDefinition<K extends string = string> {
  readonly type: K;
  readonly category?: NodeCategory;
  readonly description?: string;
  readonly params: Readonly<Record<string, MacroParam>>;
  readonly shorthand?: string;
  /**
   * Builds the inner graph. `scope` is private to this instance, so inner ids never collide with
   * another instance's. Connect to `scope.bus('in')` and `scope.bus('out')` to expose the macro's ports.
   */
  build(scope: ScopeApi, init: Readonly<Record<string, unknown>>): void;
  trigger?(scope: ScopeApi, options: At & Record<string, unknown>): void;
  release?(scope: ScopeApi, options: ReleaseOptions): void;
  /**
   * The macro's own operations, reachable as `node.call(name, args)` and as `call` commands. Each
   * receives the instance's private scope and the audio time the call applies at.
   */
  methods?: Record<
    string,
    (scope: ScopeApi, args: Readonly<Record<string, unknown>>, at: number) => void
  >;
}

/** Runtime description of a registered type, as exported to hosts for controls, docs and autocomplete. */
export interface NodeTypeInfo {
  readonly type: string;
  readonly category: NodeCategory;
  readonly description: string;
  readonly isMacro: boolean;
  readonly triggerable: boolean;
  readonly shorthand: string | null;
  readonly params: readonly import('./params').ParamMeta[];
}

export interface Registry {
  register(definition: NodeDefinition | MacroDefinition): void;
  has(type: string): boolean;
  describe(type: string): NodeTypeInfo;
  list(): readonly NodeTypeInfo[];
}
