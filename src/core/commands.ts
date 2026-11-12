import type { Command, CommandTarget, EdgeTarget } from '../api';
import { CrackedUpError } from './errors';
import { connect, disconnectEdge } from './node';
import type { EdgeEnd, NodeImpl } from './node';
import type { ScopeImpl } from './scope';

function resolve(scope: ScopeImpl, target: CommandTarget): readonly NodeImpl[] {
  if (typeof target === 'string') return scope.select(target).nodes;
  if (target && Array.isArray(target.ids)) {
    return target.ids.flatMap((id) => scope.node(id) ?? []);
  }
  throw new CrackedUpError('invalid-command', 'A command target must be a selector or { ids }.');
}

function resolveEdgeTarget(scope: ScopeImpl, target: EdgeTarget): EdgeEnd {
  if ('bus' in target) return scope.resolveBus(target.bus);
  const node = scope.node(target.node);
  if (!node) {
    throw new CrackedUpError(
      'missing-target',
      `Scope "${scope.name}" has no node with the id "${target.node}".`,
    );
  }
  if ('param' in target) {
    const param = node.findParam(target.param);
    if (!param) node.param(target.param); // throws with the helpful message
    return param!;
  }
  return node;
}

function requireTime(command: { at: number }): number {
  if (typeof command.at !== 'number' || !Number.isFinite(command.at)) {
    throw new CrackedUpError('invalid-command', 'A command needs a finite "at" time.');
  }
  return command.at;
}

/**
 * Applies one command to a scope. The methods on nodes, selections and parameters call the same
 * internal operations this does, so a command and the matching method always behave alike.
 * Throws on a malformed command; `scope.dispatch` turns that into an `error` event.
 */
export function execute(scope: ScopeImpl, command: Command): void {
  switch (command.op) {
    case 'trigger': {
      const at = requireTime(command);
      for (const node of resolve(scope, command.target))
        node.applyTrigger(command.options ?? {}, at);
      return;
    }
    case 'release': {
      const at = requireTime(command);
      const options = command.pitch === undefined ? {} : { pitch: command.pitch };
      for (const node of resolve(scope, command.target)) node.applyRelease(options, at);
      return;
    }
    case 'set': {
      const at = requireTime(command);
      for (const node of resolve(scope, command.target)) {
        for (const [name, value] of Object.entries(command.values)) {
          node.findParam(name)?.applySet(value, at);
        }
      }
      return;
    }
    case 'ramp': {
      const at = requireTime(command);
      for (const node of resolve(scope, command.target)) {
        node.findParam(command.param)?.applyRamp(command.to, at, {
          duration: command.duration,
          ...(command.curve === undefined ? {} : { curve: command.curve }),
          ...(command.from === undefined ? {} : { from: command.from }),
        });
      }
      return;
    }
    case 'offset': {
      const at = requireTime(command);
      for (const node of resolve(scope, command.target)) {
        node.findParam(command.param)?.applyOffset(command.amount ?? 0, at, command.duration);
      }
      return;
    }
    case 'cancel': {
      const at = requireTime(command);
      for (const node of resolve(scope, command.target)) {
        if (command.param === undefined) {
          for (const param of Object.values(node.params)) param.applyCancel(at);
        } else {
          node.findParam(command.param)?.applyCancel(at);
        }
      }
      return;
    }
    case 'call': {
      const at = requireTime(command);
      for (const node of resolve(scope, command.target)) {
        node.applyCall(command.method, command.args ?? {}, at);
      }
      return;
    }
    case 'connect': {
      const end = resolveEdgeTarget(scope, command.to);
      for (const node of resolve(scope, command.target)) connect(node, end);
      return;
    }
    case 'disconnect': {
      const end = command.to === undefined ? undefined : resolveEdgeTarget(scope, command.to);
      for (const node of resolve(scope, command.target)) {
        for (const edge of [...node.outputs]) {
          if (end === undefined || edge.to === end) disconnectEdge(edge);
        }
      }
      return;
    }
    case 'dispose': {
      for (const node of resolve(scope, command.target)) node.dispose();
      return;
    }
    case 'bus': {
      const bus = scope.busImpl(command.name);
      // A command cannot reach outside its scope: an outer bus can be sent to, but not changed.
      if (bus.scope !== scope && (command.to !== undefined || command.gain !== undefined)) {
        throw new CrackedUpError(
          'invalid-command',
          `Bus "${command.name}" belongs to an outer scope and cannot be changed from "${scope.name}".`,
        );
      }
      if (command.to !== undefined) bus.to(command.to);
      if (command.gain !== undefined) bus.gain.set(command.gain);
      return;
    }
    case 'loadBuffer': {
      scope.engine.buffers.load(command.url, { key: command.key });
      return;
    }
    case 'setStep': {
      const sequence = scope.transport.get(command.name);
      if (!sequence) {
        throw new CrackedUpError(
          'missing-target',
          `There is no sequence called "${command.name}".`,
        );
      }
      sequence.setStep(command.index, command.value);
      return;
    }
    case 'clearSequence': {
      scope.transport.clear(command.name);
      return;
    }
    case 'transport': {
      if (command.set.bpm !== undefined) scope.engine.transport.bpm = command.set.bpm;
      if (command.set.swing !== undefined) scope.engine.transport.swing = command.set.swing;
      return;
    }
    case 'bypass': {
      const at = requireTime(command);
      for (const node of resolve(scope, command.target)) node.applyBypass(command.bypass, at);
      return;
    }
    case 'apply': {
      // Per-node failures do not stop the rest; with no caller to return them to, they are reported.
      for (const error of scope.applyNow(command.graph).errors) {
        scope.report(error as CrackedUpError);
      }
      return;
    }
    case 'inside': {
      const inner = scope.node(command.node)?.insideScope;
      if (!inner) {
        throw new CrackedUpError(
          'missing-target',
          `Scope "${scope.name}" has no macro instance with the id "${String(command.node)}".`,
        );
      }
      if (!Array.isArray(command.commands)) {
        throw new CrackedUpError('invalid-command', 'An "inside" command needs a "commands" list.');
      }
      inner.dispatch(command.commands);
      return;
    }
    case 'restartSequence': {
      scope.transport.get(command.name)?.restart();
      return;
    }
    // These carry no callback: the callback lives with a remote, and the link that serves it handles them.
    case 'once':
    case 'sequence':
      throw new CrackedUpError(
        'unsupported',
        `The "${command.op}" command only works through a link to a remote (cracked-up/remote).`,
      );
    default: {
      const unknown = command as { op?: unknown };
      throw new CrackedUpError('invalid-command', `Unknown command "${String(unknown.op)}".`);
    }
  }
}
