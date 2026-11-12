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

  private node: NodeImpl;
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

  to(target: string | Bus): this {
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
    if (this.connected) this.output.disconnect();
    this.destination = destination;
    this.output.connect(destination ? destination.input : this.scope.engine.context.destination);
    this.connected = true;
  }

  dispose(): void {
    for (const edge of [...this.sources]) disconnectEdge(edge);
    if (this.connected) this.output.disconnect();
    this.connected = false;
    this.node.dispose();
  }
}
