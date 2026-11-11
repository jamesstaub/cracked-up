import type { MacroDefinition, NodeDefinition } from './api';

/**
 * Declares a node type. Returns the definition unchanged; it exists for type inference and as the one
 * documented way to write a definition. Register the result with `createEngine({ nodes })` or
 * `engine.registry.register()`.
 */
export function defineNode<K extends string>(definition: NodeDefinition<K>): NodeDefinition<K> {
  return definition;
}

/** Declares a macro: a node type built from other nodes. See `defineNode`. */
export function defineMacro<K extends string>(definition: MacroDefinition<K>): MacroDefinition<K> {
  return definition;
}
