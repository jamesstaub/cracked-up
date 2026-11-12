/**
 * The sandbox's end of a remote: the scripting API with no audio graph behind it.
 *
 * Reads are answered from a mirror of the scope's state. Writes change the mirror and are sent to the
 * host as commands. Nothing here touches Web Audio, so it runs in a sandboxed frame or a Worker.
 */

import type {
  At,
  BufferInfo,
  Command,
  CommandTarget,
  EdgeData,
  EdgeTarget,
  GraphData,
  HostMessage,
  Json,
  MacroContext,
  MacroDefinition,
  NodeData,
  NodeTypeInfo,
  OffsetOptions,
  ParamChange,
  ParamMeta,
  ParamValue,
  Pattern,
  RampOptions,
  ReleaseOptions,
  Remote,
  RemoteBuffers,
  RemoteError,
  RemoteMacroData,
  RemoteMessage,
  ScheduledEvent,
  Position,
  RemoteOptions,
  RemoteTransport,
  ScopeApi,
  ScopeSnapshot,
  Sequence,
  SequenceCallback,
  SequenceEvent,
  SequenceOptions,
  StepCallback,
  Tags,
  TransportSnapshot,
  Duration,
} from '../api';
import { CrackedUpError } from '../core/errors';
import { normalizeParamMeta } from '../core/registry';
import { SelectorError, matchesCompound, select } from '../selector';
import type { Selectable, SelectableTree } from '../selector';
import { fromNormalized, toNormalized } from '../util/curves';
import { beatsToSeconds, durationToBeats } from '../util/duration';
import { parsePattern } from '../util/pattern';

const COMMON_KEYS = new Set(['id', 'class', 'tags', 'bypass', 'modulates']);

type EdgeFrom = EdgeData['from'];
type Source = RemoteNode | RemoteBus;
type ConnectTarget = string | RemoteSelection | RemoteNode | RemoteBus | RemoteParam;

function selecting<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof SelectorError) {
      throw new CrackedUpError('invalid-selector', error.message, { cause: error });
    }
    throw error;
  }
}

function stepsOf(steps: Pattern | number): number[] {
  if (typeof steps !== 'number') return parsePattern(steps);
  if (!Number.isInteger(steps) || steps < 1) {
    throw new RangeError(
      'A sequence needs at least one step: "steps" must be a whole number above 0.',
    );
  }
  return new Array<number>(steps).fill(1);
}

// ---------------------------------------------------------------------------------------------------
// Parameters, nodes, buses
// ---------------------------------------------------------------------------------------------------

class RemoteParam {
  private listeners = new Set<(change: ParamChange) => void>();

  constructor(
    readonly node: RemoteNode,
    readonly meta: ParamMeta,
  ) {}

  get name(): string {
    return this.meta.name;
  }

  get value(): ParamValue {
    return this.node.values[this.name] ?? this.meta.default;
  }

  /** Changes the mirrored value and tells listeners. Sends nothing. */
  assign(value: ParamValue, at: number): void {
    const previous = this.value;
    this.node.values[this.name] = value;
    if (value === previous) return;
    const change = { param: this, value, previous, at } as unknown as ParamChange;
    for (const listener of [...this.listeners]) listener(change);
  }

  set(value: ParamValue, options?: At): this {
    const at = this.node.remote.time(options);
    this.assign(value, at);
    this.node.remote.emit({
      op: 'set',
      target: this.node.target,
      at,
      values: { [this.name]: value },
    });
    return this;
  }

  get normalized(): number {
    return this.meta.kind === 'number' ? toNormalized(this.value as number, this.meta) : 0;
  }

  setNormalized(position: number, options?: At): this {
    if (this.meta.kind === 'number') this.set(fromNormalized(position, this.meta), options);
    return this;
  }

  ramp(target: number, options: RampOptions): this {
    const at = this.node.remote.time(options);
    this.assign(target, at + options.duration);
    this.node.remote.emit({
      op: 'ramp',
      target: this.node.target,
      at,
      param: this.name,
      to: target,
      duration: options.duration,
      ...(options.curve === undefined ? {} : { curve: options.curve }),
      ...(options.from === undefined ? {} : { from: options.from }),
    });
    return this;
  }

  offset(amount: number, options?: OffsetOptions): this {
    this.node.remote.emit({
      op: 'offset',
      target: this.node.target,
      at: this.node.remote.time(options),
      param: this.name,
      amount,
      ...(options?.duration === undefined ? {} : { duration: options.duration }),
    });
    return this;
  }

  clearOffset(options?: At): this {
    this.node.remote.emit({
      op: 'offset',
      target: this.node.target,
      at: this.node.remote.time(options),
      param: this.name,
      amount: null,
    });
    return this;
  }

  cancel(options?: At): this {
    this.node.remote.emit({
      op: 'cancel',
      target: this.node.target,
      at: this.node.remote.time(options),
      param: this.name,
    });
    return this;
  }

  reset(options?: At): this {
    return this.set(this.meta.default, options);
  }

  /** Audio-rate connections are not mirrored. */
  get modulators(): readonly never[] {
    return [];
  }

  on(event: string, listener: (change: ParamChange) => void): () => void {
    if (event !== 'change') return () => undefined;
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

class RemoteNode implements Selectable {
  readonly params: Readonly<Record<string, RemoteParam>>;
  readonly parent = null;
  /** There is no audio node on this side. */
  readonly output = null;
  disposed = false;

  constructor(
    readonly remote: RemoteImpl,
    readonly info: NodeTypeInfo,
    readonly id: string,
    public classes: ReadonlySet<string>,
    public tags: Tags,
    /** Base values that have been given. A parameter not listed has its default. */
    readonly values: Record<string, ParamValue>,
    readonly init: Readonly<Record<string, Json>>,
    public bypassed: boolean,
  ) {
    const params: Record<string, RemoteParam> = {};
    for (const meta of info.params) params[meta.name] = new RemoteParam(this, meta);
    this.params = params;
  }

  get type(): string {
    return this.info.type;
  }

  get scope(): unknown {
    return this.remote.scopeView;
  }

  get target(): CommandTarget {
    return { ids: [this.id] };
  }

  /** The parameter of the next node in a chain that this node connects to, for modulators. */
  get modulates(): string | null {
    const given = this.init['modulates'];
    return typeof given === 'string' ? given : this.info.modulates;
  }

  findParam(name: string): RemoteParam | undefined {
    return Object.hasOwn(this.params, name) ? this.params[name] : undefined;
  }

  param(name: string): RemoteParam {
    const param = this.findParam(name);
    if (!param) {
      const known = Object.keys(this.params).join(', ') || 'none';
      throw new CrackedUpError(
        'invalid-param',
        `${this.type} "${this.id}" has no parameter called "${name}". Its parameters: ${known}.`,
        { nodeId: this.id },
      );
    }
    return param;
  }

  get bypass(): boolean {
    return this.bypassed;
  }

  set bypass(value: boolean) {
    this.remote.select([this]).bypass(value);
  }

  get inputs(): readonly { from: unknown; to: unknown }[] {
    return this.remote.edgesInto(this);
  }

  get outputs(): readonly { from: unknown; to: unknown }[] {
    return this.remote.edgesFrom(this);
  }

  connect(target: ConnectTarget): this {
    this.remote.connect(this, target);
    return this;
  }

  disconnect(target?: ConnectTarget): this {
    this.remote.disconnect(this, target);
    return this;
  }

  trigger(options?: At & Record<string, unknown>): this {
    this.remote.select([this]).trigger(options);
    return this;
  }

  release(options?: ReleaseOptions): this {
    this.remote.select([this]).release(options);
    return this;
  }

  call(method: string, args?: Readonly<Record<string, Json>>, options?: At): this {
    this.remote.select([this]).call(method, args, options);
    return this;
  }

  dispose(): void {
    this.remote.removeNodes([this]);
  }

  toData(): NodeData {
    return {
      id: this.id,
      type: this.type,
      ...(this.classes.size > 0 ? { classes: [...this.classes] } : {}),
      ...(Object.keys(this.tags).length > 0 ? { tags: this.tags } : {}),
      // Every value, defaults included, as the host's own description has them.
      params: Object.fromEntries(Object.values(this.params).map((p) => [p.name, p.value])),
      ...(Object.keys(this.init).length > 0 ? { init: this.init } : {}),
      ...(this.bypassed ? { bypass: true } : {}),
    };
  }
}

class RemoteBus {
  readonly gain: { readonly value: number; set(value: number): unknown };

  constructor(
    readonly remote: RemoteImpl,
    readonly name: string,
    public destination: string | null,
    gain: number,
  ) {
    let level = gain;
    const param = {
      get value(): number {
        return level;
      },
      set: (value: number) => {
        level = value;
        remote.emit({ op: 'bus', name, gain: value }, true);
        return param;
      },
    };
    this.gain = param;
  }

  get scope(): unknown {
    return this.remote.scopeView;
  }

  to(target: string | RemoteBus | null): this {
    this.destination = target === null || typeof target === 'string' ? target : target.name;
    this.remote.emit({ op: 'bus', name: this.name, to: this.destination }, true);
    return this;
  }

  chain(): RemoteChain {
    return this.remote.makeChain([this], []);
  }

  get input(): never {
    throw new CrackedUpError('unsupported', 'A remote bus has no audio node.');
  }

  get output(): never {
    throw new CrackedUpError('unsupported', 'A remote bus has no audio node.');
  }
}

// ---------------------------------------------------------------------------------------------------
// Selections and chains
// ---------------------------------------------------------------------------------------------------

class RemoteSelection implements Iterable<RemoteNode> {
  readonly nodes: readonly RemoteNode[];

  constructor(
    readonly remote: RemoteImpl,
    nodes: readonly RemoteNode[],
    /**
     * The selector this selection was made with, if it was made straight from one. Commands then carry
     * the selector and the host resolves it, which is what lets a script reach inside a macro: the
     * mirror does not hold macro internals, but the host does.
     */
    readonly selector: string | null = null,
  ) {
    this.nodes = Object.freeze([...nodes]);
  }

  private get target(): CommandTarget | null {
    if (this.selector !== null) return this.selector;
    return this.nodes.length > 0 ? { ids: this.nodes.map((node) => node.id) } : null;
  }

  get length(): number {
    return this.nodes.length;
  }

  first(): RemoteNode | undefined {
    return this.nodes[0];
  }

  at(index: number): RemoteNode | undefined {
    return this.nodes.at(index);
  }

  [Symbol.iterator](): Iterator<RemoteNode> {
    return this.nodes[Symbol.iterator]();
  }

  /** Inside the selected nodes. Macro internals are not mirrored, so this reads as empty but can be written to. */
  select(selector: string): RemoteSelection {
    const inside = this.nodes.map((node) => `#${node.id} ${selector}`).join(', ');
    return this.remote.makeSelection([], this.nodes.length > 0 ? inside : null);
  }

  filter(test: string | ((node: RemoteNode, index: number) => boolean)): RemoteSelection {
    const nodes =
      typeof test === 'string'
        ? selecting(() => this.nodes.filter((node) => matchesCompound(node, test)))
        : this.nodes.filter(test);
    return this.remote.makeSelection(nodes);
  }

  each(fn: (node: RemoteNode, index: number) => void): this {
    this.nodes.forEach(fn);
    return this;
  }

  set(values: Readonly<Record<string, ParamValue | undefined>>, options?: At): this {
    const at = this.remote.time(options);
    const given: Record<string, ParamValue> = {};
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) continue;
      given[name] = value;
      for (const node of this.nodes) node.findParam(name)?.assign(value, at);
    }
    const target = this.target;
    if (target !== null) this.remote.emit({ op: 'set', target, at, values: given });
    return this;
  }

  ramp(param: string, to: number, options: RampOptions): this {
    const at = this.remote.time(options);
    for (const node of this.nodes) node.findParam(param)?.assign(to, at + options.duration);
    const target = this.target;
    if (target !== null) {
      this.remote.emit({
        op: 'ramp',
        target,
        at,
        param,
        to,
        duration: options.duration,
        ...(options.curve === undefined ? {} : { curve: options.curve }),
        ...(options.from === undefined ? {} : { from: options.from }),
      });
    }
    return this;
  }

  offset(param: string, amount: number, options?: OffsetOptions): this {
    const target = this.target;
    if (target !== null) {
      this.remote.emit({
        op: 'offset',
        target,
        at: this.remote.time(options),
        param,
        amount,
        ...(options?.duration === undefined ? {} : { duration: options.duration }),
      });
    }
    return this;
  }

  params(name: string): readonly RemoteParam[] {
    return this.nodes.flatMap((node) => node.findParam(name) ?? []);
  }

  param(name: string): RemoteParam {
    const first = this.nodes[0];
    if (!first) {
      throw new CrackedUpError('missing-target', `Cannot read "${name}": the selection is empty.`);
    }
    return first.param(name);
  }

  trigger(options?: At & Record<string, unknown>): this {
    const { at, ...rest } = options ?? {};
    const target = this.target;
    if (target !== null) {
      this.remote.emit({
        op: 'trigger',
        target,
        at: at ?? this.remote.time(),
        ...(Object.keys(rest).length > 0 ? { options: rest as Record<string, Json> } : {}),
      });
    }
    return this;
  }

  release(options?: ReleaseOptions): this {
    const target = this.target;
    if (target !== null) {
      this.remote.emit({
        op: 'release',
        target,
        at: this.remote.time(options),
        ...(options?.pitch === undefined ? {} : { pitch: options.pitch }),
      });
    }
    return this;
  }

  call(method: string, args?: Readonly<Record<string, Json>>, options?: At): this {
    const target = this.target;
    if (target !== null) {
      this.remote.emit({
        op: 'call',
        target,
        at: this.remote.time(options),
        method,
        ...(args === undefined ? {} : { args }),
      });
    }
    return this;
  }

  bypass(on = true, options?: At): this {
    for (const node of this.nodes) node.bypassed = on;
    const target = this.target;
    if (target !== null) {
      this.remote.emit({ op: 'bypass', target, at: this.remote.time(options), bypass: on });
    }
    return this;
  }

  connect(target: ConnectTarget): this {
    for (const node of this.nodes) this.remote.connect(node, target);
    return this;
  }

  to(bus: string | RemoteBus): this {
    for (const node of this.nodes) this.remote.connectToBus(node, bus);
    return this;
  }

  disconnect(): this {
    for (const node of this.nodes) this.remote.disconnect(node);
    return this;
  }

  chain(): RemoteChain {
    return this.remote.makeChain(this.nodes, this.nodes);
  }

  dispose(): void {
    this.remote.removeNodes(this.nodes);
  }
}

class RemoteChain {
  constructor(
    readonly remote: RemoteImpl,
    private readonly tailSources: readonly Source[],
    private readonly allNodes: readonly RemoteNode[],
  ) {}

  private get tailNodes(): RemoteNode[] {
    return this.tailSources.filter((source): source is RemoteNode => source instanceof RemoteNode);
  }

  get tail(): RemoteSelection {
    return this.remote.makeSelection(this.tailNodes);
  }

  get nodes(): RemoteSelection {
    return this.remote.makeSelection(this.allNodes);
  }

  add(type: string, init: unknown): RemoteChain {
    const node = this.remote.createNode(type, init);
    try {
      for (const previous of this.tailSources) {
        const modulates = previous instanceof RemoteNode ? previous.modulates : null;
        if (modulates !== null) node.param(modulates);
        this.remote.addEdge(
          this.remote.refOf(previous),
          modulates === null ? { node: node.id } : { node: node.id, param: modulates },
        );
      }
    } catch (error) {
      this.remote.removeNodes([node]);
      throw error;
    }
    return this.remote.makeChain([node], [...this.allNodes, node]);
  }

  to(bus: string | RemoteBus): RemoteChain {
    this.requireTail('to()');
    for (const source of this.tailSources) this.remote.connectToBus(source, bus);
    return this;
  }

  connect(target: ConnectTarget): RemoteChain {
    this.requireTail('connect()');
    for (const source of this.tailSources) this.remote.connect(source, target);
    return this;
  }

  modulate(target: string | RemoteSelection | RemoteNode, param: string): RemoteChain {
    this.requireTail('modulate()');
    const nodes =
      typeof target === 'string'
        ? this.remote.find(target)
        : target instanceof RemoteNode
          ? [target]
          : target.nodes;
    for (const node of nodes) {
      const end = node.param(param);
      for (const source of this.tailSources) this.remote.connect(source, end);
    }
    return this;
  }

  split(...branches: readonly ((branch: RemoteChain) => RemoteChain)[]): RemoteChain {
    const tails = new Set<Source>();
    const all = new Set<RemoteNode>(this.allNodes);
    for (const branch of branches) {
      const result = branch(this.remote.makeChain(this.tailSources, []));
      for (const source of result.tailSources) tails.add(source);
      for (const node of result.allNodes) all.add(node);
    }
    return this.remote.makeChain([...tails], [...all]);
  }

  private requireTail(method: string): void {
    if (this.tailSources.length === 0) {
      throw new CrackedUpError(
        'missing-target',
        `${method} was called on an empty chain: add a node first.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// Sequences
// ---------------------------------------------------------------------------------------------------

class RemoteSequence {
  muted = false;
  steps: number[];

  constructor(
    private readonly remote: RemoteImpl,
    readonly name: string,
    public options: Readonly<SequenceOptions>,
    readonly callback: SequenceCallback,
  ) {
    this.steps = stepsOf(options.steps);
  }

  setStep(index: number, value: number): this {
    if (index >= 0 && index < this.steps.length) this.steps[index] = value;
    this.remote.emit({ op: 'setStep', name: this.name, index, value });
    return this;
  }

  update(options: Partial<SequenceOptions>): this {
    const next = { ...this.options, ...options };
    this.steps = stepsOf(next.steps);
    this.options = next;
    this.remote.emit({ op: 'sequence', name: this.name, options: next });
    return this;
  }

  restart(): this {
    this.remote.emit({ op: 'restartSequence', name: this.name });
    return this;
  }

  stop(): void {
    this.remote.clearSequence(this.name);
  }
}

// ---------------------------------------------------------------------------------------------------
// The remote
// ---------------------------------------------------------------------------------------------------

/** A macro instance as the sandbox holds it: a remote of its own for the instance's inner scope. */
interface Instance {
  remote: RemoteImpl;
  /** Type, options and definition it was built from. A rebuild that matches reuses the instance. */
  key: string;
  /** The inner graph as first built, which is what the host is given to create the instance from. */
  graph: GraphData;
}

class RemoteImpl {
  /** Shared with the remotes of macro instances, so every level knows every type. */
  private readonly types: Map<string, NodeTypeInfo>;
  /** Macros defined in this sandbox, by type, with the signature sent to the host. */
  private readonly macros: Map<string, { definition: MacroDefinition; signature: string }>;
  private instances = new Map<string, Instance>();
  /** During a build: the instances from before it, for reuse. */
  private previousInstances: Map<string, Instance> | null = null;
  private onces = new Map<string, (event: ScheduledEvent) => void>();
  private autoNames = new Map<string, number>();
  private definitions: RemoteMacroData[] = [];
  private bufferInfo = new Map<string, BufferInfo>();
  private transportListeners = new Set<{ event: string; listener: (bpm: number) => void }>();
  private nodes = new Map<string, RemoteNode>();
  private edges = new Map<string, EdgeData>();
  private buses = new Map<string, RemoteBus>();
  private autoIds = new Map<string, number>();
  private sequences = new Map<string, RemoteSequence>();
  private transportState: TransportSnapshot;
  private scopeName: string;

  /** The time of the sequence event whose callback is running, or null outside one. */
  private eventTime: number | null = null;
  /** Sequence names declared by the build in progress, or null outside one. */
  private declared: Set<string> | null = null;

  // What is waiting to be sent: bus commands, then the graph if it changed, then everything else.
  private early: Command[] = [];
  private late: Command[] = [];
  private dirty = false;
  private flushQueued = false;

  private errorListeners = new Set<(error: RemoteError) => void>();

  private readonly Selection: typeof RemoteSelection;
  private readonly Chain: typeof RemoteChain;
  readonly buffers: RemoteBuffers;
  private readonly tree: SelectableTree<RemoteNode> = {
    children: (parent) => (parent === null ? [...this.nodes.values()] : []),
  };

  readonly $: ScopeApi;
  readonly transport: RemoteTransport;
  readonly scopeView: unknown;

  constructor(
    private readonly options: RemoteOptions,
    /** For the remote of a macro instance: the remote the instance lives in. */
    private readonly outer: RemoteImpl | null = null,
  ) {
    if (outer) {
      this.types = outer.types;
      this.macros = outer.macros;
      this.Selection = outer.Selection;
      this.Chain = outer.Chain;
      this.bufferInfo = outer.bufferInfo;
    } else {
      this.types = new Map();
      this.macros = new Map();
      this.Selection = class extends RemoteSelection {};
      this.Chain = class extends RemoteChain {};
      for (const info of options.types) this.addType(info);
      for (const info of options.buffers ?? []) this.bufferInfo.set(info.key, info);
    }
    this.buffers = {
      get: (key) => this.bufferInfo.get(key),
      load: (url, loadOptions) =>
        this.emit({ op: 'loadBuffer', key: loadOptions?.key ?? url, url }),
    };
    this.transportState = options.transport;
    this.scopeName = options.snapshot.name;
    this.load(options.snapshot);

    // A macro's functions schedule through the one transport, as they do on the host.
    this.transport = outer ? outer.transport : this.makeTransport();
    const api = ((selector?: string) =>
      selector === undefined
        ? this.makeChain([], [])
        : this.makeSelection(this.find(selector), selector)) as unknown as ScopeApi;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const remote = this;
    const scopeView = {
      get name() {
        return remote.scopeName;
      },
      $: api,
      chain: () => this.makeChain([], []),
      select: (selector: string) => this.makeSelection(this.find(selector), selector),
      bus: (name: string) => this.bus(name),
      describe: () => this.describe(),
      transport: this.transport,
    };
    Object.defineProperties(api, {
      scope: { value: scopeView, enumerable: true },
      bus: { value: scopeView.bus, enumerable: true },
      transport: { value: this.transport, enumerable: true },
    });
    this.$ = api;
    this.scopeView = scopeView;
  }

  private addType(info: NodeTypeInfo): void {
    const type = info.type;
    this.types.set(type, info);
    Object.defineProperty(this.Chain.prototype, type, {
      configurable: true,
      writable: true,
      value(this: RemoteChain, init: unknown) {
        return this.add(type, init);
      },
    });
    for (const meta of info.params) {
      const name = meta.name;
      if (name in this.Selection.prototype) continue;
      Object.defineProperty(this.Selection.prototype, name, {
        configurable: true,
        writable: true,
        value(this: RemoteSelection, value: ParamValue, options?: At) {
          return this.set({ [name]: value }, options);
        },
      });
    }
  }

  /** Replaces the mirror with the host's account of the scope. */
  private load(snapshot: ScopeSnapshot): void {
    this.scopeName = snapshot.name;
    this.nodes = new Map();
    this.edges = new Map();
    for (const data of snapshot.graph.nodes) {
      const info = this.types.get(data.type);
      if (!info) continue;
      this.nodes.set(
        data.id,
        new RemoteNode(
          this,
          info,
          data.id,
          new Set(data.classes ?? []),
          data.tags ?? {},
          { ...data.params },
          data.init ?? {},
          data.bypass ?? false,
        ),
      );
    }
    for (const edge of snapshot.graph.edges) this.edges.set(JSON.stringify(edge), edge);
    this.buses = new Map(
      snapshot.buses.map((bus) => [bus.name, new RemoteBus(this, bus.name, bus.to, bus.gain)]),
    );
  }

  // --- Time and sending ---------------------------------------------------------------------------

  /** The time to stamp on a command: the one given, else the current event's, else 0 for "now". */
  time(options?: At): number {
    return options?.at ?? this.eventTime ?? this.outer?.time() ?? 0;
  }

  emit(command: Command, early = false): void {
    (early ? this.early : this.late).push(command);
    this.queueFlush();
  }

  private markDirty(): void {
    this.dirty = true;
    this.queueFlush();
  }

  private queueFlush(): void {
    if (this.flushQueued) return;
    this.flushQueued = true;
    queueMicrotask(() => {
      this.flushQueued = false;
      this.flush();
    });
  }

  flush(): void {
    // A build sends everything at once when it ends, or nothing if it fails.
    if (this.declared) return;
    const definitions = this.definitions;
    this.definitions = [];
    for (const macro of definitions) this.options.send({ type: 'define', macro });
    if (!this.dirty && this.early.length === 0 && this.late.length === 0) return;
    const apply: Command[] = this.dirty ? [{ op: 'apply', graph: this.describe() }] : [];
    const commands = [...this.early, ...apply, ...this.late];
    this.early = [];
    this.late = [];
    this.dirty = false;
    this.options.send({ type: 'commands', commands });
  }

  // --- Selecting and building ---------------------------------------------------------------------

  find(selector: string): RemoteNode[] {
    return selecting(() => select(selector, this.tree, null));
  }

  select(nodes: readonly RemoteNode[]): RemoteSelection {
    return this.makeSelection(nodes);
  }

  makeSelection(nodes: readonly RemoteNode[], selector: string | null = null): RemoteSelection {
    return new this.Selection(this, nodes, selector);
  }

  makeChain(tail: readonly Source[], all: readonly RemoteNode[]): RemoteChain {
    return new this.Chain(this, tail, all);
  }

  createNode(type: string, rawInit: unknown): RemoteNode {
    const info = this.types.get(type);
    if (!info) throw new CrackedUpError('unknown-type', `There is no node type called "${type}".`);
    let source: Record<string, unknown>;
    if (rawInit === undefined || rawInit === null) source = {};
    else if (typeof rawInit === 'object') source = rawInit as Record<string, unknown>;
    else if (info.shorthand !== null) source = { [info.shorthand]: rawInit };
    else {
      throw new CrackedUpError(
        'invalid-param',
        `${type}() takes an options object; it has no shorthand argument.`,
      );
    }

    const paramNames = new Set(info.params.map((meta) => meta.name));
    const values: Record<string, ParamValue> = {};
    const init: Record<string, Json> = {};
    for (const [key, value] of Object.entries(source)) {
      if (value === undefined || COMMON_KEYS.has(key)) continue;
      if (paramNames.has(key)) values[key] = value as ParamValue;
      else init[key] = value as Json;
    }
    if (typeof source['modulates'] === 'string') init['modulates'] = source['modulates'];

    const givenId = source['id'];
    if (givenId !== undefined && (typeof givenId !== 'string' || givenId === '')) {
      throw new CrackedUpError('duplicate-id', 'A node id must be a non-empty string.');
    }
    const id = givenId ?? this.nextAutoId(type);
    if (this.nodes.has(id)) {
      throw new CrackedUpError('duplicate-id', `There is already a node with the id "${id}".`, {
        nodeId: id,
      });
    }
    const classInput = source['class'];
    const classes =
      typeof classInput === 'string'
        ? classInput.split(/\s+/).filter(Boolean)
        : Array.isArray(classInput)
          ? (classInput as string[])
          : [];
    const node = new RemoteNode(
      this,
      info,
      id,
      new Set(classes),
      (source['tags'] as Tags | undefined) ?? {},
      values,
      init,
      source['bypass'] === true,
    );
    this.nodes.set(id, node);
    const macro = this.macros.get(type);
    if (macro) {
      try {
        const instance = this.instanceOf(node, macro, init);
        init['remote'] = { graph: instance.graph as unknown as Json, signature: macro.signature };
      } catch (error) {
        this.nodes.delete(id);
        throw error;
      }
    }
    this.markDirty();
    return node;
  }

  // --- Macros defined here ------------------------------------------------------------------------

  define(definition: MacroDefinition): void {
    if (this.outer) return this.outer.define(definition);
    const type = definition.type;
    if (typeof type !== 'string' || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(type)) {
      throw new CrackedUpError('unknown-type', `"${String(type)}" is not a valid node type name.`);
    }
    if (this.types.has(type) && !this.macros.has(type)) {
      throw new CrackedUpError(
        'unknown-type',
        `"${type}" is already a node type on the host and cannot be redefined here.`,
      );
    }
    if (type in RemoteChain.prototype) {
      throw new CrackedUpError('unknown-type', `"${type}" is the name of a chain method.`);
    }
    const params: Record<string, RemoteMacroData['params'][string]> = {};
    for (const [name, spec] of Object.entries(definition.params)) {
      params[name] = {
        ...spec,
        drives: spec.drives.map((drive) => {
          if (typeof drive.scale === 'function') {
            throw new CrackedUpError(
              'unsupported',
              `${type}.${name}: a drive's "scale" cannot be a function in a sandboxed macro, because ` +
                'it runs on the host. Write it as data: scale: { multiply: 1.01 } or { add: 7 }.',
            );
          }
          return {
            select: drive.select,
            param: drive.param,
            ...(drive.scale ? { scale: drive.scale } : {}),
          };
        }),
      };
    }
    const methods = [
      ...Object.keys(definition.methods ?? {}),
      ...(definition.trigger ? ['trigger'] : []),
      ...(definition.release ? ['release'] : []),
    ];
    const info: NodeTypeInfo = {
      type,
      category: definition.category ?? 'utility',
      description: definition.description ?? '',
      isMacro: true,
      triggerable: definition.trigger !== undefined,
      shorthand: definition.shorthand ?? null,
      modulates: null,
      params: Object.entries(definition.params).map(([name, spec]) =>
        normalizeParamMeta(name, spec),
      ),
      options: definition.options ?? {},
      triggerOptions: definition.triggerOptions ?? {},
    };
    this.addType(info);
    // The signature changes when the host's side of the definition must, which replaces old instances.
    this.macros.set(type, { definition, signature: JSON.stringify({ params, methods }) });
    const graph = this.spawn(type, definition, {}, null).describe();
    this.definitions.push({
      type,
      category: info.category,
      description: info.description,
      params,
      ...(definition.shorthand === undefined ? {} : { shorthand: definition.shorthand }),
      options: info.options,
      triggerOptions: info.triggerOptions,
      graph,
      methods,
    });
    this.queueFlush();
  }

  private contextFor(node: RemoteNode | null, id: string, time: number): MacroContext {
    return {
      id,
      time,
      value: (name) => {
        if (node) return node.param(name).value;
        const meta = this.types.get(id)?.params.find((param) => param.name === name);
        if (!meta) throw new CrackedUpError('invalid-param', `There is no parameter "${name}".`);
        return meta.default;
      },
      random: () => Math.random(),
    };
  }

  /** Makes the remote for one macro instance and runs the definition's `build` in it. */
  private spawn(
    type: string,
    definition: MacroDefinition,
    init: Readonly<Record<string, unknown>>,
    node: RemoteNode | null,
  ): RemoteImpl {
    const id = node?.id ?? type;
    const inner: RemoteImpl = new RemoteImpl(
      {
        send: (message: RemoteMessage) => {
          if (message.type === 'commands') {
            this.emit({ op: 'inside', node: id, commands: message.commands });
          }
        },
        snapshot: {
          name: `${this.scopeName}/${id}`,
          graph: { nodes: [], edges: [] },
          buses: [
            { name: 'in', to: null, gain: 1 },
            { name: 'out', to: null, gain: 1 },
          ],
        },
        transport: this.transportState,
        types: [],
      },
      this,
    );
    definition.build(inner.$, init, this.contextFor(node, id, this.time()));
    // What it built travels as the instance's graph, not as commands.
    inner.early = [];
    inner.late = [];
    inner.dirty = false;
    return inner;
  }

  private instanceOf(
    node: RemoteNode,
    macro: { definition: MacroDefinition; signature: string },
    init: Readonly<Record<string, unknown>>,
  ): Instance {
    const key = JSON.stringify([node.type, init, macro.signature, String(macro.definition.build)]);
    const previous = this.previousInstances?.get(node.id);
    let instance: Instance;
    if (previous && previous.key === key) {
      instance = previous;
    } else {
      const remote = this.spawn(node.type, macro.definition, init, node);
      instance = { remote, key, graph: remote.describe() };
    }
    this.instances.set(node.id, instance);
    return instance;
  }

  /** Runs one of a macro's functions for an instance, as the host asked. */
  private callMacro(
    path: readonly string[],
    method: string,
    args: Readonly<Record<string, Json>>,
    at: number,
  ): void {
    const [id, ...rest] = path;
    if (id === undefined) return;
    const node = this.nodes.get(id);
    const macro = node && this.macros.get(node.type);
    if (!node || !macro) return;
    // An instance made on the host has no remote here yet: make one from the definition.
    const instance =
      this.instances.get(id) ?? this.instanceOf(node, macro, this.userInit(node.init));
    if (rest.length > 0) {
      instance.remote.callMacro(rest, method, args, at);
      instance.remote.flush();
      return;
    }

    const inner = instance.remote;
    const context = this.contextFor(node, id, at);
    const { definition } = macro;
    inner.eventTime = at;
    try {
      if (method === 'trigger') definition.trigger?.(inner.$, { ...args, at }, context);
      else if (method === 'release') definition.release?.(inner.$, { ...args, at }, context);
      else definition.methods?.[method]?.(inner.$, args, at, context);
    } catch (thrown) {
      this.reportError({
        code: 'callback',
        message: thrown instanceof Error ? thrown.message : String(thrown),
        nodeId: id,
      });
    } finally {
      inner.eventTime = null;
    }
    inner.flush();
  }

  private userInit(init: Readonly<Record<string, Json>>): Record<string, Json> {
    const { remote: _remote, ...rest } = init;
    void _remote;
    return rest;
  }

  /**
   * Ids count up per type. The host matches nodes by id, so the second `lowpass` a rebuilt script
   * makes is matched with the second `lowpass` it made last time.
   */
  private nextAutoId(type: string): string {
    let n = this.autoIds.get(type) ?? 0;
    while (this.nodes.has(`${type}-${n}`)) n++;
    this.autoIds.set(type, n + 1);
    return `${type}-${n}`;
  }

  removeNodes(nodes: readonly RemoteNode[]): void {
    for (const node of nodes) {
      if (this.nodes.get(node.id) !== node) continue;
      node.disposed = true;
      this.nodes.delete(node.id);
      this.instances.delete(node.id);
      for (const [key, edge] of this.edges) {
        if (edge.from === node.id || ('node' in edge.to && edge.to.node === node.id)) {
          this.edges.delete(key);
        }
      }
    }
    this.markDirty();
  }

  // --- Connections --------------------------------------------------------------------------------

  refOf(source: Source): EdgeFrom {
    return source instanceof RemoteNode ? source.id : { bus: source.name };
  }

  addEdge(from: EdgeFrom, to: EdgeTarget): void {
    const edge: EdgeData = { from, to };
    const key = JSON.stringify(edge);
    if (this.edges.has(key)) return;
    this.edges.set(key, edge);
    this.markDirty();
  }

  private endsOf(target: ConnectTarget): EdgeTarget[] {
    if (typeof target === 'string') {
      const nodes = this.find(target);
      if (nodes.length === 0) {
        throw new CrackedUpError(
          'missing-target',
          `Nothing matches "${target}", so there is nothing to connect to.`,
        );
      }
      return nodes.map((node) => ({ node: node.id }));
    }
    if (target instanceof RemoteSelection) return target.nodes.map((node) => ({ node: node.id }));
    if (target instanceof RemoteNode) return [{ node: target.id }];
    if (target instanceof RemoteBus) return [{ bus: target.name }];
    if (target instanceof RemoteParam) return [{ node: target.node.id, param: target.name }];
    throw new CrackedUpError(
      'missing-target',
      'connect() needs a selector, selection, node, bus or parameter.',
    );
  }

  connect(from: Source, target: ConnectTarget): void {
    for (const end of this.endsOf(target)) this.addEdge(this.refOf(from), end);
  }

  /** The host looks the name up from the scope outward, so `main` needs no declaring here. */
  connectToBus(from: Source, bus: string | RemoteBus): void {
    this.addEdge(this.refOf(from), { bus: typeof bus === 'string' ? bus : bus.name });
  }

  disconnect(from: RemoteNode, target?: ConnectTarget): void {
    const ends =
      target === undefined ? null : this.endsOf(target).map((end) => JSON.stringify(end));
    for (const [key, edge] of this.edges) {
      if (edge.from !== from.id) continue;
      if (ends === null || ends.includes(JSON.stringify(edge.to))) this.edges.delete(key);
    }
    this.markDirty();
  }

  private describeEnd(end: EdgeFrom | EdgeTarget): unknown {
    if (typeof end === 'string') return this.nodes.get(end);
    if ('bus' in end) return this.buses.get(end.bus) ?? { name: end.bus };
    const node = this.nodes.get(end.node);
    return 'param' in end ? node?.findParam(end.param) : node;
  }

  edgesFrom(node: RemoteNode): { from: unknown; to: unknown }[] {
    return [...this.edges.values()]
      .filter((edge) => edge.from === node.id)
      .map((edge) => ({ from: node, to: this.describeEnd(edge.to) }));
  }

  edgesInto(node: RemoteNode): { from: unknown; to: unknown }[] {
    return [...this.edges.values()]
      .filter((edge) => 'node' in edge.to && edge.to.node === node.id && !('param' in edge.to))
      .map((edge) => ({ from: this.describeEnd(edge.from), to: node }));
  }

  bus(name: string): RemoteBus {
    let bus = this.buses.get(name);
    if (!bus) {
      bus = new RemoteBus(this, name, 'main', 1);
      this.buses.set(name, bus);
    }
    // Sent every time: the host returns the bus if it exists, and a rebuild must ask for it again.
    this.emit({ op: 'bus', name }, true);
    return bus;
  }

  describe(): GraphData {
    return {
      nodes: [...this.nodes.values()].map((node) => node.toData()),
      edges: [...this.edges.values()],
    };
  }

  // --- Rebuilding ---------------------------------------------------------------------------------

  build(fn: (api: ScopeApi) => void): void {
    if (this.declared) {
      throw new CrackedUpError('build-failed', 'build() cannot be nested.');
    }
    this.flush();
    const saved = {
      nodes: this.nodes,
      edges: this.edges,
      autoIds: this.autoIds,
      sequences: new Map(this.sequences),
      onces: new Map(this.onces),
      autoNames: this.autoNames,
      buses: new Map(this.buses),
      transport: this.transportState,
      instances: this.instances,
      macros: new Map(this.macros),
      types: new Map(this.types),
    };
    this.nodes = new Map();
    this.edges = new Map();
    this.autoIds = new Map();
    this.autoNames = new Map();
    this.instances = new Map();
    this.previousInstances = saved.instances;
    this.declared = new Set();
    try {
      fn(this.$);
    } catch (error) {
      Object.assign(this, {
        nodes: saved.nodes,
        edges: saved.edges,
        autoIds: saved.autoIds,
        sequences: saved.sequences,
        onces: saved.onces,
        autoNames: saved.autoNames,
        buses: saved.buses,
        transportState: saved.transport,
        instances: saved.instances,
        previousInstances: null,
        definitions: [],
      });
      // The type tables are shared with instance remotes, so they are refilled, not replaced.
      this.macros.clear();
      for (const [type, macro] of saved.macros) this.macros.set(type, macro);
      this.types.clear();
      for (const [type, info] of saved.types) this.types.set(type, info);
      this.early = [];
      this.late = [];
      this.dirty = false;
      this.declared = null;
      throw error;
    }
    for (const name of [...saved.sequences.keys(), ...saved.onces.keys()]) {
      if (this.declared.has(name)) continue;
      this.sequences.delete(name);
      this.onces.delete(name);
      this.late.push({ op: 'clearSequence', name });
    }
    this.previousInstances = null;
    this.declared = null;
    this.dirty = true;
    this.flush();
  }

  // --- Transport ----------------------------------------------------------------------------------

  clearSequence(name: string): void {
    const had = this.sequences.delete(name);
    if (!this.onces.delete(name) && !had) return;
    this.emit({ op: 'clearSequence', name });
  }

  /** A name for something scheduled without one. Counted per build, so a rebuild reuses the names. */
  private autoName(kind: string): string {
    const n = this.autoNames.get(kind) ?? 0;
    this.autoNames.set(kind, n + 1);
    return `${kind}:${n}`;
  }

  private makeTransport(): RemoteTransport {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const remote = this;
    const sequence = (
      first: string | SequenceOptions,
      second: SequenceOptions | SequenceCallback,
      third?: SequenceCallback,
    ): Sequence => {
      const named = typeof first === 'string';
      const name = named ? first : remote.autoName('sequence');
      const options = (named ? second : first) as SequenceOptions;
      const callback = (named ? third : second) as SequenceCallback;
      if (name === '') throw new TypeError('A sequence name cannot be empty.');
      if (typeof callback !== 'function') {
        throw new TypeError('A sequence needs a callback function.');
      }
      const created = new RemoteSequence(remote, name, { ...options }, callback);
      remote.sequences.set(name, created);
      remote.declared?.add(name);
      remote.emit({ op: 'sequence', name, options: created.options });
      return created as unknown as Sequence;
    };
    const steps = (
      first: string | Pattern,
      second: Pattern | StepCallback,
      third?: StepCallback,
    ): Sequence => {
      // With three arguments the first is a name; with two it is the pattern.
      const callback = (third ?? second) as StepCallback;
      const run: SequenceCallback = (event) =>
        callback(event.index, event.value, event.steps, event);
      return third === undefined
        ? sequence({ steps: first }, run)
        : sequence(first as string, { steps: second as Pattern }, run);
    };
    const transport: RemoteTransport = {
      get bpm() {
        return remote.transportState.bpm;
      },
      set bpm(value: number) {
        remote.transportState = { ...remote.transportState, bpm: value };
        remote.emit({ op: 'transport', set: { bpm: value } });
      },
      get swing() {
        return remote.transportState.swing;
      },
      set swing(value: number) {
        remote.transportState = { ...remote.transportState, swing: value };
        remote.emit({ op: 'transport', set: { swing: value } });
      },
      get timeSignature() {
        return remote.transportState.timeSignature;
      },
      get stepLength() {
        return remote.transportState.stepLength;
      },
      get state() {
        return remote.transportState.state;
      },
      sequence,
      steps,
      at(position: Position, callback: (event: ScheduledEvent) => void) {
        const name = remote.autoName('at');
        remote.onces.set(name, callback);
        remote.declared?.add(name);
        remote.emit({ op: 'once', name, position });
        return () => remote.clearSequence(name);
      },
      every(interval, callback, options) {
        const name = remote.autoName('every');
        sequence(name, { steps: 1, step: interval, ...options }, (event) =>
          callback({ time: event.time, beat: event.beat, bar: event.bar }),
        );
        return () => remote.clearSequence(name);
      },
      get: (name: string) => remote.sequences.get(name) as unknown as Sequence | undefined,
      clear(name?: string) {
        const all = [...remote.sequences.keys(), ...remote.onces.keys()];
        for (const each of name === undefined ? all : [name]) {
          remote.clearSequence(each);
        }
        return transport;
      },
      on(event: string, listener: (bpm: number) => void) {
        const entry = { event, listener };
        remote.transportListeners.add(entry);
        return () => {
          remote.transportListeners.delete(entry);
        };
      },
      seconds: (duration: Duration) =>
        beatsToSeconds(
          durationToBeats(duration, remote.transportState.timeSignature),
          remote.transportState.bpm,
        ),
    };
    return transport;
  }

  // --- Messages from the host ---------------------------------------------------------------------

  receive(message: HostMessage): void {
    switch (message.type) {
      case 'event': {
        const once = this.onces.get(message.event.name);
        if (once) {
          this.onces.delete(message.event.name);
          const { time, beat, bar } = message.event;
          this.eventTime = time;
          try {
            once({ time, beat, bar });
          } catch (thrown) {
            this.reportError({
              code: 'callback',
              message: thrown instanceof Error ? thrown.message : String(thrown),
            });
          } finally {
            this.eventTime = null;
          }
          this.flush();
          return;
        }
        const sequence = this.sequences.get(message.event.name);
        if (!sequence) return;
        sequence.steps = [...message.steps];
        if (sequence.muted) return;
        const { time, duration } = message.event;
        const event: SequenceEvent = {
          ...message.event,
          steps: sequence.steps,
          sequence: sequence as unknown as Sequence,
          at: (fraction: number) => time + duration * fraction,
        };
        this.eventTime = time;
        try {
          sequence.callback(event);
        } catch (thrown) {
          this.reportError({
            code: 'callback',
            message: thrown instanceof Error ? thrown.message : String(thrown),
          });
        } finally {
          this.eventTime = null;
        }
        // Send now: the commands have to reach the host before the event's time.
        this.flush();
        return;
      }
      case 'transport': {
        const before = this.transportState;
        this.transportState = message.transport;
        const fire = (event: string): void => {
          for (const entry of [...this.transportListeners]) {
            if (entry.event === event) entry.listener(message.transport.bpm);
          }
        };
        if (before.bpm !== message.transport.bpm) fire('tempo');
        if (before.state !== message.transport.state) {
          fire(message.transport.state === 'started' ? 'start' : 'stop');
        }
        return;
      }
      case 'params':
        for (const change of message.changes) {
          this.nodes.get(change.node)?.findParam(change.param)?.assign(change.value, 0);
        }
        return;
      case 'snapshot':
        // If this side has unsent graph changes, they are about to replace the host's graph anyway.
        if (!this.dirty) this.load(message.snapshot);
        return;
      case 'error':
        this.reportError(message.error);
        return;
      case 'buffer':
        this.bufferInfo.set(message.key, {
          key: message.key,
          duration: message.duration,
          slices: message.slices,
        });
        return;
      case 'call':
        this.callMacro(message.path, message.method, message.args, message.at);
        this.flush();
        return;
    }
  }

  private reportError(error: RemoteError): void {
    if (this.errorListeners.size === 0) console.error(`cracked-up: ${error.message}`);
    for (const listener of [...this.errorListeners]) listener(error);
  }

  onError(listener: (error: RemoteError) => void): () => void {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  }
}

/** Creates the scripting API for code that runs away from the audio graph. See `Remote`. */
export function createRemote(options: RemoteOptions): Remote {
  const remote = new RemoteImpl(options);
  return {
    __: remote.$,
    transport: remote.transport,
    buffers: remote.buffers,
    define: (definition) => remote.define(definition),
    receive: (message) => remote.receive(message),
    build: (fn) => remote.build(fn),
    describe: () => remote.describe(),
    flush: () => remote.flush(),
    on: (_event, listener) => remote.onError(listener),
  };
}
