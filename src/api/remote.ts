/**
 * Proposed surface of `cracked-up/remote`: the scripting API for code that runs where there is no
 * audio graph, such as a sandboxed iframe or a Worker.
 *
 * The goal: a script written against `__` and the transport behaves the same whether it runs next to
 * the engine or inside a sandbox. Inside a sandbox, the same interfaces are backed by a mirror of the
 * scope's state for reads, and by commands for writes.
 *
 *   sandbox                                   host
 *   -------                                   ----
 *   remote.__ / remote.transport   --RemoteMessage-->   link.receive()  -> scope.dispatch(), transport
 *   remote.receive()               <--HostMessage---    link (sequence events, state patches, calls)
 *
 * How each kind of work crosses the boundary:
 * - Building and editing a graph: the remote records chains into GraphData and sends an `apply` command.
 * - Node operations (trigger, set, ramp, offset, call, ...): one command each, stamped with a time.
 * - Reading state (`param.value`, a sequence's steps, buffer durations and slices): answered from the
 *   mirror, which the host keeps current with patches. Reads are synchronous, as they are locally.
 * - Sequences: the remote sends the sequence's options; the callback stays in the sandbox. The host's
 *   transport sends each event ahead of time, the sandbox runs the callback, and the commands it
 *   produces default to the event's time. The round trip must fit inside the transport's look-ahead.
 * - Custom macros defined in the sandbox: the inner graph and exposed parameters travel as data. The
 *   macro's methods, trigger and release run in the sandbox, so the host forwards calls to it.
 *
 * Not available remotely: native AudioNodes (`node.output`, `bus.input`), `defineNode` with a `build`
 * function, and worklets. Those need the audio context and stay on the host.
 *
 * Times: a remote has no audio clock. Inside a sequence callback an operation defaults to the event's
 * time, as it does locally. Anywhere else it is sent with time 0, which the host reads as "now".
 *
 * Not built yet: macros defined inside the sandbox (the `define` message). Macros registered on the
 * host work, including their methods through `call`.
 */

import type { Command, GraphData, GraphError, Json, ScopeApi, ScopeSnapshot } from './graph';
import type { MacroParam, NodeCategory, NodeTypeInfo } from './nodes';
import type { ParamValue } from './params';
import type {
  Pattern,
  Sequence,
  SequenceCallback,
  SequenceOptions,
  StepCallback,
  Duration,
} from './transport';

/** A sequence event as data. The remote rebuilds the event object (including `at()`) from it. */
export interface SequenceEventData {
  readonly name: string;
  readonly time: number;
  readonly duration: number;
  readonly beat: number;
  readonly bar: number;
  readonly index: number;
  readonly value: number;
  readonly cycle: number;
}

export interface TransportSnapshot {
  readonly bpm: number;
  readonly swing: number;
  readonly timeSignature: readonly [number, number];
  readonly stepLength: Duration;
  readonly state: 'stopped' | 'started' | 'paused';
}

/** A macro defined inside the sandbox, as the host sees it. */
export interface RemoteMacroData {
  readonly type: string;
  readonly category?: NodeCategory;
  readonly description?: string;
  /** Exposed parameters. A `scale` function, if any, runs in the sandbox. */
  readonly params: Readonly<Record<string, Omit<MacroParam, 'drives'>>>;
  /** The inner graph, built once per instance. */
  readonly graph: GraphData;
  /** Names of the methods the sandbox implements, including `trigger` and `release` when present. */
  readonly methods: readonly string[];
}

/** Sandbox to host. */
export type RemoteMessage =
  { type: 'commands'; commands: readonly Command[] } | { type: 'define'; macro: RemoteMacroData };

/** Host to sandbox. */
export type HostMessage =
  | { type: 'event'; event: SequenceEventData; steps: readonly number[] }
  | { type: 'transport'; transport: TransportSnapshot }
  /** Base values that changed on the host (a slider, MIDI learn, another collaborator). */
  | { type: 'params'; changes: readonly { node: string; param: string; value: ParamValue }[] }
  /** The scope's graph changed on the host. */
  | { type: 'snapshot'; snapshot: ScopeSnapshot }
  /** Something the remote sent could not be applied. */
  | { type: 'error'; error: RemoteError }
  | { type: 'buffer'; key: string; duration: number; slices: readonly number[] }
  /** A method of a sandbox-defined macro was called, or one of its exposed parameters was set. */
  | {
      type: 'call';
      node: string;
      method: string;
      args: Readonly<Record<string, Json>>;
      at: number;
    };

/** A `GraphError` as data. */
export type RemoteError = Pick<GraphError, 'code' | 'message' | 'nodeId'>;

/** What a remote needs to start: everything `RemoteOptions` asks for except `send`. */
export type RemoteState = Pick<RemoteOptions, 'snapshot' | 'transport' | 'types'>;

/** The part of the transport a remote script can use. Tempo changes are sent as `transport` commands. */
export interface RemoteTransport {
  bpm: number;
  swing: number;
  readonly stepLength: Duration;
  readonly state: 'stopped' | 'started' | 'paused';
  sequence(name: string, options: SequenceOptions, callback: SequenceCallback): Sequence;
  steps(name: string, pattern: Pattern, callback: StepCallback): Sequence;
  get(name: string): Sequence | undefined;
  clear(name?: string): this;
  seconds(duration: Duration): number;
}

export interface RemoteOptions {
  /** Delivers messages to the host. Batched: one call per turn of the event loop at most. */
  send(message: RemoteMessage): void;
  snapshot: ScopeSnapshot;
  transport: TransportSnapshot;
  /** `registry.list()` from the host, so chain methods and setters exist for every node type. */
  types: readonly NodeTypeInfo[];
}

export interface Remote {
  /** The same `__` a local script gets, backed by the mirror and by commands. */
  readonly __: ScopeApi;
  readonly transport: RemoteTransport;
  /** Feed every message from the host here. */
  receive(message: HostMessage): void;

  /**
   * Runs `fn` and makes the scope match what it built, like `Scope.build`: the host keeps nodes that
   * are unchanged, and sequences `fn` no longer declares are removed. If `fn` throws, nothing is sent
   * and the error is rethrown.
   */
  build(fn: (__: ScopeApi) => void): void;

  /** The graph as this remote currently believes it to be. */
  describe(): GraphData;

  /** Sends what is waiting now instead of at the end of the current turn of the event loop. */
  flush(): void;

  /** Errors the host reports back, and errors thrown by this remote's sequence callbacks. */
  on(event: 'error', listener: (error: RemoteError) => void): () => void;
}

export interface LinkOptions {
  /** Delivers messages to the sandbox. */
  send(message: HostMessage): void;
  /**
   * Called for every command before it is applied. Return false to drop it. Use this to refuse tempo
   * changes, restrict which URLs may be loaded, or cap how many nodes a script may create.
   */
  allow?(command: Command): boolean;
}

export interface Link {
  /** Feed every message from the sandbox here. Commands are applied to the linked scope only. */
  receive(message: RemoteMessage): void;
  /**
   * What to create the remote with. Plain data, safe to post to a frame or Worker. Take it right
   * before creating the remote, so nothing changes in between.
   */
  state(): RemoteState;
  /** Stops forwarding and removes the sequences and macro types the remote created. */
  dispose(): void;
}
