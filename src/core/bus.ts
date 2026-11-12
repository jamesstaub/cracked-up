import type { Bus, Param } from '../api';
import type { ChainImpl } from './chain';
import { CrackedUpError } from './errors';
import type { EdgeImpl, NodeImpl } from './node';
import { disconnectEdge } from './node';
import type { ScopeImpl } from './scope';

/** A named mix point. Internally a gain node that is not listed among its scope's nodes. */
export class BusImpl {
  readonly name: string;
  readonly scope: ScopeImpl;
  /** Edges from nodes feeding this bus. */
  readonly sources = new Set<EdgeImpl>();

  /** The gain node that does the mixing. It is not listed among the scope's nodes. */
  readonly node: NodeImpl;
  /** Where the bus's mix goes: another bus, or null for the context's output. */
  private destination: BusImpl | null = null;
  private connected = false;

  constructor(scope: ScopeImpl, name: string) {
    this.scope = scope;
    this.name = name;
    this.node = scope.createHiddenNode('gain', `bus:${name}`);
  }

  get gain(): Param<number> {
    return this.node.param('gain') as unknown as Param<number>;
  }

  get input(): AudioNode {
    return this.node.inputNode!;
  }

  get output(): AudioNode {
    return this.node.output!;
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
    this.scope.noteRoute(this);
    if (target === null) {
      // Nowhere: the mix is heard only through chains that continue from this bus.
      this.unroute();
      return this;
    }
    const bus = typeof target === 'string' ? this.scope.resolveBus(target) : busOf(target);
    if (!bus) throw new CrackedUpError('missing-target', 'A bus can only be sent to a bus.');
    if (bus === this) {
      throw new CrackedUpError('missing-target', `Bus "${this.name}" cannot be routed to itself.`);
    }
    this.route(bus);
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
}

/** The bus behind anything a caller may pass as a bus, or null if it is not one. */
export function busOf(value: unknown): BusImpl | null {
  if (value instanceof BusImpl) return value;
  if (value instanceof BusView) return value.bus;
  return null;
}
