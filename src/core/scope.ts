import type {
  ApplyResult,
  Command,
  EdgeData,
  GraphData,
  Json,
  NodeData,
  ParamValue,
  ScopeApi,
  ScopeEvents,
  ScopeSnapshot,
  Tags,
  Unsubscribe,
} from '../api';
import { SelectorError, select } from '../selector';
import type { SelectableTree } from '../selector';
import { BusImpl } from './bus';
import type { ChainImpl } from './chain';
import { execute } from './commands';
import type { EngineImpl } from './engine';
import { CrackedUpError, Emitter, toGraphError } from './errors';
import { NodeImpl } from './node';
import { ParamImpl } from './param';
import type { SelectionImpl } from './selection';

const COMMON_KEYS = new Set(['id', 'class', 'tags', 'bypass', 'modulates']);

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
  readonly $: ScopeApi;

  private childScopes: ScopeImpl[] = [];
  /** Top-level nodes in creation order. */
  private nodeList: NodeImpl[] = [];
  private byId = new Map<string, NodeImpl>();
  private buses = new Map<string, BusImpl>();
  private autoIds = new Map<string, number>();
  private events = new Emitter<ScopeEvents>();
  private disposed = false;

  private tree: SelectableTree<NodeImpl> = {
    children: (parent) => (parent === null ? this.topLevelNodes() : parent.inner),
  };

  constructor(engine: EngineImpl, name: string, parent: ScopeImpl | null) {
    this.engine = engine;
    this.name = name;
    this.parent = parent;

    const api = ((selector?: string) =>
      selector === undefined ? this.chain() : this.select(selector)) as unknown as ScopeApi;
    Object.defineProperties(api, {
      scope: { value: this, enumerable: true },
      bus: { value: (busName: string) => this.bus(busName), enumerable: true },
    });
    this.$ = api;
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
    if (this.childScopes.length === 0) return this.nodeList;
    return [...this.nodeList, ...this.childScopes.flatMap((child) => child.topLevelNodes())];
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
    if (entry.isMacro) {
      throw new CrackedUpError(
        'unsupported',
        `"${type}" is a macro, and macros are not implemented yet.`,
      );
    }

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
    const id = givenId ?? this.nextAutoId(type);
    if (this.byId.has(id)) {
      throw new CrackedUpError(
        'duplicate-id',
        `Scope "${this.name}" already has a node with the id "${id}".`,
        { nodeId: id },
      );
    }

    const classInput = source['class'];
    const classes =
      typeof classInput === 'string'
        ? classInput.split(/\s+/).filter(Boolean)
        : Array.isArray(classInput)
          ? (classInput as string[])
          : [];
    const modulates = source['modulates'];

    const node = new NodeImpl(this, entry, {
      id,
      autoId: givenId === undefined,
      classes,
      tags: (source['tags'] as Tags | undefined) ?? {},
      values,
      init,
      modulates: typeof modulates === 'string' ? modulates : null,
    });
    this.nodeList.push(node);
    this.byId.set(id, node);
    this.events.emit('node:added', node as never);
    return node;
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
    this.byId.delete(node.id);
    this.events.emit('node:removed', node.id);
  }

  private nextAutoId(type: string): string {
    let n = this.autoIds.get(type) ?? 0;
    while (this.byId.has(`${type}-${n}`)) n++;
    this.autoIds.set(type, n + 1);
    return `${type}-${n}`;
  }

  // --- Buses --------------------------------------------------------------------------------------

  bus(name: string): BusImpl {
    this.assertLive();
    let bus = this.buses.get(name);
    if (!bus) {
      bus = new BusImpl(this, name);
      this.buses.set(name, bus);
      // The engine's own `main` feeds the output. Every other bus feeds that one until rerouted.
      const main = this.engine.mainBus;
      bus.route(main ?? null);
    }
    return bus;
  }

  /** Finds a bus by name here or in a parent scope. */
  resolveBus(name: string): BusImpl {
    const known = new Set<string>();
    for (const scope of this.lineage()) {
      const bus = scope.buses.get(name);
      if (bus) return bus;
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

  apply(graph: GraphData): Promise<ApplyResult> {
    void graph;
    return Promise.reject(
      new CrackedUpError('unsupported', 'apply() arrives with graph reconciliation (Phase 4).'),
    );
  }

  /**
   * Runs the builder now. Reconciliation against what already exists arrives in Phase 4; until then
   * every call adds to the scope, so dispose the scope's nodes first when re-running a builder.
   */
  build(fn: (api: ScopeApi) => void): Promise<ApplyResult> {
    const added: NodeImpl[] = [];
    const stop = this.events.on('node:added', (node) => {
      added.push(node as unknown as NodeImpl);
    });
    try {
      fn(this.$);
    } catch (error) {
      return Promise.reject(toGraphError(error, 'build-failed'));
    } finally {
      stop();
    }
    return Promise.resolve({
      added,
      removed: [],
      updated: [],
      unchanged: [],
      errors: [],
    } as unknown as ApplyResult);
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

  report(error: CrackedUpError): void {
    this.events.emit('error', error);
    this.engine.report(error);
  }

  on<E extends keyof ScopeEvents>(event: E, listener: ScopeEvents[E]): Unsubscribe {
    return this.events.on(event, listener);
  }

  // --- Lifetime -----------------------------------------------------------------------------------

  dispose(): void {
    if (this.disposed) return;
    for (const child of [...this.childScopes]) child.dispose();
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
