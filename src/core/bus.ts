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
    const bus =
      typeof target === 'string' ? this.scope.resolveBus(target) : (target as unknown as BusImpl);
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
