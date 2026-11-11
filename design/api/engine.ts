/**
 * The engine: one audio context and everything built on it.
 *
 * All library state belongs to an Engine. Several can exist at once. An engine on an
 * OfflineAudioContext behaves the same as a live one, which is how the library is tested and how
 * hosts render audio faster than real time.
 */

import type { Unsubscribe } from './params';
import type { MacroDefinition, NodeDefinition, Registry } from './nodes';
import type { Bus, Chain, GraphError, Scope, ScopeApi, Selection } from './graph';
import type { NodeType } from './nodes';
import type { Duration, Transport } from './transport';

export interface EngineOptions {
  /** The context to build on. The caller owns it: the engine never creates or closes one. */
  context: BaseAudioContext;
  /** Seed for the engine's random source. Default: a fixed seed offline, a time-based seed live. */
  seed?: number;
  /** Extra node types to register alongside the built-in ones. */
  nodes?: readonly (NodeDefinition | MacroDefinition)[];
  /**
   * Where to load the library's AudioWorklet module from. Needed when the bundler does not resolve it
   * automatically, or under a content security policy that forbids blob URLs.
   */
  workletUrl?: string | URL;
}

/** Loads worklet modules and returns a ready engine. */
export declare function createEngine(options: EngineOptions): Promise<Engine>;

// ---------------------------------------------------------------------------------------------------
// Buffers
// ---------------------------------------------------------------------------------------------------

/** A URL to load, a key already in the store, or audio the host has in hand. */
export type BufferSource = string | AudioBuffer | BufferRef;

export interface BufferRef {
  readonly key: string;
  readonly state: 'loading' | 'ready' | 'error';
  readonly buffer: AudioBuffer | null;
  readonly error: Error | null;
  /** Resolves when decoded; rejects on a load or decode failure. */
  readonly ready: Promise<AudioBuffer>;
  /** Seconds. null until ready. */
  readonly duration: number | null;
  /**
   * Slice boundaries in seconds, ascending, starting at 0 and ending at the duration. Samplers
   * triggered with `{ slice: n }` play from boundary n to boundary n + 1.
   */
  slices: readonly number[];
}

/** Decodes each source once and shares the result between every node that uses it. */
export interface BufferStore {
  /** Fetches and decodes a URL, or returns the existing entry for it. */
  load(url: string, options?: { key?: string; signal?: AbortSignal }): BufferRef;
  /** Registers audio the host already has. Encoded data is decoded; an AudioBuffer is used as is. */
  add(key: string, data: AudioBuffer | ArrayBuffer): BufferRef;
  get(key: string): BufferRef | undefined;
  delete(key: string): boolean;
  on(event: 'ready' | 'error', listener: (ref: BufferRef) => void): Unsubscribe;
}

// ---------------------------------------------------------------------------------------------------
// Random
// ---------------------------------------------------------------------------------------------------

/** Seeded, so an offline render with the same seed is identical every time. */
export interface Random {
  seed(value: number): void;
  /** 0 <= n < 1. */
  float(): number;
  /** Integer from min to max, both included. */
  int(min: number, max: number): number;
  /** True with the given probability from 0 to 1. */
  chance(probability: number): boolean;
  pick<T>(items: readonly T[]): T | undefined;
  /** Returns a shuffled copy. */
  shuffle<T>(items: readonly T[]): T[];
}

// ---------------------------------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------------------------------

export interface EngineEvents {
  error: (error: GraphError) => void;
  /** The live context's state changed (for example, suspended by the browser until a user gesture). */
  state: (state: AudioContextState) => void;
}

export interface RenderOptions {
  /** How much to render. Default: the offline context's full length. */
  length?: { seconds: number } | { musical: Duration };
}

export interface Engine {
  readonly context: BaseAudioContext;
  /** True when built on an OfflineAudioContext. */
  readonly offline: boolean;

  readonly transport: Transport;
  readonly buffers: BufferStore;
  readonly registry: Registry;
  readonly random: Random;

  /** The top scope. Its `main` bus feeds the context destination. */
  readonly root: Scope;

  /** Conveniences that act on the root scope. */
  readonly $: ScopeApi;
  scope(name: string): Scope;
  chain(): Chain;
  select<T extends NodeType>(selector: T): Selection<T>;
  select(selector: string): Selection;
  bus(name: string): Bus;

  /** Resumes a live context. Call from a user gesture; browsers start contexts suspended. */
  resume(): Promise<void>;

  /**
   * Offline engines only. Runs the transport and every scheduled callback across the render length,
   * then renders. Callbacks receive the same event objects as in live playback.
   */
  render(options?: RenderOptions): Promise<AudioBuffer>;

  on<E extends keyof EngineEvents>(event: E, listener: EngineEvents[E]): Unsubscribe;

  /** Disposes all scopes and stops the scheduler. The context is left open; its owner closes it. */
  dispose(): void;
}
