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

export interface EchoParams {
  /** Seconds between repeats. */
  time: number;
  /** 0..1: how much of each repeat is fed back to make the next. */
  feedback: number;
  /** Hz: lowpass on the fed-back sound. */
  cutoff: number;
  /** 0 is only the original sound, 1 only the effect. */
  mix: number;
}

/** The parameters of `multiband`: two crossovers, then a threshold, ratio and level for each of three bands. */
export interface MultibandParams {
  /** Hz: where the low band ends and the middle band begins. */
  lowCrossover: number;
  /** Hz: where the middle band ends and the high band begins. */
  highCrossover: number;
  /** Decibels. */
  lowThreshold: number;
  lowRatio: number;
  /** Decibels, after the band's compressor. */
  lowGain: number;
  midThreshold: number;
  midRatio: number;
  midGain: number;
  highThreshold: number;
  highRatio: number;
  highGain: number;
  /** Seconds, for every band. */
  attack: number;
  release: number;
  /** 0 is only the original sound, 1 only the compressed. */
  mix: number;
}

export interface TapeDelayParams {
  /** Seconds between repeats. A change glides. */
  time: number;
  /** 0..1.1: above 1 the repeats grow instead of fading. */
  feedback: number;
  /** 0..1: slow pitch drift. */
  wow: number;
  /** 0..1: fast pitch shimmer. */
  flutter: number;
  /** Hz: lowpass on the repeats. */
  tone: number;
  /** Hz: highpass on the repeats. */
  lowCut: number;
  /** 0..1: saturation. */
  drive: number;
  /** 0 is only the original sound, 1 only the repeats. */
  mix: number;
}

export type SynthShape = 'sine' | 'saw' | 'square' | 'triangle';

/** The parameters `monosynth` and `polysynth` share. */
export interface SynthParams extends EnvelopeParams {
  /** Hz: lowpass frequency. */
  cutoff: number;
  /** Emphasis at the cutoff (the filter's q). */
  resonance: number;
  /** Cents. */
  detune: number;
  /** Hz: speed of the pitch wobble. */
  lfoRate: number;
  /** Hz of pitch movement each side. */
  lfoDepth: number;
  gain: number;
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
  /** A lowpass for control signals: glides to a new value without overshoot, exact in every browser. */
  smooth: NodeShape<None, { frequency?: number }>;
  sine: NodeShape<OscillatorParams, OscillatorInit, number, GateTrigger>;
  saw: NodeShape<OscillatorParams, OscillatorInit, number, GateTrigger>;
  square: NodeShape<OscillatorParams, OscillatorInit, number, GateTrigger>;
  triangle: NodeShape<OscillatorParams, OscillatorInit, number, GateTrigger>;
  noise: NodeShape<
    { gain: number },
    OscillatorInit & { color?: 'white' | 'pink' | 'brown' },
    never,
    GateTrigger
  >;
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
      shape?: 'sine' | 'saw' | 'square' | 'triangle';
      /** Shorthand: when chained into another node, connect to this parameter of it instead of its input. */
      modulates?: string;
    }
  >;
  stepper: NodeShape<
    { depth: number },
    {
      /** Random values per loop. Default 8. */
      steps?: number;
      /** Seconds per loop. Default 1. */
      length?: number;
      /** Connect to this parameter of the next node instead of its input. Default `frequency`. */
      modulates?: string;
    }
  >;
  delay: NodeShape<EchoParams, None, number>;
  comb: NodeShape<EchoParams, None, number>;
  /** A delay and nothing else, for building feedback loops and modulated delays. */
  delayline: NodeShape<{ time: number }, None, number>;
  reverb: NodeShape<
    { mix: number },
    { seconds?: number; decay?: number; reverse?: boolean; impulse?: BufferSource }
  >;
  overdrive: NodeShape<{ drive: number; color: number; postCut: number }, None, number>;
  waveshaper: NodeShape<
    { drive: number },
    {
      /** Default '4x', which makes the sound up to 4 ms late. 'none' adds no lateness. */
      oversample?: 'none' | '2x' | '4x';
    },
    number
  >;
  ring: NodeShape<{ frequency: number; mix: number }, None, number>;
  bitcrusher: NodeShape<{ bits: number; rate: number }>;
  compressor: NodeShape<
    {
      threshold: number;
      knee: number;
      ratio: number;
      attack: number;
      release: number;
    },
    {
      /** false: sound below the threshold keeps its level; the compressor's own make-up gain is taken out. Default true. */
      makeup?: boolean;
    }
  >;
  recorder: NodeShape<
    { latency: number },
    {
      /** Store key the recording is written to. Default: the node's id. */
      into?: string;
      /** 1 or 2. Default 2. */
      channels?: number;
    },
    never,
    {
      /** Seconds to record for. Omitted: until `release()`. */
      duration?: number;
      /** Store key for this take, instead of the node's `into`. */
      key?: string;
    }
  >;
  looper: NodeShape<
    { gain: number; monitor: number; overdub: number; latency: number },
    {
      /** Loop length for the first layer. Default '1 bar'. */
      length?: import('./transport').Duration;
      channels?: number;
    },
    never,
    {
      /** Loop length, when this trigger records the first layer. */
      length?: import('./transport').Duration;
      /** How many times round the loop to record. Default 1. 0 records until `release()`. */
      cycles?: number;
    }
  >;
  input: NodeShape<
    { gain: number },
    {
      /** Which input device, from `navigator.mediaDevices.enumerateDevices()`. Default: the system's. */
      deviceId?: string;
      /** A stream the host already has, used instead of asking for the microphone. */
      stream?: MediaStream;
      /** Leave the browser's echo cancellation, noise suppression and gain control on. Default false. */
      processing?: boolean;
    }
  >;
  monosynth: NodeShape<SynthParams, { shape?: SynthShape }, never, NoteTrigger>;
  polysynth: NodeShape<SynthParams, { shape?: SynthShape; voices?: number }, never, NoteTrigger>;
  multiband: NodeShape<MultibandParams>;
  tapedelay: NodeShape<TapeDelayParams, None, number>;
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
  /** The id of the node being built. */
  readonly id: string;
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
  /**
   * A place in the engine's buffer store for audio this node produces (a recording). The entry exists
   * from now on, so samplers can be given its key before anything has been recorded; each `write`
   * replaces its audio and fires the store's `ready` event.
   */
  bufferSink(key: string): { readonly ref: BufferRef; write(buffer: AudioBuffer): void };
  /** Seconds a musical duration lasts at the transport's current tempo. */
  seconds(duration: import('./transport').Duration): number;
  /** Reports a failure that happens after `build` has returned, such as a refused microphone. */
  report(message: string, cause?: unknown): void;
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

/**
 * Describes one option that is not a parameter, for documentation and editor help. The library does
 * not check values against it.
 */
export interface OptionInfo {
  /** The accepted type, written the way a person would read it: `'boolean'`, `"'open' | 'closed'"`. */
  readonly type: string;
  /** The default, as text. Omit when the option has none. */
  readonly default?: string;
  readonly description: string;
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
  /**
   * For modulators: the parameter this node drives when it is chained into another node, unless the
   * caller passes its own `modulates` option. `__().lfo().lowpass()` then moves the filter's frequency
   * instead of feeding its input.
   */
  readonly modulates?: string;
  /** Documents the creation-only options `build` reads from `init`. */
  readonly options?: Readonly<Record<string, OptionInfo>>;
  /** Documents the options `trigger()` accepts besides `at` and per-voice parameter values. */
  readonly triggerOptions?: Readonly<Record<string, OptionInfo>>;
  build(context: BuildContext, init: Readonly<Record<string, unknown>>): BuiltNode;
}

/**
 * An exposed macro parameter and the inner parameters it drives. The targets are looked up each time
 * the parameter changes, so nodes the macro makes later are included. A parameter may drive nothing
 * (`drives: []`) when the macro only reads it through `MacroContext.value`.
 */
export type MacroParam = ParamMetaInput & {
  /** Inner targets, selected within the macro's own scope. `scale` converts the value on the way. */
  drives: readonly { select: string; param: string; scale?: DriveScale }[];
};

/**
 * How an exposed value becomes an inner one: a function, or `value * multiply + add` as data. Use
 * the data form in a macro defined inside a sandbox, where a function cannot travel to the host.
 */
export type DriveScale = ((value: number) => number) | { multiply?: number; add?: number };

export interface MacroDefinition<K extends string = string> {
  readonly type: K;
  readonly category?: NodeCategory;
  readonly description?: string;
  readonly params: Readonly<Record<string, MacroParam>>;
  readonly shorthand?: string;
  readonly options?: Readonly<Record<string, OptionInfo>>;
  readonly triggerOptions?: Readonly<Record<string, OptionInfo>>;
  /**
   * Builds the inner graph. `scope` is private to this instance, so inner ids never collide with
   * another instance's. Two buses exist in it from the start:
   * - `out`: send to it (`.to('out')`) and that is the macro's output.
   * - `in`: whatever is connected to the macro arrives here. Continue from it with
   *   `scope.bus('in').chain()`.
   * A macro that never uses `in` has no input, and one that never sends to `out` has no output.
   */
  build(scope: ScopeApi, init: Readonly<Record<string, unknown>>, macro: MacroContext): void;
  /** Inside `trigger`, `release` and methods, operations with no `at` happen at the call's time. */
  trigger?(scope: ScopeApi, options: At & Record<string, unknown>, macro: MacroContext): void;
  release?(scope: ScopeApi, options: ReleaseOptions, macro: MacroContext): void;
  /**
   * The macro's own operations, reachable as `node.call(name, args)` and as `call` commands. Each
   * receives the instance's private scope and the audio time the call applies at.
   */
  methods?: Record<
    string,
    (
      scope: ScopeApi,
      args: Readonly<Record<string, unknown>>,
      at: number,
      macro: MacroContext,
    ) => void
  >;
}

/** What a macro's functions can ask about the instance they are running for. */
export interface MacroContext {
  /** The instance's id. */
  readonly id: string;
  /** The audio time the current call applies at. */
  readonly time: number;
  /**
   * The value of one of the macro's own exposed parameters at an audio time. For macros that make
   * nodes after `build` (a synth making a voice per note) and need the settings to give them.
   */
  value(name: string, at?: number): ParamValue;
  /** Seeded random source. Returns 0 <= n < 1. */
  random(): number;
}

/** Runtime description of a registered type, as exported to hosts for controls, docs and autocomplete. */
export interface NodeTypeInfo {
  readonly type: string;
  readonly category: NodeCategory;
  readonly description: string;
  readonly isMacro: boolean;
  readonly triggerable: boolean;
  readonly shorthand: string | null;
  /** For a modulator: the parameter of the next node in a chain that it connects to by default. */
  readonly modulates: string | null;
  readonly params: readonly import('./params').ParamMeta[];
  /** Creation-only options, by name. */
  readonly options: Readonly<Record<string, OptionInfo>>;
  /** Options `trigger()` accepts, by name. Empty when the type cannot be triggered. */
  readonly triggerOptions: Readonly<Record<string, OptionInfo>>;
}

export interface Registry {
  register(definition: NodeDefinition | MacroDefinition): void;
  has(type: string): boolean;
  describe(type: string): NodeTypeInfo;
  list(): readonly NodeTypeInfo[];
}
