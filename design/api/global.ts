/**
 * Proposed surface of `cracked-up/global`: one default engine on a live AudioContext, for live coding
 * and the docs playground. This is the only entry point that creates a context or holds module state.
 */

import type { Engine } from './engine';
import type { ScopeApi } from './graph';
import type { Transport } from './transport';

export { euclid } from './transport';

/** Resolves once the default engine's worklets have loaded. */
export declare const ready: Promise<Engine>;

/** `__` bound to the default engine's root scope. */
export declare const __: ScopeApi;

/** The default engine's transport. */
export declare const transport: Transport;

/** Resumes the context (call from a click or key press) and starts the transport. */
export declare function play(): Promise<void>;

/** Stops the transport and releases everything that is sounding. */
export declare function stop(): void;
