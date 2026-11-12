import type {
  At,
  Bus,
  Json,
  Node,
  OffsetOptions,
  Param,
  ParamValue,
  RampOptions,
  ReleaseOptions,
  Selection,
} from '../api';
import { matchesCompound, select } from '../selector';
import type { SelectableTree } from '../selector';
import { busOf } from './bus';
import type { ChainImpl } from './chain';
import type { EngineImpl } from './engine';
import { CrackedUpError } from './errors';
import { NodeImpl, connect } from './node';
import type { EdgeEnd } from './node';
import { ParamImpl } from './param';
import type { ScopeImpl } from './scope';
import { wrapSelectorErrors } from './scope';

/** Walks into the nodes inside a macro. */
const innerTree: SelectableTree<NodeImpl> = {
  children: (parent) => (parent === null ? [] : parent.inner),
};

export type ConnectTarget = string | Selection | Node | Bus | Param<number>;

/**
 * An immutable list of nodes. The engine makes a subclass of this with one shortcut setter per
 * registered parameter name; see `EngineImpl`.
 */
export class SelectionImpl implements Iterable<NodeImpl> {
  readonly nodes: readonly NodeImpl[];

  constructor(
    readonly engine: EngineImpl,
    /** The scope the selection was made from. Selector strings passed to its methods resolve here. */
    readonly origin: ScopeImpl,
    nodes: readonly NodeImpl[],
  ) {
    this.nodes = Object.freeze([...nodes]);
  }

  get length(): number {
    return this.nodes.length;
  }

  first(): NodeImpl | undefined {
    return this.nodes[0];
  }

  at(index: number): NodeImpl | undefined {
    return this.nodes.at(index);
  }

  [Symbol.iterator](): Iterator<NodeImpl> {
    return this.nodes[Symbol.iterator]();
  }

  select(selector: string): SelectionImpl {
    const found = new Set<NodeImpl>();
    wrapSelectorErrors(() => {
      for (const node of this.nodes) {
        for (const match of select(selector, innerTree, node)) found.add(match);
      }
    });
    return this.engine.createSelection(this.origin, [...found]);
  }

  filter(test: string | ((node: NodeImpl, index: number) => boolean)): SelectionImpl {
    const nodes =
      typeof test === 'string'
        ? wrapSelectorErrors(() => this.nodes.filter((node) => matchesCompound(node, test)))
        : this.nodes.filter(test);
    return this.engine.createSelection(this.origin, nodes);
  }

  each(fn: (node: NodeImpl, index: number) => void): this {
    this.nodes.forEach(fn);
    return this;
  }

  // --- Parameters ---------------------------------------------------------------------------------

  set(values: Readonly<Record<string, ParamValue | undefined>>, options?: At): this {
    const at = this.engine.resolveAt(options?.at);
    for (const node of this.nodes) {
      for (const [name, value] of Object.entries(values)) {
        if (value !== undefined) node.findParam(name)?.applySet(value, at);
      }
    }
    return this;
  }

  ramp(param: string, target: number, options: RampOptions): this {
    const at = this.engine.resolveAt(options.at);
    for (const node of this.nodes) node.findParam(param)?.applyRamp(target, at, options);
    return this;
  }

  offset(param: string, amount: number, options?: OffsetOptions): this {
    const at = this.engine.resolveAt(options?.at);
    for (const node of this.nodes)
      node.findParam(param)?.applyOffset(amount, at, options?.duration);
    return this;
  }

  params(name: string): readonly ParamImpl[] {
    return this.nodes.flatMap((node) => node.findParam(name) ?? []);
  }

  param(name: string): Param {
    const first = this.nodes[0];
    if (!first) {
      throw new CrackedUpError('missing-target', `Cannot read "${name}": the selection is empty.`);
    }
    return first.param(name);
  }

  // --- Triggering ---------------------------------------------------------------------------------

  trigger(options?: At & Record<string, unknown>): this {
    const { at, ...rest } = options ?? {};
    const time = this.engine.resolveAt(at);
    for (const node of this.nodes) node.applyTrigger(rest, time);
    return this;
  }

  release(options?: ReleaseOptions): this {
    const { at, ...rest } = options ?? {};
    const time = this.engine.resolveAt(at);
    for (const node of this.nodes) node.applyRelease(rest, time);
    return this;
  }

  call(method: string, args?: Readonly<Record<string, Json>>, options?: At): this {
    const time = this.engine.resolveAt(options?.at);
    for (const node of this.nodes) node.applyCall(method, args ?? {}, time);
    return this;
  }

  /** Bypasses every selected node, or with `false` brings them back. */
  bypass(on = true, options?: At): this {
    const time = this.engine.resolveAt(options?.at);
    for (const node of this.nodes) node.applyBypass(on, time);
    return this;
  }

  // --- Connections --------------------------------------------------------------------------------

  connect(target: ConnectTarget): this {
    const ends = resolveEnds(this.origin, target);
    for (const node of this.nodes) for (const end of ends) connect(node, end);
    return this;
  }

  to(bus: string | Bus): this {
    for (const node of this.nodes) {
      const target = typeof bus === 'string' ? node.scope.resolveBus(bus) : busOf(bus);
      if (!target) {
        throw new CrackedUpError('missing-target', 'to() needs a bus or the name of one.');
      }
      connect(node, target);
    }
    return this;
  }

  disconnect(): this {
    for (const node of this.nodes) node.disconnect();
    return this;
  }

  chain(): ChainImpl {
    return this.engine.createChain(this.origin, this.nodes, this.nodes);
  }

  dispose(): void {
    for (const node of this.nodes) node.dispose();
  }
}

/** Turns any accepted connection target into the internal things a node can connect to. */
export function resolveEnds(scope: ScopeImpl, target: ConnectTarget): readonly EdgeEnd[] {
  if (typeof target === 'string') {
    const nodes = scope.select(target).nodes;
    if (nodes.length === 0) {
      throw new CrackedUpError(
        'missing-target',
        `Nothing in scope "${scope.name}" matches "${target}", so there is nothing to connect to.`,
      );
    }
    return nodes;
  }
  if (target instanceof SelectionImpl) return target.nodes;
  if (target instanceof NodeImpl || target instanceof ParamImpl) return [target];
  const bus = busOf(target);
  if (bus) return [bus];
  throw new CrackedUpError(
    'missing-target',
    'connect() needs a selector, selection, node, bus or parameter.',
  );
}
