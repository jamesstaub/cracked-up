/**
 * The graph: nodes, selections, chains, scopes, buses, and the graph as plain data.
 *
 * Nothing here is global. A Selection owns its node list. A Chain owns its tail. A Scope owns its
 * subtree and its id namespace.
 */

import type { At, OffsetOptions, Param, ParamValue, RampOptions, Unsubscribe } from './params';
import type {
  NodeInit,
  NodeType,
  NodeTypeMap,
  ParamNameOf,
  ParamsOf,
  ParamValuesOf,
  ReleaseOptions,
  TriggerOptions,
} from './nodes';
import type { Engine } from './engine';

// ---------------------------------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------------------------------

export type Tags = Readonly<Record<string, string | number | boolean>>;

export interface Node<K extends NodeType = NodeType> {
  /** Unique within `scope`. Stable for the node's life; the key used by graph descriptions. */
  readonly id: string;
  readonly type: K;
  readonly classes: ReadonlySet<string>;
  readonly tags: Tags;
  readonly scope: Scope;
  /** The macro instance this node is inside, if any. */
  readonly parent: Node | null;
  readonly disposed: boolean;

  readonly params: { readonly [P in keyof ParamsOf<K>]: Param<ParamsOf<K>[P] & ParamValue> };
  /** Untyped lookup, for hosts that work from metadata. Throws if the node has no such parameter. */
  param(name: string): Param;

  bypass: boolean;

  /** Every recorded connection, both directions. */
  readonly inputs: readonly Edge[];
  readonly outputs: readonly Edge[];

  connect(target: Node | Bus | Param<number>): this;
  disconnect(target?: Node | Bus | Param<number>): this;

  /** Starts a voice or opens the gate. A no-op (with a debug warning) on nodes that cannot be triggered. */
  trigger(options?: TriggerOptions<K>): this;
  release(options?: ReleaseOptions): this;

  /** Calls a method the node's definition declares (see `methods` on node and macro definitions). */
  call(method: string, args?: Readonly<Record<string, Json>>, options?: At): this;

  /** Native output, for hosts that need to attach their own analyser or visualiser. Read-only use. */
  readonly output: AudioNode | null;

  dispose(): void;
}

export interface Edge {
  readonly from: Node;
  readonly to: Node | Bus | Param<number>;
}

// ---------------------------------------------------------------------------------------------------
// Selections
// ---------------------------------------------------------------------------------------------------

/**
 * An immutable list of nodes with methods that act on all of them. Selecting never changes any shared
 * state, so a selection made in one callback cannot affect code running in another.
 *
 * A selection made with a bare type name (`select('sampler')`) is typed to that node type, so parameter
 * names and values are checked. One made with any other selector accepts any parameter name; nodes
 * that lack the parameter are skipped at runtime.
 *
 * Selector grammar (a subset of CSS):
 *   sampler            type
 *   #kick              id, unique within the scope searched
 *   .wet   .a.b        class; compound classes match in any order
 *   [role=send] [solo] tag equals / tag present
 *   polysynth lowpass  descendant: inside a macro, at any depth
 *   delay > gain       child: directly inside
 *   sine, saw          list (whitespace is ignored)
 *   :not(.muted)       negation
 *   lowpass:nth(1)     the second match, counting from 0 in creation order
 *   *                  everything in the scope, excluding macro internals
 *
 * Macro internals are never matched by a plain selector. Reach them with a descendant selector
 * (`polysynth lowpass`, `polysynth *`) or with `selection.select(...)` on the macro.
 */
export interface SelectionBase<K extends NodeType = NodeType> extends Iterable<Node<K>> {
  readonly length: number;
  readonly nodes: readonly Node<K>[];
  first(): Node<K> | undefined;
  at(index: number): Node<K> | undefined;

  /** Searches inside the selected nodes (macro internals). */
  select<T extends NodeType>(selector: T): Selection<T>;
  select(selector: string): Selection;
  filter(selector: string): Selection<K>;
  filter(predicate: (node: Node<K>, index: number) => boolean): Selection<K>;
  each(fn: (node: Node<K>, index: number) => void): this;

  /** Sets base values on every selected node that has the parameter; others are skipped. */
  set(values: ParamValuesOf<K>, options?: At): this;
  ramp(param: ParamNameOf<K>, target: number, options: RampOptions): this;
  offset(param: ParamNameOf<K>, amount: number, options?: OffsetOptions): this;

  /** The named parameter of each selected node that has it. */
  params(name: ParamNameOf<K>): readonly Param[];
  /** The named parameter of the first selected node. Throws if the selection is empty. */
  param(name: ParamNameOf<K>): Param;

  trigger(options?: TriggerOptions<K>): this;
  release(options?: ReleaseOptions): this;
  call(method: string, args?: Readonly<Record<string, Json>>, options?: At): this;

  /** Connects every selected node to the target. */
  connect(target: string | Selection | Node | Bus | Param<number>): this;
  /** Connects every selected node to a named bus, resolved from the selection's scope outward. */
  to(bus: string | Bus): this;
  disconnect(): this;

  /** Starts a chain whose first new node is fed by every selected node (fan-in). */
  chain(): Chain;

  dispose(): void;
}

type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (
  x: infer I,
) => void
  ? I
  : never;
type AnyParams = UnionToIntersection<NodeTypeMap[NodeType]['params']>;

/**
 * One setter per parameter name, generated from the registered node types: `.frequency(200)`,
 * `.gain(0.5, { at })`. Each is shorthand for `.set({ name: value })`.
 *
 * A parameter whose name is already a selection method gets no setter and is set with `.set()`.
 * Today that is only `release` (on envelopes and compressors), which is the gate-release method.
 */
export type SelectionSetters<K extends NodeType> = [NodeType] extends [K]
  ? {
      readonly [P in Exclude<keyof AnyParams & string, keyof SelectionBase>]: (
        value: ParamValue,
        options?: At,
      ) => Selection;
    }
  : {
      readonly [P in Exclude<keyof ParamsOf<K> & string, keyof SelectionBase>]: (
        value: ParamsOf<K>[P],
        options?: At,
      ) => Selection<K>;
    };

export type Selection<K extends NodeType = NodeType> = SelectionBase<K> & SelectionSetters<K>;

// ---------------------------------------------------------------------------------------------------
// Chains
// ---------------------------------------------------------------------------------------------------

interface ChainBase {
  /** The node or nodes the next call will connect from. */
  readonly tail: Selection;
  /** Every node this chain has created, in order. */
  readonly nodes: Selection;

  /** Ends the chain at a named bus. */
  to(bus: string | Bus): Chain;
  /** Connects the tail to existing nodes or a parameter; the chain continues from the same tail. */
  connect(target: string | Selection | Node | Bus | Param<number>): Chain;
  /** Connects the tail to a parameter of the target, for modulators. */
  modulate(target: string | Selection | Node, param: string): Chain;
  /**
   * Parallel branches. Each function receives a chain starting at the current tail; the chain then
   * continues from all branch tails together.
   */
  split(...branches: readonly ((branch: Chain) => Chain)[]): Chain;
}

/**
 * One method per registered node type. Each creates a node, connects the current tail to it (or to the
 * parameter named by `modulates`), and returns the chain with the new node as its tail.
 */
export type Chain = ChainBase & {
  readonly [K in NodeType]: (init?: NodeInit<K> | NodeTypeMap[K]['shorthand']) => Chain;
};

// ---------------------------------------------------------------------------------------------------
// Buses
// ---------------------------------------------------------------------------------------------------

/**
 * A named mix point: several chains go in, one signal comes out. The library attaches no meaning to
 * the names. The only bus that exists by default is the engine's `main`, which feeds the context
 * destination. Every other bus is created by the caller and feeds `main` until told otherwise.
 */
export interface Bus {
  readonly name: string;
  readonly scope: Scope;
  readonly gain: Param<number>;
  /** Where this bus sends its mix. Default: the engine's `main` bus. */
  to(target: string | Bus): this;
  /** Starts a chain fed by this bus's mix, for processing everything sent to it. */
  chain(): Chain;
  readonly input: AudioNode;
  readonly output: AudioNode;
}

// ---------------------------------------------------------------------------------------------------
// The graph as data
// ---------------------------------------------------------------------------------------------------

export type Json =
  string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json };

export interface NodeData {
  id: string;
  type: string;
  classes?: readonly string[];
  tags?: Tags;
  /** Base values. Parameters left out take the type's defaults. */
  params?: Readonly<Record<string, ParamValue>>;
  /** Creation-only options. Buffers appear as keys into the engine's buffer store. */
  init?: Readonly<Record<string, Json>>;
  bypass?: boolean;
}

export type EdgeTarget = { node: string } | { node: string; param: string } | { bus: string };

export interface EdgeData {
  from: string;
  to: EdgeTarget;
}

/** A scope's graph as plain, serializable data. */
export interface GraphData {
  nodes: readonly NodeData[];
  edges: readonly EdgeData[];
}

export interface ApplyResult {
  readonly added: readonly Node[];
  readonly removed: readonly string[];
  /** Nodes that were kept, with parameters or connections changed. */
  readonly updated: readonly Node[];
  /** Nodes that were kept untouched and never stopped sounding. */
  readonly unchanged: readonly Node[];
  /** Per-node failures. One bad node does not prevent the rest from applying. */
  readonly errors: readonly GraphError[];
}

export interface GraphError {
  readonly code:
    | 'unknown-type'
    | 'invalid-param'
    | 'duplicate-id'
    | 'missing-target'
    | 'build-failed'
    | 'buffer'
    | 'invalid-selector'
    | 'invalid-command'
    /** A sequence or scheduled callback threw. */
    | 'callback'
    /** The operation exists in the API but is not implemented in this version. */
    | 'unsupported';
  readonly message: string;
  readonly nodeId?: string;
  readonly cause?: unknown;
}

// ---------------------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------------------

/** Which nodes a command acts on: a selector resolved within the scope, or explicit node ids. */
export type CommandTarget = string | { readonly ids: readonly string[] };

/**
 * Every operation that changes anything, as plain data.
 *
 * The library's own methods are implemented by building a command and dispatching it, so there is
 * exactly one code path, and anything a script can do by calling methods can also be done by sending
 * commands. That is what lets a sandboxed script, which cannot touch the audio graph, do everything an
 * unsandboxed one can (see `remote.ts`).
 *
 * A command is always dispatched to one scope and cannot reach outside it.
 */
export type Command =
  // Nodes
  | { op: 'trigger'; target: CommandTarget; at: number; options?: Readonly<Record<string, Json>> }
  | { op: 'release'; target: CommandTarget; at: number; pitch?: number }
  | { op: 'set'; target: CommandTarget; at: number; values: Readonly<Record<string, ParamValue>> }
  | {
      op: 'ramp';
      target: CommandTarget;
      at: number;
      param: string;
      to: number;
      duration: number;
      curve?: 'linear' | 'exp';
      from?: number;
    }
  | {
      op: 'offset';
      target: CommandTarget;
      at: number;
      param: string;
      amount: number | null;
      duration?: number;
    }
  | { op: 'cancel'; target: CommandTarget; at: number; param?: string }
  | { op: 'bypass'; target: CommandTarget; at: number; bypass: boolean }
  /** A method declared by a node or macro definition. This is how a custom macro adds its own commands. */
  | {
      op: 'call';
      target: CommandTarget;
      at: number;
      method: string;
      args?: Readonly<Record<string, Json>>;
    }
  // Graph
  | { op: 'apply'; graph: GraphData }
  | { op: 'connect'; target: CommandTarget; to: EdgeTarget }
  | { op: 'disconnect'; target: CommandTarget; to?: EdgeTarget }
  | { op: 'dispose'; target: CommandTarget }
  | { op: 'bus'; name: string; to?: string; gain?: number }
  // Sequences (the callback stays with whoever created the sequence; see remote.ts)
  | { op: 'sequence'; name: string; options: import('./transport').SequenceOptions }
  | { op: 'setStep'; name: string; index: number; value: number }
  | { op: 'clearSequence'; name: string }
  // Transport and buffers. A host may refuse these from a sandbox.
  | { op: 'transport'; set: { bpm?: number; swing?: number } }
  | { op: 'loadBuffer'; key: string; url: string };

// ---------------------------------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------------------------------

export interface ScopeEvents {
  'node:added': (node: Node) => void;
  'node:removed': (id: string) => void;
  'param:changed': (change: import('./params').ParamChange) => void;
  error: (error: GraphError) => void;
}

/**
 * `__`: start a chain with no arguments, or select with a selector. Bound to one scope.
 * This is the object scripts and live coders use; everything it does goes through the scope.
 */
export interface ScopeApi {
  (): Chain;
  <T extends NodeType>(selector: T): Selection<T>;
  (selector: string): Selection;

  readonly scope: Scope;
  bus(name: string): Bus;
  /** The transport, as seen from this scope. See `Scope.transport`. */
  readonly transport: import('./transport').Transport;
}

/** A scope's readable state as plain data: its graph with current base values, and its buses. */
export interface ScopeSnapshot {
  readonly name: string;
  readonly graph: GraphData;
  readonly buses: readonly { name: string; to: string | null; gain: number }[];
}

/**
 * A named subtree of the graph with its own id namespace. Selecting from a scope searches only that
 * scope and its child scopes. A host typically creates one per track.
 */
export interface Scope {
  readonly name: string;
  readonly engine: Engine;
  readonly parent: Scope | null;
  readonly children: readonly Scope[];

  /** Gets or creates a child scope. */
  scope(name: string): Scope;

  /**
   * The engine's transport, as seen from this scope. There is one transport, so tempo, position and
   * timing are shared. What differs per scope is bookkeeping: sequence names are the scope's own (two
   * scopes can each have a sequence called 'kick'), and everything scheduled through this view is
   * removed when the scope is disposed.
   */
  readonly transport: import('./transport').Transport;

  /** `__` bound to this scope. */
  readonly $: ScopeApi;
  chain(): Chain;
  select<T extends NodeType>(selector: T): Selection<T>;
  select(selector: string): Selection;

  /**
   * Returns the nearest bus of that name, looking in this scope and then outward through its parents,
   * and creates one in this scope only if there is none. So `bus('main')` is always the engine's output
   * bus, from any scope. `.to('name')` on a chain looks names up the same way, but fails with a
   * `missing-target` error instead of creating a bus.
   */
  bus(name: string): Bus;

  /** This scope's nodes and connections as data. Child scopes are not included. */
  describe(): GraphData;

  /**
   * Makes the scope match the description. Nodes are matched by id: matching nodes are kept and
   * updated in place, missing ones are created, extra ones are disposed.
   */
  apply(graph: GraphData): Promise<ApplyResult>;

  /**
   * Runs `fn`, collects everything it builds into a description, and applies it once at the end.
   * Re-running the same builder leaves unchanged nodes sounding.
   *
   * Nodes with an explicit id are matched by id. Nodes without one are matched by position: the old and
   * new lists of un-id'd nodes are aligned by type in creation order, so inserting or removing one node
   * leaves the nodes after it matched to their previous selves. They can be selected by position too
   * (`lowpass:nth(1)`).
   */
  build(fn: (__: ScopeApi) => void): Promise<ApplyResult>;

  /** Applies commands produced elsewhere (for example by a sandboxed script). */
  dispatch(commands: readonly Command[]): void;

  on<E extends keyof ScopeEvents>(event: E, listener: ScopeEvents[E]): Unsubscribe;

  /** Everything a remote mirror needs to reproduce this scope's readable state. See `remote.ts`. */
  snapshot(): ScopeSnapshot;

  /**
   * Disposes every node, bus and child scope, and removes what was scheduled through `transport`.
   */
  dispose(): void;
}
