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
 *   *                  everything in the scope, excluding macro internals
 */
export interface Selection<K extends NodeType = NodeType> extends Iterable<Node<K>> {
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

  /** Connects every selected node to the target. */
  connect(target: string | Selection | Node | Bus | Param<number>): this;
  /** Connects every selected node to a named bus, resolved from the selection's scope outward. */
  to(bus: string | Bus): this;
  disconnect(): this;

  /** Starts a chain whose first new node is fed by every selected node (fan-in). */
  chain(): Chain;

  dispose(): void;
}

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

/** A named mix point. Chains end at a bus; a bus feeds a parent bus or the engine output. */
export interface Bus {
  readonly name: string;
  readonly scope: Scope;
  readonly gain: Param<number>;
  /** Where this bus sends its mix. The root scope's `main` bus feeds the context destination. */
  to(target: string | Bus): this;
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
    | 'buffer';
  readonly message: string;
  readonly nodeId?: string;
  readonly cause?: unknown;
}

// ---------------------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------------------

/**
 * Every node operation as plain data. A sandboxed script produces these instead of calling methods;
 * the host passes them to `scope.dispatch`. `target` is a selector resolved within the scope.
 */
export type Command =
  | { op: 'trigger'; target: string; at: number; options?: Readonly<Record<string, Json>> }
  | { op: 'release'; target: string; at: number; pitch?: number }
  | { op: 'set'; target: string; at: number; values: Readonly<Record<string, ParamValue>> }
  | {
      op: 'ramp';
      target: string;
      at: number;
      param: string;
      to: number;
      duration: number;
      curve?: 'linear' | 'exp';
    }
  | { op: 'offset'; target: string; at: number; param: string; amount: number; duration?: number };

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

  /** `__` bound to this scope. */
  readonly $: ScopeApi;
  chain(): Chain;
  select<T extends NodeType>(selector: T): Selection<T>;
  select(selector: string): Selection;

  /**
   * Gets or creates a bus in this scope. A chain's `.to('main')` resolves the name in its own scope
   * first, then outward through parents. A new bus feeds the same-named bus of the parent scope if one
   * exists, otherwise the parent's `main`.
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
   * Re-running the same builder leaves unchanged nodes sounding. Nodes created without an explicit id
   * get ids from their type and position (`lowpass-1`), so inserting a node ahead of others of the
   * same type renames them; give ids to nodes that must survive edits.
   */
  build(fn: (__: ScopeApi) => void): Promise<ApplyResult>;

  /** Applies commands produced elsewhere (for example by a sandboxed script). */
  dispatch(commands: readonly Command[]): void;

  on<E extends keyof ScopeEvents>(event: E, listener: ScopeEvents[E]): Unsubscribe;

  /** Disposes every node, bus and child scope, and cancels the scope's sequences. */
  dispose(): void;
}
