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
  /**
   * True when no id was given where the node was made, so the library made one from its type and
   * position (`lowpass-0`). Such a node is matched across rebuilds by its place among the nodes of
   * its type, not by a name. A node made from a graph description always has the id it was
   * described with, so this is false there.
   */
  readonly autoId: boolean;
  readonly type: K;
  readonly classes: ReadonlySet<string>;
  readonly tags: Tags;
  readonly scope: Scope;
  /** The macro instance this node is inside, if any. */
  readonly parent: Node | null;
  /**
   * For a macro instance: the private scope holding its inner nodes, the one its definition built
   * into. Null for every other node. For hosts that show or inspect what a macro is made of; the
   * scope's `owner` is this node.
   */
  readonly insideScope: Scope | null;
  readonly disposed: boolean;

  readonly params: { readonly [P in keyof ParamsOf<K>]: Param<ParamsOf<K>[P] & ParamValue> };
  /** Untyped lookup, for hosts that work from metadata. Throws if the node has no such parameter. */
  param(name: string): Param;

  /**
   * A bypassed effect passes its input straight through; a bypassed source or modulator is silent. The
   * node keeps running, so its state (a delay's contents, an oscillator's phase) carries on.
   */
  bypass: boolean;

  /** Every recorded connection, both directions. */
  readonly inputs: readonly Edge[];
  readonly outputs: readonly Edge[];
  /**
   * The bus this node is an insert on, or null. An insert's place in its bus is not a connection: it
   * does not appear in `inputs` or `outputs`.
   */
  readonly insertOf: Bus | null;

  connect(target: Node | Bus | Param<number>): this;
  disconnect(target?: Node | Bus | Param<number>): this;

  /** Starts a voice or opens the gate. A no-op (with a debug warning) on nodes that cannot be triggered. */
  trigger(options?: TriggerOptions<K>): this;
  release(options?: ReleaseOptions): this;

  /** Calls a method the node's definition declares (see `methods` on node and macro definitions). */
  call(method: string, args?: Readonly<Record<string, Json>>, options?: At): this;

  /**
   * Changes one of the creation options the node type marks `live`, with the node and everything
   * connected to it left in place. Today that is a sampler's `buffer`:
   * `node.setOption('buffer', 'snare')`. The value is whatever the option accepts at creation.
   * From `at` on (default: now, or the event's time inside a sequence callback) the node behaves
   * as if made with it; `describe()` reports the new value, and the scope emits `option:changed`.
   * Throws `invalid-command` for an option that is not live.
   */
  setOption(name: string, value: unknown, options?: At): this;

  /**
   * Where the node's voices are in the sound they play, for drawing a play cursor: one position
   * per voice sounding at the audio time `at` (default: now, `context.currentTime`), in seconds
   * from the start of the buffer, oldest voice first. Empty when nothing sounds then, and for
   * node types that play no buffer (today only `sampler` answers).
   *
   * The positions are worked out from what each voice was told (when it started, its region,
   * speed, direction and loop), not measured, so asking costs a few additions per voice, can be
   * done on every animation frame, and works for times in the future and on an offline context
   * before it renders. Pass the same `into` each time and nothing is allocated: it is emptied,
   * filled and returned.
   *
   * How exact: for a voice at a steady speed it is the sample being played, to within a sample
   * (reversed, the sample just before the position). Changes of speed while a voice sounds (a `set` or an
   * `offset`; a sampler's speed cannot be ramped or modulated) are followed, at the block of 128
   * frames where the browser applies them. On a live context
   * `currentTime` is ahead of what is heard by the output latency and moves in steps of 128
   * frames, so for a cursor that matches the ear ask for
   * `context.currentTime - context.outputLatency`, or use `context.getOutputTimestamp()`.
   *
   * Not available to a sandboxed script: a remote's nodes always answer with an empty list.
   */
  playheads(at?: number, into?: number[]): number[];

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
  /**
   * Changes a live creation option on every selected node that has it; others are skipped. See
   * `Node.setOption`. `__('#snare').setOption('buffer', 'rimshot')`.
   */
  setOption(name: string, value: unknown, options?: At): this;

  /**
   * Bypasses every selected node, or with `false` brings them back. A bypassed effect passes its input
   * straight through; a bypassed source or modulator is silent. The node keeps running either way.
   */
  bypass(on?: boolean, options?: At): this;

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
 *
 * Inside a bus the signal runs: mix of everything sent to it, then its inserts in order, then its
 * level (`gain`), then its output. The output goes to the bus's target (`to`) and to every chain
 * continued from it (`chain()`).
 */
interface BusBase {
  readonly name: string;
  readonly scope: Scope;
  /** The bus's level, applied after its inserts. To add a gain node as an insert: `insert().gain()`. */
  readonly gain: Param<number>;
  /**
   * Where this bus sends its output. Default: the engine's `main` bus. `null` sends it nowhere, so it
   * is heard only through what continues from it with `chain()`: use that when the chain is the bus's
   * one way out, such as a bus that feeds a looper.
   */
  to(target: string | Bus | null): this;
  /**
   * Starts a chain fed by this bus's output, after its inserts and level. A tap: the bus still goes
   * to its target as well. For processing in series, add an insert instead.
   */
  chain(): Chain;
  /**
   * The place to add inserts, with a method for every node type. `bus.compressor()` is short for
   * `bus.insert().compressor()`; this is the way to the types whose name a bus already uses for
   * something of its own (`gain`, `input`).
   */
  insert(): BusInserts;
  /** The bus's inserts, in the order the signal passes through them. */
  readonly inserts: Selection;
  readonly input: AudioNode;
  readonly output: AudioNode;
}

type InsertInit<K extends NodeType> = NodeInit<K> | NodeTypeMap[K]['shorthand'];

/**
 * One method per registered node type, except the names a bus already has (`gain` is its level).
 * Each creates a node of the scope and puts it inside the bus as its last insert: in series between
 * the bus's mix and its output, so nothing goes round it. The bus stays routed where it was.
 *
 *   __.bus('drums').compressor({ id: 'glue', threshold: -18 }).overdrive(0.2);
 *
 * An insert is an ordinary node: it has an id, is found by selectors, and can be set, bypassed and
 * disposed. It needs an input and an output, and it can only be added from the scope that owns the
 * bus. Outside `build()` each call adds another insert; inside, the bus ends up with exactly the
 * inserts the build asked for, in the order it asked.
 */
export type Bus = BusBase & {
  readonly [K in Exclude<NodeType, keyof BusBase>]: (init?: InsertInit<K>) => BusInserts;
};

interface BusInsertsBase {
  /** The bus the inserts are on. */
  readonly bus: Bus;
  /** The inserts this run of calls added, in order. `bus.inserts` has all of them. */
  readonly nodes: Selection;
  /** Routes the bus, as `bus.to()` does. */
  to(target: string | Bus | null): BusInserts;
  /** Starts a chain fed by the bus's output, as `bus.chain()` does. */
  chain(): Chain;
}

/**
 * What adding an insert returns: the place to add the next one. It has a method for every node type
 * (here `gain` is the node type), and `to` and `chain`, which act on the bus.
 */
export type BusInserts = BusInsertsBase & {
  readonly [K in NodeType]: (init?: InsertInit<K>) => BusInserts;
};

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
  /** A node id, or a bus when the connection continues from a bus's mix (`bus.chain()`). */
  from: string | { bus: string };
  to: EdgeTarget;
}

/** A scope's graph as plain, serializable data. */
export interface GraphData {
  nodes: readonly NodeData[];
  edges: readonly EdgeData[];
  /**
   * The inserts of the scope's own buses: for each bus that has any, the ids of its insert nodes in
   * the order the signal passes through them. The nodes themselves are in `nodes`. No edge describes
   * an insert's place in the bus. Left out when no bus has inserts; applying a description without
   * it leaves every bus of the scope with none.
   */
  inserts?: Readonly<Record<string, readonly string[]>>;
}

export interface ApplyResult {
  readonly added: readonly Node[];
  readonly removed: readonly string[];
  /** Nodes that were kept, with parameters or connections changed. */
  readonly updated: readonly Node[];
  /** Nodes that were kept untouched and never stopped sounding. */
  readonly unchanged: readonly Node[];
  /**
   * From `apply()`: per-node failures. One bad node does not prevent the rest from applying.
   *
   * From `build()`: almost always empty, because a build that cannot be applied whole is refused
   * (its promise rejects). The exception is code of a node's own that throws while a successful
   * build is being carried out: a `trigger`, `release` or method the builder called on a node that
   * was already there, or a custom parameter handler. Those are listed here, and everything else
   * the build asked for has been done.
   */
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
  /** On a `callback` error: which scheduled callback threw. */
  readonly origin?: CallbackOrigin;
}

/**
 * Where a callback that threw was scheduled. The error does not stop anything: a sequence or an
 * `every` is called again at its next step, and reports again if it throws again. A host that
 * wants it quiet mutes the sequence (`origin.sequence.muted = true`, undone by setting it false,
 * for example once the script has been changed), or removes it with `cancel()`.
 */
export interface CallbackOrigin {
  /** The scope whose view of the transport it was scheduled through. The root scope for `engine.transport`. */
  readonly scope: Scope;
  /** What scheduled it: `transport.sequence` (or `steps`), `every` or `at`. */
  readonly kind: 'sequence' | 'every' | 'at';
  /** The sequence, when it is one. Null for `every` and `at`. */
  readonly sequence: import('./transport').Sequence | null;
  /** The sequence's name. Null for a sequence made without one, and for `every` and `at`. */
  readonly name: string | null;
  /** Removes the sequence or repeating callback from the transport, so it is not called again. */
  cancel(): void;
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
  /** A live creation option of the nodes that have it, such as a sampler's `buffer` (a store key). */
  | { op: 'option'; target: CommandTarget; at: number; name: string; value: Json }
  // Graph
  | { op: 'apply'; graph: GraphData }
  /** Commands for the private scope inside one macro instance, named by its id. */
  | { op: 'inside'; node: string; commands: readonly Command[] }
  | { op: 'connect'; target: CommandTarget; to: EdgeTarget }
  | { op: 'disconnect'; target: CommandTarget; to?: EdgeTarget }
  | { op: 'dispose'; target: CommandTarget }
  /** `inserts`: the ids of existing nodes of the scope to have as the bus's inserts, in order. */
  | { op: 'bus'; name: string; to?: string | null; gain?: number; inserts?: readonly string[] }
  // Sequences (the callback stays with whoever created the sequence; see remote.ts)
  | { op: 'sequence'; name: string; options: import('./transport').SequenceOptions }
  /** A single callback at a position, for `transport.at`. Like `sequence`, the callback stays with its creator. */
  | { op: 'once'; name: string; position: import('./transport').Position }
  | { op: 'setStep'; name: string; index: number; value: number }
  | { op: 'restartSequence'; name: string }
  | { op: 'clearSequence'; name: string }
  // Transport and buffers. A host may refuse these from a sandbox.
  | { op: 'transport'; set: { bpm?: number; swing?: number } }
  | { op: 'loadBuffer'; key: string; url: string }
  /** Replaces the slice boundaries of a buffer in the engine's store. */
  | { op: 'slices'; key: string; slices: readonly number[] };

// ---------------------------------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------------------------------

export interface ScopeEvents {
  'node:added': (node: Node) => void;
  'node:removed': (id: string) => void;
  'param:changed': (change: import('./params').ParamChange) => void;
  /**
   * A live creation option of a node changed (`setOption`, an `option` command, or a rebuild that
   * kept the node): for a sampler, it now plays another buffer. `value` is what was given.
   */
  'option:changed': (change: OptionChange) => void;
  /**
   * Something failed in this scope: a command, a node's build, or a callback scheduled through
   * the scope's transport that threw (the error's `origin` says which).
   */
  error: (error: GraphError) => void;
}

export interface OptionChange {
  readonly node: Node;
  readonly name: string;
  readonly value: unknown;
  /** Audio time at which the change takes effect. */
  readonly at: number;
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
  /** For the private scope inside a macro instance: that instance. Otherwise null. */
  readonly owner: Node | null;

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
   * updated in place, missing ones are created, extra ones are disposed. A node is kept only if its
   * type and creation options are unchanged, apart from options its type marks `live` (a sampler's
   * `buffer`), which are changed in place; otherwise it is replaced, and appears in both `removed`
   * and `added`. Connections the description does not list are removed, except those that leave the
   * scope, which a description cannot name. Each bus of the scope gets the inserts the description
   * lists for it. Sequences are not touched, and nor are buses otherwise.
   *
   * Unlike `build()`, this works node by node. A node that cannot be made as described, or whose
   * values cannot all be set, is left exactly as it was and listed in the result's `errors`, as is a
   * connection that cannot be made; the rest of the description is applied. The promise rejects
   * only when the description itself is malformed.
   *
   * The work is done before this returns; the promise is already settled.
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
   *
   * The same goes for what `fn` schedules through `__.transport` and for buses it makes: a named
   * sequence is replaced in place and keeps its position, and anything an earlier build made that this
   * one does not ask for is removed. On the root scope that includes everything scheduled through
   * `engine.transport`.
   *
   * All or nothing. If anything `fn` asks for cannot be done, the promise rejects with the first such
   * error and nothing `fn` asked for has happened: nodes, values, connections, buses and their
   * inserts and routes, sequences, tempo and the events the scope emits are as if `build` had not
   * been called. That covers `fn` throwing, and every request the library refuses: a value of the
   * wrong kind for a node being kept or a new one, a bad `set` or `ramp`, a connection or route to
   * something that does not exist, a node that cannot be built, sequence options that make no sense.
   * The error names the node (`nodeId`) and the parameter where there is one.
   *
   * To make that possible, whatever `fn` asks of a node or bus that was there before the build (a
   * value set or ramped, a trigger, a bypass, a bus's route or level) is checked as `fn` asks and
   * carried out when `fn` has returned, in the order asked. So inside `fn`, `param.value` of such a
   * node still reads what it was. New nodes are made, set and connected straight away.
   *
   * Not undone: starting, stopping or seeking the transport from inside `fn`, buffers loaded and
   * node types registered there, and anything `fn` does outside this engine.
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
