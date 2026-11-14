import type { MacroDefinition, NodeDefinition, NodeTypeInfo } from './api';
import { describeNodeType } from './core/registry';
import { builtinNodes } from './nodes/builtin';

export { describeNodeType };

/**
 * What an engine's `registry.list()` reports for these definitions, in the same order, without an
 * engine or an audio context. With no argument: the built-in node types. For a page that shows node
 * types (an editor's catalog, a reference) before any audio exists.
 *
 * A macro is recognised by having been made with `defineMacro`, as it is when registered.
 */
export function describeNodeTypes(
  definitions: readonly (NodeDefinition | MacroDefinition)[] = builtinNodes,
): NodeTypeInfo[] {
  return definitions.map(describeNodeType);
}
