import type { BusImpl } from './bus';
import type { EdgeImpl, NodeImpl } from './node';

/**
 * One change to the engine that either happens whole or not at all: a `build()`, or a batch of
 * commands a remote sends as one. While it is open,
 *
 * - what is made (nodes, buses, connections) is made at once and noted, so it can be removed again;
 * - what is asked of things that were already there (a value set, a ramp, a trigger, a bypass, a
 *   bus's route, a connection removed, a node disposed) is checked at once and done later, in the
 *   order asked, when the change is known to succeed.
 *
 * So nothing a listener can hear or observe changes until every request has been accepted. The scope
 * that opened it closes it: see `ScopeImpl.atomically`.
 */
export class Transaction {
  /** Nodes made since it opened. Requests to these take effect at once: they go if it fails. */
  readonly created = new Set<NodeImpl>();
  readonly buses = new Set<BusImpl>();
  readonly edges = new Set<EdgeImpl>();
  /** Connections that were there before and are to be removed. Asking for one again takes it out. */
  readonly cut = new Set<EdgeImpl>();

  private deferred: (() => void)[] = [];
  private undos: (() => void)[] = [];
  private events: { node: NodeImpl; emit: () => void }[] = [];

  /** Where the next deferred request will go, for `insert` and `forget`. */
  get mark(): number {
    return this.deferred.length;
  }

  defer(run: () => void): void {
    this.deferred.push(run);
  }

  /** Defers something to before everything deferred since `mark`. */
  insert(mark: number, run: () => void): void {
    this.deferred.splice(mark, 0, run);
  }

  /** Drops everything deferred since `mark`: the part of the change that asked for it failed. */
  forget(mark: number): void {
    this.deferred.length = Math.min(this.deferred.length, mark);
  }

  /** Something to put back if the change fails, beyond removing what it made. */
  undo(run: () => void): void {
    this.undos.push(run);
  }

  /** An event about a node made in this change, held until the node has been announced. */
  announce(node: NodeImpl, emit: () => void): void {
    this.events.push({ node, emit });
  }

  /**
   * Does everything that was deferred. Each request was checked when it was made, so the only thing
   * that can still throw is a node's own code (a trigger, a method, a parameter handler); those
   * failures are returned and the rest still runs.
   */
  commit(): unknown[] {
    const thrown: unknown[] = [];
    for (const run of this.deferred) {
      try {
        run();
      } catch (error) {
        thrown.push(error);
      }
    }
    for (const { node, emit } of this.events) if (!node.disposed) emit();
    return thrown;
  }

  /** Runs the undos, newest first. The caller removes what was made. */
  rollback(): void {
    for (const run of this.undos.reverse()) run();
  }
}
