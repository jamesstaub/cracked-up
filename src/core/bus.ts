import type { Bus, Param } from '../api';
import type { ChainImpl } from './chain';
import type { EngineImpl } from './engine';
import { CrackedUpError } from './errors';
import type { EdgeImpl, NodeImpl } from './node';
import { disconnectEdge } from './node';
import type { ScopeImpl } from './scope';
import type { SelectionImpl } from './selection';
import type { Transaction } from './transaction';

/**
 * A named mix point. Inside it the signal runs
 *
 *   sources -> entry -> insert, insert, ... -> node -> the bus's target, and chains from `chain()`
 *
 * `entry` is where everything sent to the bus is summed. `node` is a gain node that is not listed
 * among its scope's nodes: its gain is the bus's level, and its output is the bus's output. The
 * inserts between them are ordinary nodes of the scope, connected natively and not through edges,
 * because the path through them belongs to the bus and not to the graph a script describes.
 *
 * The engine makes a subclass of this with one method per registered node type, which adds that
 * type as an insert; see `EngineImpl`.
 */
export class BusImpl {
  readonly name: string;
  readonly scope: ScopeImpl;
  /** Edges from nodes feeding this bus. */
  readonly sources = new Set<EdgeImpl>();

  /** The bus's level and output, after the inserts. It is not listed among the scope's nodes. */
  readonly node: NodeImpl;
  /** Where everything sent to the bus is summed, before the inserts. */
  private readonly entry: GainNode;
  private insertList: readonly NodeImpl[] = [];
  /** The native connections that make the path from `entry` through the inserts to `node`. */
  private patched: [AudioNode, AudioNode][] = [];
  /** Where the bus's mix goes: another bus, or null for the context's output. */
  private destination: BusImpl | null = null;
  private connected = false;

  constructor(scope: ScopeImpl, name: string) {
    this.scope = scope;
    this.name = name;
    this.node = scope.createHiddenNode('gain', `bus:${name}`);
    this.entry = new GainNode(scope.engine.context);
    this.patch();
  }

  get gain(): Param<number> {
    return this.node.param('gain') as unknown as Param<number>;
  }

  get input(): AudioNode {
    return this.entry;
  }

  get output(): AudioNode {
    return this.node.output!;
  }

  // --- Inserts ------------------------------------------------------------------------------------

  /** The inserts, in the order the signal passes through them. */
  get insertNodes(): readonly NodeImpl[] {
    return this.insertList;
  }

  get inserts(): SelectionImpl {
    return this.scope.engine.createSelection(this.scope, this.insertList);
  }

  insert(): InsertChainImpl {
    return this.scope.engine.createInserts(this, []);
  }

  /**
   * Creates a node and makes it the bus's last insert. During a rebuild the node is only noted: the
   * bus takes the inserts the rebuild asked for, in the order it asked, when the rebuild succeeds.
   */
  insertNode(type: string, init: unknown): NodeImpl {
    const node = this.scope.createNode(type, init);
    try {
      this.checkInsert(node);
    } catch (error) {
      this.scope.discard(node);
      throw error;
    }
    if (!this.scope.noteInsert(this, node)) {
      // The list is read when the insert is placed: during a build of another scope that is later.
      const place = (): void => {
        if (node.disposed || this.node.disposed) return;
        this.setInserts([...this.insertList.filter((other) => other !== node), node]);
      };
      const tx = this.held();
      if (tx) tx.defer(place);
      else place();
    }
    return node;
  }

  /** Throws unless the node can sit in this bus's signal path. */
  checkInsert(node: NodeImpl): void {
    if (node.scope !== this.scope) {
      throw new CrackedUpError(
        'missing-target',
        `${node.type} "${node.id}" belongs to another scope and cannot be an insert on bus "${this.name}".`,
        { nodeId: node.id },
      );
    }
    if (!node.inputNode || !node.output) {
      throw new CrackedUpError(
        'missing-target',
        `${node.type} "${node.id}" cannot be an insert on bus "${this.name}": an insert needs an ` +
          `input and an output, and it has no ${node.inputNode ? 'output' : 'input'}.`,
        { nodeId: node.id },
      );
    }
  }

  /**
   * Makes these nodes, in this order, the bus's inserts. Nothing is touched if they already are, so
   * a rebuild that asks for the same inserts leaves the signal alone. Returns whether anything changed.
   */
  setInserts(nodes: readonly NodeImpl[]): boolean {
    const tx = this.held();
    if (tx) {
      tx.defer(() => {
        if (!this.node.disposed) this.setInserts(nodes);
      });
      return false;
    }
    const next = [...new Set(nodes)].filter((node) => !node.disposed);
    const same =
      next.length === this.insertList.length &&
      next.every((node, index) => node === this.insertList[index]);
    if (same) return false;
    for (const node of this.insertList) if (!next.includes(node)) node.insertOf = null;
    for (const node of next) {
      if (node.insertOf && node.insertOf !== this) node.insertOf.removeInsert(node);
      node.insertOf = this;
    }
    this.insertList = next;
    this.patch();
    return true;
  }

  /** The build in progress, if this bus was there before it: what is asked of the bus then waits. */
  private held(): Transaction | null {
    const tx = this.scope.engine.tx;
    return tx && !tx.buses.has(this) ? tx : null;
  }

  /** Takes a node out of the path and joins its neighbours. Called when an insert is disposed. */
  removeInsert(node: NodeImpl): void {
    if (!this.insertList.includes(node)) return;
    node.insertOf = null;
    this.insertList = this.insertList.filter((other) => other !== node);
    this.patch();
  }

  /**
   * Connects `entry` through the inserts to `node`, replacing the connections made last time. Also
   * called by an insert whose native input and output change (the first time it is bypassed).
   */
  patch(): void {
    for (const [from, to] of this.patched) {
      try {
        from.disconnect(to);
      } catch {
        // Already gone.
      }
    }
    this.patched = [];
    let previous: AudioNode = this.entry;
    for (const node of [...this.insertList, this.node]) {
      previous.connect(node.inputNode!);
      this.patched.push([previous, node.inputNode!]);
      previous = node.output!;
    }
  }

  /** Whether anything continues from this bus (a chain started with `chain()`). */
  get hasListeners(): boolean {
    return this.node.outputs.length > 0;
  }

  chain(): ChainImpl {
    return this.scope.engine.createChain(this.scope, [this.node], []);
  }

  /** The name of the bus this one feeds, or null when it feeds the context's output. */
  get destinationName(): string | null {
    return this.destination?.name ?? null;
  }

  /** True when the bus has been told to go nowhere (`to(null)`). */
  get detached(): boolean {
    return !this.connected;
  }

  to(target: string | Bus | null): this {
    let bus: BusImpl | null = null;
    if (target !== null) {
      bus = typeof target === 'string' ? this.scope.resolveBus(target) : busOf(target);
      if (!bus) throw new CrackedUpError('missing-target', 'A bus can only be sent to a bus.');
      if (bus === this) {
        throw new CrackedUpError(
          'missing-target',
          `Bus "${this.name}" cannot be routed to itself.`,
        );
      }
    }
    this.scope.noteRoute(this);
    const apply = (): void => {
      if (this.node.disposed) return;
      // To nowhere: the mix is heard only through chains that continue from this bus.
      if (bus) this.route(bus);
      else this.unroute();
    };
    const tx = this.held();
    if (tx) tx.defer(apply);
    else apply();
    return this;
  }

  /** Sends the bus's mix to another bus, or to the context's output when given null. */
  route(destination: BusImpl | null): void {
    if (this.connected && destination === this.destination) return;
    this.unroute();
    this.destination = destination;
    this.output.connect(this.target());
    this.connected = true;
  }

  private target(): AudioNode {
    return this.destination ? this.destination.input : this.scope.engine.context.destination;
  }

  /** Removes only the bus's own route, leaving chains that continue from it connected. */
  private unroute(): void {
    if (!this.connected) return;
    try {
      this.output.disconnect(this.target());
    } catch {
      // Already gone.
    }
    this.connected = false;
    this.destination = null;
  }

  dispose(): void {
    for (const edge of [...this.sources]) disconnectEdge(edge);
    this.unroute();
    for (const node of this.insertList) node.insertOf = null;
    this.insertList = [];
    this.entry.disconnect();
    this.patched = [];
    this.node.dispose();
  }
}

/**
 * A bus as seen from a scope other than its own, which is what `scope.bus('main')` gives a child
 * scope. It is the same bus; the difference is that a chain continued from it is built in the scope
 * that asked, so those nodes belong to, and are found and rebuilt with, that scope.
 */
export class BusView {
  constructor(
    readonly bus: BusImpl,
    private from: ScopeImpl,
  ) {}

  get name(): string {
    return this.bus.name;
  }

  get scope(): ScopeImpl {
    return this.bus.scope;
  }

  get gain(): Param<number> {
    return this.bus.gain;
  }

  get input(): AudioNode {
    return this.bus.input;
  }

  get output(): AudioNode {
    return this.bus.output;
  }

  to(target: string | Bus | null): this {
    this.bus.to(target);
    return this;
  }

  chain(): ChainImpl {
    return this.from.engine.createChain(this.from, [this.bus.node], []);
  }

  get inserts(): SelectionImpl {
    return this.bus.inserts;
  }

  insert(): InsertChainImpl {
    return this.from.engine.createInserts(this, []);
  }

  /** A scope can send to an outer scope's bus and continue from it, but not change what is in it. */
  insertNode(type: string): never {
    throw new CrackedUpError(
      'missing-target',
      `Bus "${this.bus.name}" belongs to scope "${this.bus.scope.name}", so "${this.from.name}" ` +
        `cannot put a ${type} on it as an insert. Inserts are added from the scope that owns the bus.`,
    );
  }
}

/**
 * What adding an insert returns: the bus again, seen as a place to add the next insert. Immutable,
 * like a chain.
 *
 * The engine makes a subclass of this with one method per registered node type; see `EngineImpl`.
 */
export class InsertChainImpl {
  constructor(
    readonly engine: EngineImpl,
    private readonly handle: BusImpl | BusView,
    private readonly added: readonly NodeImpl[],
  ) {}

  get bus(): BusImpl | BusView {
    return this.handle;
  }

  /** The inserts this run of calls added, in order. */
  get nodes(): SelectionImpl {
    return this.engine.createSelection(busOf(this.handle)!.scope, this.added);
  }

  add(type: string, init: unknown): InsertChainImpl {
    const node = this.handle.insertNode(type, init);
    return this.engine.createInserts(this.handle, [...this.added, node]);
  }

  /** Routes the bus. */
  to(target: string | Bus | null): this {
    this.handle.to(target);
    return this;
  }

  /** A chain fed by the bus's output, after its inserts. */
  chain(): ChainImpl {
    return this.handle.chain();
  }
}

/** The bus behind anything a caller may pass as a bus, or null if it is not one. */
export function busOf(value: unknown): BusImpl | null {
  if (value instanceof BusImpl) return value;
  if (value instanceof BusView) return value.bus;
  return null;
}
