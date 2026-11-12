import type {
  Command,
  GraphError,
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
  ];

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
    let command = raw;
    // A remote has no audio clock: it sends 0 for "now".
    if ('at' in command && typeof command.at === 'number' && command.at <= 0) {
      command = { ...command, at: engine.context.currentTime };
    }
    if (command.op === 'sequence') {
      try {
        addSequence(command.name, command.options);
      } catch (thrown) {
        sendError({
          code: 'invalid-command',
          message: thrown instanceof Error ? thrown.message : String(thrown),
        });
      }
      return;
    }
    if (command.op === 'clearSequence') sequences.delete(command.name);
    scope.dispatch([command]);
  };

  return {
    receive(message: RemoteMessage): void {
      if (disposed) return;
      if (message === null || typeof message !== 'object') return;
      if (message.type === 'define') {
        sendError({
          code: 'unsupported',
          message:
            'Defining a macro from inside a sandbox is not implemented yet. Register it on the host.',
        });
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
      };
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const off of unsubscribe) off();
      for (const name of sequences) scope.transport.clear(name);
      sequences.clear();
    },
  };
}
