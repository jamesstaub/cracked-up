/**
 * cracked-up/editor: a code editor for cracked-up scripts, built on CodeMirror 6.
 *
 * It completes and documents node types, parameters, selectors, buffers and helpers from a catalog
 * of plain data, and shows the source of a node type or helper on Cmd/Ctrl-click. It needs no
 * engine, so it works the same beside a sandbox. The CodeMirror packages are peer dependencies:
 * nothing in the library's other entry points imports them.
 */
export { createEditor } from './editor';
export type {
  CursorInfo,
  Editor,
  EditorOptions,
  ErrorPlace,
  RevealOptions,
  SetValueOptions,
} from './editor';
export type { DiagnosticSeverity, EditorDiagnostic, PlacedDiagnostic } from './diagnostics';
export { createSourcePanel } from './panel';
export type { DefinitionTarget, SourcePanel, SourcePanelOptions } from './panel';
export {
  builtinHelpers,
  catalogFromEngine,
  catalogFromNodes,
  catalogFromRemoteState,
  catalogFromScope,
  catalogFromSnapshot,
  createCatalogStore,
} from './catalog';
export type {
  ArgumentInfo,
  ArgumentKind,
  BufferEntry,
  CatalogStore,
  EditorCatalog,
  FunctionInfo,
  FunctionSignature,
  GlobalInfo,
  HelperInfo,
  IdEntry,
  MemberInfo,
  NamedEntry,
  OptionKeyInfo,
  ReturnInfo,
  ValueInfo,
} from './catalog';
export type { ReceiverKind } from './api-docs';
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
export { diagnosticExtensions, diagnosticsAt, diagnosticsOf, setDiagnostics } from './diagnostics';
