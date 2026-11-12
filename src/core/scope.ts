import type {
  ApplyResult,
  Command,
  EdgeData,
  GraphData,
  Json,
  NodeData,
  ParamChange,
  ParamValue,
  ScopeApi,
  ScopeEvents,
  ScopeSnapshot,
  Tags,
  Unsubscribe,
} from '../api';
import { SelectorError, select } from '../selector';
import type { SelectableTree } from '../selector';
import { BusImpl, BusView } from './bus';
import type { ChainImpl } from './chain';
import { execute } from './commands';
import type { EngineImpl } from './engine';
import { CrackedUpError, Emitter, toGraphError } from './errors';
import { NodeImpl, connect, disconnectEdge } from './node';
import type { EdgeEnd, EdgeImpl } from './node';
import { ParamImpl } from './param';
import type { SelectionImpl } from './selection';
import type { TransportView } from './transport';

const COMMON_KEYS = new Set(['id', 'class', 'tags', 'bypass', 'modulates']);

/** What a rebuild asked a kept node to be. Applied when the rebuild succeeds. */
interface PendingUpdate {
  values: Readonly<Record<string, ParamValue>>;
  classes: readonly string[];
  tags: Tags;
  bypass: boolean;
}

/**
 * Bookkeeping while `build()` or `apply()` runs. During that time creating a node first looks for the
 * node it was last time (same id, or same position among nodes of its type) and reuses it.
 */
interface BuildState {
  /** Nodes this run has asked for, kept or new, in the order it asked. */
  order: NodeImpl[];
  claimed: Set<NodeImpl>;
  created: Set<NodeImpl>;
  /** Old nodes whose id was taken by a new node of a different type or with different options. */
  superseded: NodeImpl[];
  pending: Map<NodeImpl, PendingUpdate>;
  autoIds: Map<string, number>;
  /** Connections that existed before the run. Those not asked for again are removed at the end. */
  preEdges: Set<EdgeImpl>;
  claimedEdges: Set<EdgeImpl>;
  newEdges: EdgeImpl[];
  buses: Set<BusImpl>;
  newBuses: BusImpl[];
  /** Buses whose destination this run set. */
  routed: Set<BusImpl>;
}

interface ReconcileOptions {
  /** Also reconcile what is scheduled through the scope's transport and the buses earlier builds made. */
  full: boolean;
}

function sameJson(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const proto = Object.getPrototypeOf(a) as unknown;
  if (proto !== Object.getPrototypeOf(b)) return false;
  // Only plain data is compared by content. Anything else (a buffer, a function) must be the same object.
  if (!Array.isArray(a) && proto !== Object.prototype && proto !== null) return false;
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  return keysA.every(
    (key) =>
      Object.hasOwn(b, key) &&
      sameJson((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

/** Runs a selector operation, turning a parse failure into the library's own error type. */
export function wrapSelectorErrors<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof SelectorError) {
      throw new CrackedUpError('invalid-selector', error.message, { cause: error });
    }
    throw error;
  }
}

export class ScopeImpl {
  readonly name: string;
  readonly engine: EngineImpl;
  readonly parent: ScopeImpl | null;
  /** For a macro's private scope: the macro instance it belongs to. */
  readonly owner: NodeImpl | null;
  readonly $: ScopeApi;

  private childScopes: ScopeImpl[] = [];
  /** Top-level nodes in creation order. */
  private nodeList: NodeImpl[] = [];
  private byId = new Map<string, NodeImpl>();
  private buses = new Map<string, BusImpl>();
  private autoIds = new Map<string, number>();
  private events = new Emitter<ScopeEvents>();
  private disposed = false;
  private building: BuildState | null = null;
  /** Buses made inside a `build()`, which a later build removes if it no longer asks for them. */
  private builtBuses = new Set<BusImpl>();

  private tree: SelectableTree<NodeImpl> = {
    children: (parent) => (parent === null ? this.topLevelNodes() : parent.inner),
  };

  constructor(
    engine: EngineImpl,
    name: string,
    parent: ScopeImpl | null,
    owner: NodeImpl | null = null,
  ) {
    this.engine = engine;
    this.name = name;
    this.parent = parent;
    this.owner = owner;

    const api = ((selector?: string) =>
      selector === undefined ? this.chain() : this.select(selector)) as unknown as ScopeApi;
    Object.defineProperties(api, {
      scope: { value: this, enumerable: true },
      bus: { value: (busName: string) => this.bus(busName), enumerable: true },
      transport: { get: () => this.transport, enumerable: true },
    });
    this.$ = api;
  }

  /**
   * The transport as this scope sees it. Sequence names are this scope's own, and what is scheduled
   * through it is removed when the scope is disposed. The root scope shares the engine's view.
   */
  get transport(): TransportView {
    return this.engine.transportImpl.view(this.transportOwner);
  }

  private get transportOwner(): ScopeImpl | null {
    return this.parent === null && this.owner === null ? null : this;
  }

  get children(): readonly ScopeImpl[] {
    return this.childScopes;
  }

  /** This scope's own top-level nodes. */
  get nodes(): readonly NodeImpl[] {
    return this.nodeList;
  }

  scope(name: string): ScopeImpl {
    let child = this.childScopes.find((scope) => scope.name === name);
    if (!child) {
      child = new ScopeImpl(this.engine, name, this);
      this.childScopes.push(child);
    }
    return child;
  }

  // --- Building and selecting ---------------------------------------------------------------------

  chain(): ChainImpl {
    return this.engine.createChain(this, [], []);
  }

  select(selector: string): SelectionImpl {
    const nodes = wrapSelectorErrors(() => select(selector, this.tree, null));
    return this.engine.createSelection(this, nodes);
  }

  /** This scope's top-level nodes followed by those of its child scopes, depth first. */
  private topLevelNodes(): readonly NodeImpl[] {
    // During a rebuild only what it has asked for so far can be selected, as in a first build.
    const own = this.building ? this.building.order : this.nodeList;
    if (this.childScopes.length === 0) return own;
    return [...own, ...this.childScopes.flatMap((child) => child.topLevelNodes())];
  }

  node(id: string): NodeImpl | undefined {
    return this.byId.get(id);
  }

  /**
   * Creates a node from what a chain method or graph description supplies: a bare shorthand value, or
   * an object mixing parameter values, creation options and the common options (id, class, tags).
   */
  createNode(type: string, rawInit: unknown): NodeImpl {
    this.assertLive();
    const entry = this.engine.registryImpl.entry(type);
    let source: Record<string, unknown>;
    if (rawInit === undefined || rawInit === null) {
      source = {};
    } else if (typeof rawInit === 'object') {
      source = rawInit as Record<string, unknown>;
    } else if (entry.shorthand !== null) {
      source = { [entry.shorthand]: rawInit };
    } else {
      throw new CrackedUpError(
        'invalid-param',
        `${type}() takes an options object; it has no shorthand argument.`,
      );
    }

    const values: Record<string, ParamValue> = {};
    const init: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(source)) {
      if (value === undefined || COMMON_KEYS.has(key)) continue;
      if (entry.params.has(key)) values[key] = value as ParamValue;
      else init[key] = value;
    }

    const givenId = source['id'];
    if (givenId !== undefined && (typeof givenId !== 'string' || givenId === '')) {
      throw new CrackedUpError('duplicate-id', `A node id must be a non-empty string.`);
    }
    const build = this.building;
    let id: string;
    let previous: NodeImpl | undefined;
    if (givenId !== undefined) {
      id = givenId;
      previous = this.byId.get(id);
      if (previous && (!build || build.claimed.has(previous))) {
        throw new CrackedUpError(
          'duplicate-id',
          `Scope "${this.name}" already has a node with the id "${id}".`,
          { nodeId: id },
        );
      }
    } else if (build) {
      [id, previous] = this.nextBuildId(type, build);
    } else {
      id = this.nextAutoId(type);
    }

    const classInput = source['class'];
    const classes =
      typeof classInput === 'string'
        ? classInput.split(/\s+/).filter(Boolean)
        : Array.isArray(classInput)
          ? (classInput as string[])
          : [];
    const givenModulates = source['modulates'];
    const modulates =
      typeof givenModulates === 'string'
        ? givenModulates
        : ((entry.definition as { modulates?: string }).modulates ?? null);
    const tags = (source['tags'] as Tags | undefined) ?? {};
    const bypass = source['bypass'] === true;

    // A rebuild keeps the node it finds if nothing fixed at creation differs. Parameter values, classes,
    // tags and bypass can all change on a living node, and do so when the rebuild succeeds.
    if (
      build &&
      previous &&
      previous.type === type &&
      previous.modulates === modulates &&
      sameJson(this.comparableInit(previous.init), this.comparableInit(init))
    ) {
      build.claimed.add(previous);
      build.order.push(previous);
      build.pending.set(previous, { values, classes, tags, bypass });
      return previous;
    }

    const node = new NodeImpl(this, entry, {
      id,
      autoId: givenId === undefined,
      classes,
      tags,
      values,
      init,
      modulates,
    });
    if (bypass) node.applyBypass(true, this.engine.now(), 0);
    this.nodeList.push(node);
    this.byId.set(id, node);
    if (build) {
      if (previous) build.superseded.push(previous);
      build.claimed.add(node);
      build.created.add(node);
      build.order.push(node);
    } else {
      this.announce(node);
    }
    return node;
  }

  private announce(node: NodeImpl): void {
    node.announced = true;
    this.events.emit('node:added', node as never);
  }

  /** Creation options with stored buffers replaced by their keys, so a buffer and its key compare equal. */
  private comparableInit(init: Readonly<Record<string, unknown>>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(init)) {
      out[key] = this.engine.buffersImpl.keyOf(value) ?? value;
    }
    return out;
  }

  /**
   * The id for a node created without one during a rebuild, and the node that had it before, if that
   * node can be reused. Ids count up per type, so the second `lowpass` built is always `lowpass-1`:
   * that is what matches un-id'd nodes to their previous selves by position.
   */
  private nextBuildId(type: string, build: BuildState): [string, NodeImpl | undefined] {
    let n = build.autoIds.get(type) ?? 0;
    for (;;) {
      const id = `${type}-${n++}`;
      const found = this.byId.get(id);
      if (found && (build.claimed.has(found) || found.type !== type)) continue;
      build.autoIds.set(type, n);
      return [id, found];
    }
  }

  /** Undoes a node whose creation could not be completed, unless a rebuild is reusing an older node. */
  discard(node: NodeImpl): void {
    const build = this.building;
    if (build && !build.created.has(node)) return;
    node.dispose();
  }

  /** Called when a bus of this scope is given a destination. */
  noteRoute(bus: BusImpl): void {
    if (bus.scope === this) this.building?.routed.add(bus);
  }

  /** Called for every connection asked for from one of this scope's nodes, new or already there. */
  noteEdge(edge: EdgeImpl, isNew: boolean): void {
    if (!this.building) return;
    if (isNew) this.building.newEdges.push(edge);
    else this.building.claimedEdges.add(edge);
  }

  /** Whether a connection comes into this scope from a bus of an outer one (a chain continued from it). */
  private fromOuterBus(edge: EdgeImpl): boolean {
    return edge.from.scope !== this && edge.to instanceof NodeImpl && edge.to.scope === this;
  }

  /**
   * The private scope of a macro instance. It has no parent, so nothing inside can reach the buses or
   * nodes outside, and it is not listed among this scope's children.
   */
  createInnerScope(owner: NodeImpl): ScopeImpl {
    return new ScopeImpl(this.engine, `${this.name}/${owner.id}`, null, owner);
  }

  /** A node that belongs to the scope's internals (a bus's gain) and is not listed or selectable. */
  createHiddenNode(type: string, id: string): NodeImpl {
    return new NodeImpl(this, this.engine.registryImpl.entry(type), {
      id,
      autoId: false,
      classes: [],
      tags: {},
      values: {},
      init: {},
      modulates: null,
    });
  }

  /** Called by a node when it is disposed. */
  forget(node: NodeImpl): void {
    const index = this.nodeList.indexOf(node);
    if (index === -1) return;
    this.nodeList.splice(index, 1);
    if (this.byId.get(node.id) === node) this.byId.delete(node.id);
    if (node.announced) this.events.emit('node:removed', node.id);
  }

  private nextAutoId(type: string): string {
    let n = this.autoIds.get(type) ?? 0;
    while (this.byId.has(`${type}-${n}`)) n++;
    this.autoIds.set(type, n + 1);
    return `${type}-${n}`;
  }

  // --- Buses --------------------------------------------------------------------------------------

  bus(name: string): BusImpl | BusView {
    const bus = this.busImpl(name);
    return bus.scope === this ? bus : new BusView(bus, this);
  }

  /** The bus itself, whichever scope it belongs to. */
  busImpl(name: string): BusImpl {
    this.assertLive();
    let bus = this.lineage()
      .map((scope) => scope.buses.get(name))
      .find((found) => found !== undefined);
    if (!bus) {
      bus = new BusImpl(this, name);
      this.buses.set(name, bus);
      // The engine's own `main` feeds the output. Every other bus feeds that one until rerouted,
      // except inside a macro, whose buses are its ports and are wired up by whoever uses the macro.
      if (!this.owner) bus.route(this.engine.mainBus ?? null);
      this.building?.newBuses.push(bus);
    }
    if (bus.scope === this) this.building?.buses.add(bus);
    return bus;
  }

  /** A bus of this scope itself. Taking a bus's mix is only allowed from the scope that owns it. */
  private ownBus(name: string): BusImpl {
    const bus = this.buses.get(name);
    if (!bus) {
      throw new CrackedUpError(
        'missing-target',
        `Scope "${this.name}" has no bus of its own called "${name}" to continue from.`,
      );
    }
    return bus;
  }

  /** Finds a bus by name here or in a parent scope. */
  resolveBus(name: string): BusImpl {
    const known = new Set<string>();
    for (const scope of this.lineage()) {
      const bus = scope.buses.get(name);
      if (bus) {
        if (scope === this) this.building?.buses.add(bus);
        return bus;
      }
      for (const busName of scope.buses.keys()) known.add(busName);
    }
    throw new CrackedUpError(
      'missing-target',
      `There is no bus called "${name}" in scope "${this.name}" or its parents. ` +
        `Create it first with bus("${name}"). Buses that exist: ${[...known].join(', ')}.`,
    );
  }

  /** This scope, then its parent, and so on up to the root. */
  private lineage(): ScopeImpl[] {
    const scopes: ScopeImpl[] = [];
    let scope = this.parent;
    scopes.push(this);
    while (scope) {
      scopes.push(scope);
      scope = scope.parent;
    }
    return scopes;
  }

  // --- The graph as data --------------------------------------------------------------------------

  describe(): GraphData {
    const nodes: NodeData[] = [];
    const edges: EdgeData[] = [];
    for (const node of this.nodeList) {
      const params: Record<string, ParamValue> = {};
      for (const param of Object.values(node.params)) params[param.name] = param.value;
      const init = this.serializeInit(node);
      nodes.push({
        id: node.id,
        type: node.type,
        ...(node.classes.size > 0 ? { classes: [...node.classes] } : {}),
        ...(Object.keys(node.tags).length > 0 ? { tags: node.tags } : {}),
        params,
        ...(Object.keys(init).length > 0 ? { init } : {}),
        ...(node.bypass ? { bypass: true } : {}),
      });
      for (const edge of node.outputs) {
        const to = edge.to;
        if (to instanceof NodeImpl) {
          // Connections that leave the scope cannot be named by id alone and are not described yet.
          if (to.scope === this && this.byId.get(to.id) === to) {
            edges.push({ from: node.id, to: { node: to.id } });
          }
        } else if (to instanceof ParamImpl) {
          if (to.node.scope === this && this.byId.get(to.node.id) === to.node) {
            edges.push({ from: node.id, to: { node: to.node.id, param: to.name } });
          }
        } else {
          edges.push({ from: node.id, to: { bus: to.name } });
        }
      }
    }
    // What continues from a bus (a chain started with `bus.chain()`).
    for (const bus of this.buses.values()) {
      for (const edge of bus.node.outputs) {
        if (!this.describable(edge)) continue;
        const to = edge.to;
        if (to instanceof NodeImpl) edges.push({ from: { bus: bus.name }, to: { node: to.id } });
        else if (to instanceof ParamImpl) {
          edges.push({ from: { bus: bus.name }, to: { node: to.node.id, param: to.name } });
        } else edges.push({ from: { bus: bus.name }, to: { bus: to.name } });
      }
    }
    return { nodes, edges };
  }

  /** Creation options as JSON. Buffers become their key in the engine's store. */
  private serializeInit(node: NodeImpl): Record<string, Json> {
    const out: Record<string, Json> = {};
    if (node.modulates !== null) out['modulates'] = node.modulates;
    for (const [key, value] of Object.entries(node.init)) {
      const key2 = this.engine.buffersImpl.keyOf(value);
      if (key2 !== null) out[key] = key2;
      else if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
        out[key] = value as Json;
      }
    }
    return out;
  }

  snapshot(): ScopeSnapshot {
    return {
      name: this.name,
      graph: this.describe(),
      buses: [...this.buses.values()].map((bus) => ({
        name: bus.name,
        to: bus.destinationName,
        gain: bus.gain.value,
      })),
    };
  }

  // --- Reconciliation ------------------------------------------------------------------------------

  apply(graph: GraphData): Promise<ApplyResult> {
    try {
      return Promise.resolve(this.applyNow(graph));
    } catch (thrown) {
      return Promise.reject(toGraphError(thrown, 'build-failed'));
    }
  }

  /** `apply()` without the promise: the work is synchronous, and commands need it to be. */
  applyNow(graph: GraphData): ApplyResult {
    if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
      throw new CrackedUpError(
        'invalid-command',
        'A graph needs a "nodes" list and an "edges" list.',
      );
    }
    const errors: CrackedUpError[] = [];
    const failed = new Set<string>();
    const result = this.reconcile(
      (build) => {
        for (const data of graph.nodes) {
          try {
            this.createNode(data.type, {
              ...data.init,
              ...data.params,
              id: data.id,
              class: data.classes,
              tags: data.tags,
              bypass: data.bypass,
            });
          } catch (thrown) {
            errors.push(toGraphError(thrown, 'build-failed'));
            failed.add(data.id);
            // A node that cannot be made as described stays as it was, rather than going silent.
            const old = typeof data.id === 'string' ? this.byId.get(data.id) : undefined;
            if (old && !build.claimed.has(old)) {
              build.claimed.add(old);
              build.order.push(old);
            }
          }
        }
        const wanted = (id: string): NodeImpl | null => {
          const node = this.byId.get(id);
          if (node && build.claimed.has(node)) return node;
          if (failed.has(id)) return null;
          throw new CrackedUpError(
            'missing-target',
            `A connection names the node "${id}", which the graph does not contain.`,
            { nodeId: id },
          );
        };
        for (const edge of graph.edges) {
          try {
            const from =
              typeof edge.from === 'string' ? wanted(edge.from) : this.ownBus(edge.from.bus).node;
            let to: EdgeEnd | null;
            if ('bus' in edge.to) to = this.resolveBus(edge.to.bus);
            else {
              const node = wanted(edge.to.node);
              to =
                node && 'param' in edge.to
                  ? (node.param(edge.to.param) as unknown as ParamImpl)
                  : node;
            }
            if (from && to) connect(from, to);
          } catch (thrown) {
            errors.push(toGraphError(thrown, 'missing-target'));
          }
        }
      },
      { full: false },
    );
    return { ...result, errors: [...errors, ...result.errors] };
  }

  build(fn: (api: ScopeApi) => void): Promise<ApplyResult> {
    try {
      return Promise.resolve(this.reconcile(() => fn(this.$), { full: true }));
    } catch (thrown) {
      return Promise.reject(toGraphError(thrown, 'build-failed'));
    }
  }

  /** Whether a connection is one `describe()` reports: it stays inside this scope or ends at a bus. */
  private describable(edge: EdgeImpl): boolean {
    const to = edge.to;
    if (to instanceof NodeImpl) return to.scope === this && this.byId.get(to.id) === to;
    if (to instanceof ParamImpl)
      return to.node.scope === this && this.byId.get(to.node.id) === to.node;
    return true;
  }

  /**
   * Runs `run`, which asks for nodes and connections, then makes the scope match what it asked for:
   * nodes it did not ask for are disposed, connections it did not ask for are removed, and kept nodes
   * take the values it gave. If `run` throws, what it made is removed and the scope is left as it was.
   */
  private reconcile(run: (build: BuildState) => void, options: ReconcileOptions): ApplyResult {
    this.assertLive();
    if (this.building) {
      throw new CrackedUpError(
        'build-failed',
        `Scope "${this.name}" is already being rebuilt; build() and apply() cannot be nested.`,
      );
    }
    const before = [...this.nodeList];
    const build: BuildState = {
      order: [],
      claimed: new Set(),
      created: new Set(),
      superseded: [],
      pending: new Map(),
      autoIds: new Map(),
      preEdges: new Set(),
      claimedEdges: new Set(),
      newEdges: [],
      buses: new Set(),
      newBuses: [],
      routed: new Set(),
    };
    if (options.full) {
      // Chains continued from an outer scope's bus are this scope's to keep or drop too.
      for (const node of before) {
        for (const edge of node.inputs) if (this.fromOuterBus(edge)) build.preEdges.add(edge);
      }
    }
    const sources = [...before, ...[...this.buses.values()].map((bus) => bus.node)];
    for (const node of sources) {
      for (const edge of node.outputs) {
        // A description cannot name a connection that leaves the scope, so applying one leaves those alone.
        if (options.full || this.describable(edge)) build.preEdges.add(edge);
      }
    }
    const schedule = options.full ? this.engine.transportImpl.collect(this.transportOwner) : null;

    this.building = build;
    try {
      run(build);
    } catch (thrown) {
      this.building = null;
      schedule?.rollback();
      for (const node of build.created) node.dispose();
      for (const old of build.superseded) this.byId.set(old.id, old);
      for (const edge of build.newEdges) disconnectEdge(edge);
      for (const bus of build.newBuses) {
        bus.dispose();
        this.buses.delete(bus.name);
      }
      throw thrown;
    }
    this.building = null;
    schedule?.commit();

    const changed = new Set<NodeImpl>();
    const touch = (edge: EdgeImpl): void => {
      changed.add(edge.from);
      if (edge.to instanceof NodeImpl) changed.add(edge.to);
      else if (edge.to instanceof ParamImpl) changed.add(edge.to.node);
    };

    const removed: string[] = [];
    for (const node of before) {
      if (build.claimed.has(node)) continue;
      for (const edge of [...node.inputs, ...node.outputs]) touch(edge);
      removed.push(node.id);
      node.dispose();
    }
    for (const edge of build.preEdges) {
      if (build.claimedEdges.has(edge) || !edge.from.outputs.includes(edge)) continue;
      touch(edge);
      disconnectEdge(edge);
    }
    for (const edge of build.newEdges) touch(edge);

    const errors: CrackedUpError[] = [];
    const now = this.engine.now();
    for (const [node, update] of build.pending) {
      try {
        if (this.updateKept(node, update, now)) changed.add(node);
      } catch (thrown) {
        errors.push(toGraphError(thrown, 'invalid-param'));
      }
    }

    this.nodeList = build.order.filter((node) => !node.disposed);
    for (const [type, n] of build.autoIds) {
      this.autoIds.set(type, Math.max(n, this.autoIds.get(type) ?? 0));
    }
    if (options.full) {
      for (const bus of [...this.builtBuses]) {
        if (build.buses.has(bus)) continue;
        bus.dispose();
        this.builtBuses.delete(bus);
        if (this.buses.get(bus.name) === bus) this.buses.delete(bus.name);
      }
      for (const bus of build.newBuses) this.builtBuses.add(bus);
      // A bus an earlier build re-routed goes back to the default unless this build routes it again.
      for (const bus of this.builtBuses) {
        if (!build.routed.has(bus) && !this.owner) bus.route(this.engine.mainBus ?? null);
      }
    }

    const added = this.nodeList.filter((node) => build.created.has(node));
    for (const node of added) this.announce(node);
    const kept = this.nodeList.filter((node) => !build.created.has(node));
    return {
      added,
      removed,
      updated: kept.filter((node) => changed.has(node)),
      unchanged: kept.filter((node) => !changed.has(node)),
      errors,
    } as unknown as ApplyResult;
  }

  /** Brings a kept node to what the rebuild asked for. Returns whether anything changed. */
  private updateKept(node: NodeImpl, update: PendingUpdate, at: number): boolean {
    let changed = false;
    for (const param of Object.values(node.params)) {
      const previous = param.value;
      const target = update.values[param.name] ?? param.meta.default;
      if (Object.is(target, previous)) continue;
      param.applySet(target, at);
      if (!Object.is(param.value, previous)) changed = true;
    }
    const sameClasses =
      update.classes.length === node.classes.size &&
      update.classes.every((name) => node.classes.has(name));
    if (!sameClasses) {
      node.classes = new Set(update.classes);
      changed = true;
    }
    if (!sameJson(node.tags, update.tags)) {
      node.tags = Object.freeze({ ...update.tags });
      changed = true;
    }
    if (node.bypass !== update.bypass) {
      node.applyBypass(update.bypass, at);
      changed = true;
    }
    return changed;
  }

  // --- Commands and events ------------------------------------------------------------------------

  /** Applies commands from elsewhere. A failing command is reported and the rest still run. */
  dispatch(commands: readonly Command[]): void {
    for (const command of commands) {
      try {
        execute(this, command);
      } catch (thrown) {
        this.report(toGraphError(thrown, 'invalid-command'));
      }
    }
  }

  paramChanged(change: ParamChange): void {
    this.events.emit('param:changed', change);
  }

  report(error: CrackedUpError): void {
    this.notify(error);
    this.engine.report(error);
  }

  /** Tells this scope's `error` listeners, and for a macro's inner scope those of the scope it is in. */
  private notify(error: CrackedUpError): void {
    this.events.emit('error', error);
    this.owner?.scope.notify(error);
  }

  on<E extends keyof ScopeEvents>(event: E, listener: ScopeEvents[E]): Unsubscribe {
    return this.events.on(event, listener);
  }

  // --- Lifetime -----------------------------------------------------------------------------------

  dispose(): void {
    if (this.disposed) return;
    for (const child of [...this.childScopes]) child.dispose();
    if (this.parent !== null || this.owner !== null) this.engine.transportImpl.release(this);
    for (const node of [...this.nodeList]) node.dispose();
    for (const bus of this.buses.values()) bus.dispose();
    this.buses.clear();
    this.disposed = true;
    if (this.parent) {
      this.parent.childScopes = this.parent.childScopes.filter((scope) => scope !== this);
    }
    this.events.clear();
  }

  private assertLive(): void {
    if (this.disposed) {
      throw new CrackedUpError('missing-target', `Scope "${this.name}" has been disposed.`);
    }
  }
}
