/**
 * cracked-up/editor: a code editor for cracked-up scripts, built on CodeMirror 6.
 *
 * It completes and documents node types, parameters, selectors, buffers and helpers from a catalog
 * of plain data, and shows the source of a node type or helper on Cmd/Ctrl-click. It needs no
 * engine, so it works the same beside a sandbox. The CodeMirror packages are peer dependencies:
 * nothing in the library's other entry points imports them.
 */
export { createEditor } from './editor';
export type { Editor, EditorOptions, ErrorPlace, SetValueOptions } from './editor';
export { createSourcePanel } from './panel';
export type { DefinitionTarget, SourcePanel, SourcePanelOptions } from './panel';
export {
  builtinHelpers,
  catalogFromEngine,
  catalogFromRemoteState,
  createCatalogStore,
} from './catalog';
export type { BufferEntry, CatalogStore, EditorCatalog, GlobalInfo, HelperInfo } from './catalog';
export { builtinSources } from './sources';
export type { SourceEntry, SourcePart, SourceResolver } from './sources';
export { THEME_PROPERTIES, editorStyles, editorTheme } from './theme';
export type { ThemeChoice } from './theme';
export { highlightBlocks, highlightInto, tokenize } from './highlight';
export type { Token, TokenType } from './highlight';

// The pieces the editor is made of, for hosts that build their own CodeMirror setup.
export { resolveCatalog } from './catalog';
export type { ResolvedCatalog } from './catalog';
export { completionSource, completionsAt } from './completion';
export { catalogField, definitionAt, hoverAt, setCatalogEffect, signatureAt } from './intel';
