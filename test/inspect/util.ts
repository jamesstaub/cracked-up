import { createEngine } from '../../src';
import type { Engine } from '../../src';

/**
 * Records every connection made to an `AnalyserNode` and every one removed again, by wrapping the
 * browser's own `connect` and `disconnect`. `open` is how many are in place right now.
 */
export function watchAnalysers(): { readonly open: number; made: number; restore(): void } {
  const ids = new WeakMap<object, number>();
  let next = 0;
  const id = (thing: object): number => {
    if (!ids.has(thing)) ids.set(thing, next++);
    return ids.get(thing)!;
  };
  const open = new Set<string>();
  const proto = AudioNode.prototype as unknown as {
    connect: (...args: unknown[]) => unknown;
    disconnect: (...args: unknown[]) => unknown;
  };
  const { connect, disconnect } = proto;
  const watch = {
    get open(): number {
      return open.size;
    },
    made: 0,
    restore(): void {
      proto.connect = connect;
      proto.disconnect = disconnect;
    },
  };
  proto.connect = function (this: AudioNode, ...args: unknown[]): unknown {
    const result = connect.apply(this, args);
    if (args[0] instanceof AnalyserNode) {
      open.add(`${id(this)}>${id(args[0])}`);
      watch.made++;
    }
    return result;
  };
  proto.disconnect = function (this: AudioNode, ...args: unknown[]): unknown {
    const result = disconnect.apply(this, args);
    if (args.length === 0) {
      for (const key of [...open]) if (key.startsWith(`${id(this)}>`)) open.delete(key);
    } else if (args[0] instanceof AnalyserNode) {
      open.delete(`${id(this)}>${id(args[0])}`);
    }
    return result;
  };
  return watch;
}

/** Waits for the given number of animation frames. */
export async function frames(count = 2): Promise<void> {
  for (let i = 0; i < count; i++) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}

export const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** An engine on a live context, running if this browser lets a page start audio without a click. */
export async function liveEngine(): Promise<{
  engine: Engine;
  context: AudioContext;
  running: boolean;
}> {
  const context = new AudioContext();
  await Promise.race([context.resume(), wait(1000)]);
  const engine = await createEngine({ context });
  // Nothing these tests build should be heard on the machine running them.
  engine.bus('main').gain.set(0);
  return { engine, context, running: context.state === 'running' };
}

/** First index at which two renders differ on any channel, or -1 if they are the same. */
export function firstDifference(a: AudioBuffer, b: AudioBuffer): number {
  if (a.length !== b.length || a.numberOfChannels !== b.numberOfChannels) return 0;
  for (let channel = 0; channel < a.numberOfChannels; channel++) {
    const x = a.getChannelData(channel);
    const y = b.getChannelData(channel);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return i;
  }
  return -1;
}
