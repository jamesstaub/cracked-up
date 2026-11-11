/**
 * Functions the examples use that have no implementation yet. As each lands in `src`, the examples
 * switch to importing the real one and its line here is deleted.
 */

import type {
  Engine,
  EngineOptions,
  Link,
  LinkOptions,
  Remote,
  RemoteOptions,
  Scope,
} from '../src/api';

export type * from '../src/api';
export { defineMacro, defineNode } from '../src/define';

/** Loads worklet modules and returns a ready engine. */
export declare function createEngine(options: EngineOptions): Promise<Engine>;

/** Even pulses across steps: `euclid(3, 8)` is `[1,0,0,1,0,0,1,0]`. `rotate` shifts the start. */
export declare function euclid(hits: number, steps: number, rotate?: number): number[];

/** `cracked-up/remote`, inside the sandbox. */
export declare function createRemote(options: RemoteOptions): Remote;

/** `cracked-up/remote`, on the host. Ties one scope to one remote. */
export declare function linkRemote(scope: Scope, options: LinkOptions): Link;
