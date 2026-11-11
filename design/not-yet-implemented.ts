/**
 * Functions the examples use that have no implementation yet. As each lands in `src`, the examples
 * switch to importing the real one and its line here is deleted.
 */

import type { Link, LinkOptions, Remote, RemoteOptions, Scope } from '../src/api';

export type * from '../src/api';
export { createEngine, defineMacro, defineNode } from '../src';
export { euclid } from '../src/util';

/** `cracked-up/remote`, inside the sandbox. */
export declare function createRemote(options: RemoteOptions): Remote;

/** `cracked-up/remote`, on the host. Ties one scope to one remote. */
export declare function linkRemote(scope: Scope, options: LinkOptions): Link;
