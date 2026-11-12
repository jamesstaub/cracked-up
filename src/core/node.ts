import type {
  At,
  Bus,
  BuiltNode,
  MacroContext,
  MacroDefinition,
  Edge,
  Json,
  Node,
  NodeDefinition,
  Param,
  ParamValue,
  ReleaseOptions,
  Tags,
} from '../api';
import { CrackedUpError, toGraphError } from './errors';
import { ParamImpl } from './param';
import type { RegistryEntry } from './registry';
import type { BusImpl } from './bus';
import type { EngineImpl } from './engine';
import type { ScopeImpl } from './scope';

export type EdgeEnd = NodeImpl | BusImpl | ParamImpl;

export interface EdgeImpl {
  readonly from: NodeImpl;
  readonly to: EdgeEnd;
}

export interface NodeOptions {
  id: string;
  /** True when the id was generated because the caller gave none. */
  autoId: boolean;
  classes: readonly string[];
  tags: Tags;
  /** Starting values for parameters. */
  values: Readonly<Record<string, ParamValue>>;
  /** Creation-only options, passed to the definition's build. */
  init: Readonly<Record<string, unknown>>;
  /** When set, chaining this node into another connects to that parameter of it. */
  modulates: string | null;
}

export class NodeImpl {
  readonly id: string;
  readonly autoId: boolean;
  readonly type: string;
  readonly classes: ReadonlySet<string>;
  readonly tags: Tags;
  readonly scope: ScopeImpl;
  readonly engine: EngineImpl;
  readonly entry: RegistryEntry;
  readonly init: Readonly<Record<string, unknown>>;
  readonly modulates: string | null;
  /** The macro instance this node is inside, or null. */
  readonly parent: NodeImpl | null;
  /** For a macro instance: the private scope holding its inner nodes. */
  private innerScope: ScopeImpl | null = null;
  readonly params: Readonly<Record<string, ParamImpl>>;

  disposed = false;
  inputs: EdgeImpl[] = [];
  outputs: EdgeImpl[] = [];

  private built: BuiltNode;

  constructor(scope: ScopeImpl, entry: RegistryEntry, options: NodeOptions) {
    this.scope = scope;
    this.parent = scope.owner;
    this.engine = scope.engine;
    this.entry = entry;
    this.id = options.id;
    this.autoId = options.autoId;
    this.type = entry.type;
    this.classes = new Set(options.classes);
    this.tags = Object.freeze({ ...options.tags });
    this.init = options.init;
    this.modulates = options.modulates;

    const params: Record<string, ParamImpl> = {};
    for (const meta of entry.params.values()) {
      params[meta.name] = new ParamImpl(this, meta, options.values[meta.name]);
    }
    this.params = params;

    try {
      this.built = entry.isMacro
        ? this.buildMacro(entry.definition as MacroDefinition, options.init)
        : (entry.definition as NodeDefinition).build(this.engine.buildContext(this), options.init);
    } catch (thrown) {
      this.innerScope?.dispose();
      const error = toGraphError(thrown, 'build-failed');
      throw new CrackedUpError(
        error.code,
        `Could not build ${this.type} "${this.id}": ${error.message}`,
        { nodeId: this.id, cause: thrown },
      );
    }
    for (const param of Object.values(params)) {
      if (!entry.isMacro) param.bind(this.built.params[param.name]);
    }
  }

  /** A macro's inner nodes, in creation order. Empty for ordinary nodes. */
  get inner(): readonly NodeImpl[] {
    return this.innerScope?.nodes ?? [];
  }

  /**
   * Builds a macro instance: a private scope with `in` and `out` buses, filled by the definition. The
   * result has the same shape as an ordinary node's, so everything else treats the two alike.
   */
  private buildMacro(
    definition: MacroDefinition,
    init: Readonly<Record<string, unknown>>,
  ): BuiltNode {
    const inner = this.scope.createInnerScope(this);
    this.innerScope = inner;
    const input = inner.bus('in');
    const output = inner.bus('out');

    const context = (time: number): MacroContext => ({
      id: this.id,
      time,
      value: (name, at = time) => {
        const param = this.findParam(name);
        if (!param)
          throw new CrackedUpError('invalid-param', `${this.type} has no parameter "${name}".`);
        return param.effectiveAt(at);
      },
      random: () => this.engine.random.float(),
    });
    /** Runs one of the definition's functions with `time` as the default time for what it does. */
    const at = <T>(time: number, fn: () => T): T => {
      const previous = this.engine.eventTime;
      this.engine.eventTime = time;
      try {
        return fn();
      } finally {
        this.engine.eventTime = previous;
      }
    };

    const now = this.engine.resolveAt(undefined);
    at(now, () => definition.build(inner.$, init, context(now)));

    // Exposed parameters drive inner ones. Bound after the build so starting values reach the nodes it made.
    for (const [name, spec] of Object.entries(definition.params)) {
      this.params[name]?.bindLinks(() =>
        spec.drives.flatMap((drive) =>
          inner.select(drive.select).nodes.flatMap((node) => {
            const param = node.findParam(drive.param);
            if (!param) return [];
            return [drive.scale ? { param, scale: drive.scale } : { param }];
          }),
        ),
      );
    }

    const methods: NonNullable<BuiltNode['methods']> = {};
    for (const [name, method] of Object.entries(definition.methods ?? {})) {
      methods[name] = (args, time) => at(time, () => method(inner.$, args, time, context(time)));
    }
    const { trigger, release } = definition;
    return {
      // A port exists only if the definition used it.
      ...(input.hasListeners ? { input: input.input } : {}),
      ...(output.sources.size > 0 ? { output: output.output } : {}),
      params: {},
      methods,
      ...(trigger
        ? {
            trigger: (options: Readonly<Record<string, unknown>>, time: number) =>
              at(time, () => trigger(inner.$, { ...options, at: time }, context(time))),
          }
        : {}),
      ...(release
        ? {
            release: (options: ReleaseOptions, time: number) =>
              at(time, () => release(inner.$, { ...options, at: time }, context(time))),
          }
        : {}),
      dispose: () => inner.dispose(),
    };
  }

  // --- Parameters ---------------------------------------------------------------------------------

  /** The parameter, or undefined if this node type has none by that name. */
  findParam(name: string): ParamImpl | undefined {
    return Object.hasOwn(this.params, name) ? this.params[name] : undefined;
  }

  param(name: string): Param {
    const param = this.findParam(name);
    if (!param) {
      const known = Object.keys(this.params).join(', ') || 'none';
      throw new CrackedUpError(
        'invalid-param',
        `${this.type} "${this.id}" has no parameter called "${name}". Its parameters: ${known}.`,
        { nodeId: this.id },
      );
    }
    return param as unknown as Param;
  }

  get bypass(): boolean {
    return false;
  }

  set bypass(_value: boolean) {
    throw new CrackedUpError('unsupported', 'Bypass is not implemented yet.', { nodeId: this.id });
  }

  // --- Connections --------------------------------------------------------------------------------

  /** The native node incoming connections attach to, if this node takes input. */
  get inputNode(): AudioNode | null {
    return this.built.input ?? null;
  }

  get output(): AudioNode | null {
    return this.built.output ?? null;
  }

  connect(target: Node | Bus | Param<number>): this {
    connect(this, target as unknown as EdgeEnd);
    return this;
  }

  disconnect(target?: Node | Bus | Param<number>): this {
    for (const edge of [...this.outputs]) {
      if (target === undefined || edge.to === (target as unknown as EdgeEnd)) disconnectEdge(edge);
    }
    return this;
  }

  // --- Triggering ---------------------------------------------------------------------------------

  trigger(options?: At & Record<string, unknown>): this {
    const { at, ...rest } = options ?? {};
    this.applyTrigger(rest, this.engine.resolveAt(at));
    return this;
  }

  applyTrigger(options: Readonly<Record<string, unknown>>, at: number): void {
    this.built.trigger?.(options, at);
  }

  release(options?: ReleaseOptions): this {
    const { at, ...rest } = options ?? {};
    this.applyRelease(rest, this.engine.resolveAt(at));
    return this;
  }

  applyRelease(options: ReleaseOptions, at: number): void {
    this.built.release?.(options, at);
  }

  call(method: string, args?: Readonly<Record<string, Json>>, options?: At): this {
    this.applyCall(method, args ?? {}, this.engine.resolveAt(options?.at));
    return this;
  }

  applyCall(method: string, args: Readonly<Record<string, unknown>>, at: number): void {
    const fn = this.built.methods?.[method];
    if (!fn) {
      throw new CrackedUpError(
        'invalid-command',
        `${this.type} "${this.id}" has no method called "${method}".`,
        { nodeId: this.id },
      );
    }
    fn(args, at);
  }

  // --- Lifetime -----------------------------------------------------------------------------------

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const edge of [...this.outputs, ...this.inputs]) disconnectEdge(edge);
    try {
      this.built.dispose?.();
    } catch (error) {
      console.error(`cracked-up: dispose failed for ${this.type} "${this.id}"`, error);
    }
    this.built.output?.disconnect();
    for (const param of Object.values(this.params)) param.dispose();
    this.scope.forget(this);
  }
}

function describeEnd(end: EdgeEnd): string {
  if (end instanceof NodeImpl) return `${end.type} "${end.id}"`;
  if (end instanceof ParamImpl) return `"${end.name}" of ${end.node.type} "${end.node.id}"`;
  return `bus "${end.name}"`;
}

/** Connects a node's output to another node's input, a bus, or a parameter, and records the edge. */
export function connect(from: NodeImpl, to: EdgeEnd): void {
  if (from.disposed) return;
  if (from.outputs.some((edge) => edge.to === to)) return;
  const output = from.output;
  if (!output) {
    throw new CrackedUpError(
      'missing-target',
      `${from.type} "${from.id}" has no output to connect from.`,
      { nodeId: from.id },
    );
  }
  const edge: EdgeImpl = { from, to };
  if (to instanceof NodeImpl) {
    const input = to.inputNode;
    if (!input) {
      throw new CrackedUpError(
        'missing-target',
        `${to.type} "${to.id}" has no input, so ${from.type} "${from.id}" cannot connect to it. ` +
          `To drive one of its parameters, use modulate().`,
        { nodeId: to.id },
      );
    }
    output.connect(input);
    to.inputs.push(edge);
  } else if (to instanceof ParamImpl) {
    const targets = to.audioParams();
    if (targets.length === 0) {
      throw new CrackedUpError(
        'invalid-param',
        `${describeEnd(to)} cannot be modulated: it is not an audio-rate parameter.`,
        { nodeId: to.node.id },
      );
    }
    for (const audio of targets) output.connect(audio);
    to.addModulation(from, () => disconnectEdge(edge));
  } else {
    output.connect(to.input);
    to.sources.add(edge);
  }
  from.outputs.push(edge);
}

export function disconnectEdge(edge: EdgeImpl): void {
  const { from, to } = edge;
  const index = from.outputs.indexOf(edge);
  if (index === -1) return;
  from.outputs.splice(index, 1);
  const output = from.output;
  try {
    if (to instanceof NodeImpl) {
      to.inputs = to.inputs.filter((other) => other !== edge);
      if (output && to.inputNode) output.disconnect(to.inputNode);
    } else if (to instanceof ParamImpl) {
      to.removeModulation(from);
      if (output) for (const audio of to.audioParams()) output.disconnect(audio);
    } else {
      to.sources.delete(edge);
      if (output) output.disconnect(to.input);
    }
  } catch {
    // The native connection was already gone (for example the node was rebuilt). The record is what matters.
  }
}

/** The public Edge view of an internal edge. */
export function toPublicEdge(edge: EdgeImpl): Edge {
  return edge as unknown as Edge;
}
