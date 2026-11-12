import type { Bus, Node, Selection } from '../api';
import type { BusImpl } from './bus';
import type { EngineImpl } from './engine';
import { CrackedUpError } from './errors';
import { NodeImpl, connect } from './node';
import type { ParamImpl } from './param';
import type { ScopeImpl } from './scope';
import { resolveEnds } from './selection';
import type { ConnectTarget, SelectionImpl } from './selection';

/**
 * A chain under construction. Immutable: every call returns a new chain, so keeping one and calling it
 * twice makes two branches from the same point.
 *
 * The engine makes a subclass of this with one method per registered node type; see `EngineImpl`.
 */
export class ChainImpl {
  constructor(
    readonly engine: EngineImpl,
    readonly scope: ScopeImpl,
    private readonly tailNodes: readonly NodeImpl[],
    private readonly allNodes: readonly NodeImpl[],
  ) {}

  get tail(): SelectionImpl {
    return this.engine.createSelection(this.scope, this.tailNodes);
  }

  get nodes(): SelectionImpl {
    return this.engine.createSelection(this.scope, this.allNodes);
  }

  /** Creates a node, connects the tail to it, and returns the chain that ends at it. */
  add(type: string, init: unknown): ChainImpl {
    const node = this.scope.createNode(type, init);
    try {
      for (const previous of this.tailNodes) {
        if (previous.modulates !== null) {
          connect(previous, node.param(previous.modulates) as unknown as ParamImpl);
        } else {
          connect(previous, node);
        }
      }
    } catch (error) {
      this.scope.discard(node);
      throw error;
    }
    return this.engine.createChain(this.scope, [node], [...this.allNodes, node]);
  }

  to(bus: string | Bus): ChainImpl {
    this.requireTail('to()');
    for (const node of this.tailNodes) {
      connect(
        node,
        typeof bus === 'string' ? node.scope.resolveBus(bus) : (bus as unknown as BusImpl),
      );
    }
    return this;
  }

  connect(target: ConnectTarget): ChainImpl {
    this.requireTail('connect()');
    const ends = resolveEnds(this.scope, target);
    for (const node of this.tailNodes) for (const end of ends) connect(node, end);
    return this;
  }

  modulate(target: string | Selection | Node, param: string): ChainImpl {
    this.requireTail('modulate()');
    for (const end of resolveEnds(this.scope, target)) {
      if (!(end instanceof NodeImpl)) continue;
      const targetParam = end.param(param) as unknown as ParamImpl;
      for (const node of this.tailNodes) connect(node, targetParam);
    }
    return this;
  }

  split(...branches: readonly ((branch: ChainImpl) => ChainImpl)[]): ChainImpl {
    const tails = new Set<NodeImpl>();
    const all = new Set<NodeImpl>(this.allNodes);
    for (const branch of branches) {
      const result = branch(this.engine.createChain(this.scope, this.tailNodes, []));
      for (const node of result.tailNodes) tails.add(node);
      for (const node of result.allNodes) all.add(node);
    }
    return this.engine.createChain(this.scope, [...tails], [...all]);
  }

  private requireTail(method: string): void {
    if (this.tailNodes.length === 0) {
      throw new CrackedUpError(
        'missing-target',
        `${method} was called on an empty chain: add a node first.`,
      );
    }
  }
}
