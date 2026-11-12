import type {
  BufferInfo,
  BufferRef,
  Command,
  GraphData,
  GraphError,
  Json,
  MacroDefinition,
  MacroParam,
  Node,
  RemoteMacroData,
  ScopeApi,
  HostMessage,
  Link,
  LinkOptions,
  ParamValue,
  RemoteMessage,
  RemoteState,
  Scope,
  SequenceOptions,
  TransportSnapshot,
} from '../api';
import { defineMacro } from '../define';

const bufferInfo = (ref: BufferRef): BufferInfo => ({
  key: ref.key,
  duration: ref.duration ?? 0,
  slices: [...ref.slices],
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The host's end of a remote: applies the commands a sandboxed script sends to one scope, and tells
 * the script what it needs to know (sequence events, values changed by someone else, errors).
 *
 * Everything arriving here is untrusted data. Commands go through `scope.dispatch`, which validates
 * them and can only reach the linked scope; `options.allow` can refuse any of them first.
 */
export function linkRemote(scope: Scope, options: LinkOptions): Link {
  const engine = scope.engine;
  const sequences = new Set<string>();
  /** One-shot callbacks (`transport.at`) still waiting, by name. */
  const onces = new Map<string, () => void>();
  /** Macro types this remote defined, which it may redefine and which go when the link does. */
  const defined = new Set<string>();
  let disposed = false;
  /** True while the remote's own commands are being applied, so their effects are not echoed back. */
  let applying = false;
  let pendingParams: { node: string; param: string; value: ParamValue }[] = [];
  let snapshotPending = false;
  let flushQueued = false;

  const send = (message: HostMessage): void => {
    if (!disposed) options.send(message);
  };

  const sendError = (error: Pick<GraphError, 'code' | 'message' | 'nodeId'>): void => {
    send({
      type: 'error',
      error: {
        code: error.code,
        message: error.message,
        ...(error.nodeId === undefined ? {} : { nodeId: error.nodeId }),
      },
    });
  };

  const transportSnapshot = (): TransportSnapshot => ({
    bpm: engine.transport.bpm,
    swing: engine.transport.swing,
    timeSignature: [...engine.transport.timeSignature] as [number, number],
    stepLength: engine.transport.stepLength,
    state: engine.transport.state,
  });

  /** Changes made on the host are gathered and sent once per turn of the event loop. */
  const queueFlush = (): void => {
    if (flushQueued) return;
    flushQueued = true;
    queueMicrotask(() => {
      flushQueued = false;
      if (snapshotPending) send({ type: 'snapshot', snapshot: scope.snapshot() });
      else if (pendingParams.length > 0) send({ type: 'params', changes: pendingParams });
      snapshotPending = false;
      pendingParams = [];
    });
  };

  const sendTransport = (): void => send({ type: 'transport', transport: transportSnapshot() });

  const unsubscribe = [
    scope.on('error', (error) => {
      if (applying) sendError(error);
    }),
    scope.on('param:changed', (change) => {
      if (applying) return;
      pendingParams.push({
        node: change.param.node.id,
        param: change.param.name,
        value: change.value,
      });
      queueFlush();
    }),
    scope.on('node:added', () => {
      if (applying) return;
      snapshotPending = true;
      queueFlush();
    }),
    scope.on('node:removed', () => {
      if (applying) return;
      snapshotPending = true;
      queueFlush();
    }),
    engine.transport.on('tempo', sendTransport),
    engine.transport.on('start', sendTransport),
    engine.transport.on('stop', sendTransport),
    engine.buffers.on('ready', (ref) => send({ type: 'buffer', ...bufferInfo(ref) })),
  ];

  /** The ids leading to a macro instance from the linked scope, or null if it is not inside it. */
  const pathOf = (api: ScopeApi): string[] | null => {
    const path: string[] = [];
    let node: Node | null = api.scope.owner;
    let top: Node | null = null;
    while (node) {
      path.unshift(node.id);
      top = node;
      node = node.parent;
    }
    return top !== null && top.scope === scope ? path : null;
  };

  /**
   * Registers a macro whose code lives in the sandbox. Here it is only data: the inner graph is
   * applied as a description, and calls to its methods are sent to the sandbox to run.
   */
  const define = (data: RemoteMacroData): void => {
    if (!isRecord(data) || typeof data.type !== 'string' || !isRecord(data.params)) {
      throw new TypeError('A macro definition needs a type and params.');
    }
    const type = data.type;
    if (engine.registry.has(type) && !defined.has(type)) {
      throw new TypeError(`"${type}" is already a node type and cannot be redefined by a script.`);
    }
    const params: Record<string, MacroParam> = {};
    for (const [name, spec] of Object.entries(data.params)) {
      if (!isRecord(spec)) throw new TypeError(`Parameter "${name}" is not an object.`);
      const drives = Array.isArray(spec['drives']) ? (spec['drives'] as unknown[]) : [];
      params[name] = {
        ...(spec as unknown as MacroParam),
        drives: drives.filter(isRecord).map((drive) => {
          const scale = isRecord(drive['scale']) ? drive['scale'] : null;
          return {
            select: String(drive['select']),
            param: String(drive['param']),
            ...(scale
              ? {
                  scale: {
                    multiply: Number(scale['multiply'] ?? 1),
                    add: Number(scale['add'] ?? 0),
                  },
                }
              : {}),
          };
        }),
      };
    }
    const names = Array.isArray(data.methods)
      ? data.methods.filter((name) => typeof name === 'string')
      : [];
    const forward = (api: ScopeApi, method: string, args: unknown, at: number): void => {
      const path = pathOf(api);
      if (!path) return;
      send({
        type: 'call',
        path,
        method,
        args: (isRecord(args) ? args : {}) as Record<string, Json>,
        at,
      });
    };
    const methods: NonNullable<MacroDefinition['methods']> = {};
    for (const name of names) {
      if (name === 'trigger' || name === 'release') continue;
      methods[name] = (api, args, at) => forward(api, name, args, at);
    }
    const definition = defineMacro({
      type,
      ...(typeof data.category === 'string' ? { category: data.category } : {}),
      ...(typeof data.description === 'string' ? { description: data.description } : {}),
      ...(typeof data.shorthand === 'string' ? { shorthand: data.shorthand } : {}),
      ...(isRecord(data.options) ? { options: data.options } : {}),
      ...(isRecord(data.triggerOptions) ? { triggerOptions: data.triggerOptions } : {}),
      params,
      build(api, init) {
        const own = isRecord(init['remote']) ? init['remote']['graph'] : undefined;
        const graph = (isRecord(own) ? own : data.graph) as GraphData;
        api.scope.dispatch([{ op: 'apply', graph }]);
      },
      ...(names.includes('trigger')
        ? {
            trigger(api: ScopeApi, { at, ...rest }: { at?: number }, macro: { time: number }) {
              forward(api, 'trigger', rest, at ?? macro.time);
            },
          }
        : {}),
      ...(names.includes('release')
        ? {
            release(api: ScopeApi, { at, ...rest }: { at?: number }, macro: { time: number }) {
              forward(api, 'release', rest, at ?? macro.time);
            },
          }
        : {}),
      methods,
    });
    engine.registry.register(definition);
    defined.add(type);
  };

  const describeThrown = (thrown: unknown): string =>
    thrown instanceof Error ? thrown.message : String(thrown);

  /** A remote has no audio clock: it sends 0 for "now". */
  const withTimes = (command: Command): Command => {
    if (command.op === 'inside' && Array.isArray(command.commands)) {
      return {
        ...command,
        commands: command.commands.filter(isRecord).map((c) => withTimes(c as Command)),
      };
    }
    if ('at' in command && typeof command.at === 'number' && command.at <= 0) {
      return { ...command, at: engine.context.currentTime };
    }
    return command;
  };

  const eventData = (name: string, event: { time: number; beat: number; bar: number }) => ({
    name,
    time: event.time,
    duration: 0,
    beat: event.beat,
    bar: event.bar,
    index: 0,
    value: 1,
    cycle: 0,
  });

  /** The callback of a remote sequence lives in the sandbox: each event is sent there ahead of time. */
  const addSequence = (name: unknown, sequenceOptions: SequenceOptions): void => {
    if (typeof name !== 'string' || name === '') {
      throw new TypeError('A remote sequence needs a name.');
    }
    scope.transport.sequence(name, sequenceOptions, (event) => {
      send({
        type: 'event',
        event: {
          name,
          time: event.time,
          duration: event.duration,
          beat: event.beat,
          bar: event.bar,
          index: event.index,
          value: event.value,
          cycle: event.cycle,
        },
        steps: [...event.steps],
      });
    });
    sequences.add(name);
  };

  const run = (raw: Command): void => {
    if (raw === null || typeof raw !== 'object') {
      sendError({ code: 'invalid-command', message: 'A command must be an object.' });
      return;
    }
    if (options.allow && !options.allow(raw)) return;
    const command = withTimes(raw);
    if (command.op === 'sequence' || command.op === 'once') {
      try {
        if (command.op === 'sequence') addSequence(command.name, command.options);
        else {
          const name = command.name;
          if (typeof name !== 'string' || name === '')
            throw new TypeError('A callback needs a name.');
          onces.get(name)?.();
          onces.set(
            name,
            scope.transport.at(command.position, (event) => {
              onces.delete(name);
              send({ type: 'event', event: eventData(name, event), steps: [1] });
            }),
          );
        }
      } catch (thrown) {
        sendError({ code: 'invalid-command', message: describeThrown(thrown) });
      }
      return;
    }
    if (command.op === 'clearSequence') {
      sequences.delete(command.name);
      const once = onces.get(command.name);
      if (once) {
        once();
        onces.delete(command.name);
        return;
      }
    }
    scope.dispatch([command]);
  };

  return {
    receive(message: RemoteMessage): void {
      if (disposed) return;
      if (message === null || typeof message !== 'object') return;
      if (message.type === 'define') {
        try {
          define(message.macro);
        } catch (thrown) {
          sendError({ code: 'unknown-type', message: describeThrown(thrown) });
        }
        return;
      }
      if (message.type !== 'commands' || !Array.isArray(message.commands)) {
        sendError({ code: 'invalid-command', message: 'Unknown message from the remote.' });
        return;
      }
      applying = true;
      try {
        for (const command of message.commands) run(command);
      } finally {
        applying = false;
      }
    },

    state(): RemoteState {
      return {
        snapshot: scope.snapshot(),
        transport: transportSnapshot(),
        types: engine.registry.list(),
        buffers: engine.buffers
          .list()
          .filter((ref) => ref.state === 'ready')
          .map(bufferInfo),
      };
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const off of unsubscribe) off();
      for (const name of sequences) scope.transport.clear(name);
      sequences.clear();
      for (const off of onces.values()) off();
      onces.clear();
      const registry = engine.registry as unknown as { remove?(type: string): void };
      for (const type of defined) registry.remove?.(type);
      defined.clear();
    },
  };
}
