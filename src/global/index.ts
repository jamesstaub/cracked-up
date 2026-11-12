/**
 * `cracked-up/global`: one ready-made engine on a live AudioContext, for live coding and playgrounds.
 *
 * Importing this module creates the context and the engine. It is the only entry point with module
 * state; the main entry point creates nothing until `createEngine` is called.
 */

import type { Engine, ScopeApi, Transport } from '../api';
import { EngineImpl } from '../core/engine';

export { euclid } from '../util/pattern';

/** The default engine. Its context starts suspended until `play()` is called from a user gesture. */
const impl = new EngineImpl({ context: new AudioContext() });
export const engine = impl as unknown as Engine;

/**
 * Resolves with the default engine once its AudioWorklet processors have loaded. Everything except
 * the node types that need them (`bitcrusher`) works before that.
 */
export const ready: Promise<Engine> = impl.loadWorklets().then(() => engine);

/** Starts a chain with no argument, or selects nodes with a selector. */
export const __: ScopeApi = engine.$;

/** The default engine's transport. */
export const transport: Transport = engine.transport;

/** Resumes the context and starts the transport. Call it from a click or key press. */
export async function play(): Promise<void> {
  await engine.resume();
  transport.start();
}

/** Stops the transport and releases everything that is sounding. */
export function stop(): void {
  transport.stop();
  engine.select('*').release();
}
