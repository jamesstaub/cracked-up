/**
 * Reading a script well enough to help with it: what a cursor position is (a member after a dot, a
 * key in an options object, the inside of a string), what the expression before a dot is (a chain,
 * a selection, the transport), and what the document itself defines (ids, classes, buses, sequences,
 * node types).
 *
 * Everything works from CodeMirror's syntax tree, which is built to tolerate half-typed code, and
 * nothing here throws on any input.
 */

import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { SyntaxNode, Tree } from '@lezer/common';
import type { NodeTypeInfo, ParamMeta } from '../api';
import { apiMember } from './api-docs';
import type { ReceiverKind } from './api-docs';
import type { ResolvedCatalog } from './catalog';

// --- Tree helpers ---------------------------------------------------------------------------------

export function treeOf(state: EditorState): Tree {
  return ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state);
}

const textOf = (state: EditorState, node: SyntaxNode): string => state.sliceDoc(node.from, node.to);

/** The text inside a string literal's quotes. A string left open ends with its line. */
export function stringValue(state: EditorState, node: SyntaxNode): string {
  const raw = textOf(state, node);
  const quote = raw[0];
  let body = raw.slice(1);
  if (body.endsWith('\n')) body = body.slice(0, -1);
  else if (quote !== undefined && body.endsWith(quote)) body = body.slice(0, -1);
  return body;
}

const isString = (node: SyntaxNode | null | undefined): node is SyntaxNode =>
  node?.name === 'String';

/** The arguments of an argument list, without its brackets and commas. */
function argumentsOf(list: SyntaxNode): SyntaxNode[] {
  const found: SyntaxNode[] = [];
  for (let child = list.firstChild; child; child = child.nextSibling) {
    if (child.name === '(' || child.name === ')' || child.name === ',') continue;
    if (child.type.isError) continue;
    found.push(child);
  }
  return found;
}

/** Which argument a position falls in: the number of commas before it. */
function argumentIndex(list: SyntaxNode, pos: number): number {
  let index = 0;
  for (let child = list.firstChild; child; child = child.nextSibling) {
    if (child.name === ',' && child.to <= pos) index++;
  }
  return index;
}

interface Callee {
  /** The function's name: `lowpass` in `x.lowpass(...)`, `euclid` in `euclid(...)`. */
  readonly name: string;
  /** What it is called on, or null for a bare function. */
  readonly object: SyntaxNode | null;
  readonly nameNode: SyntaxNode;
}

function calleeOf(state: EditorState, call: SyntaxNode): Callee | null {
  const callee = call.firstChild;
  if (!callee) return null;
  if (callee.name === 'VariableName') {
    return { name: textOf(state, callee), object: null, nameNode: callee };
  }
  if (callee.name === 'MemberExpression') {
    const property = callee.lastChild;
    const object = callee.firstChild;
    if (property?.name === 'PropertyName' && object) {
      return { name: textOf(state, property), object, nameNode: property };
    }
  }
  return null;
}

/** The value of `key: 'text'` in an object literal, when it is written as a plain string. */
function stringProperty(state: EditorState, object: SyntaxNode, key: string): SyntaxNode | null {
  for (let child = object.firstChild; child; child = child.nextSibling) {
    if (child.name !== 'Property') continue;
    const name = child.firstChild;
    if (name?.name !== 'PropertyDefinition' || textOf(state, name) !== key) continue;
    const value = child.lastChild;
    return isString(value) ? value : null;
  }
  return null;
}

function propertyValue(state: EditorState, object: SyntaxNode, key: string): SyntaxNode | null {
  for (let child = object.firstChild; child; child = child.nextSibling) {
    if (child.name !== 'Property') continue;
    const name = child.firstChild;
    if (name?.name !== 'PropertyDefinition' || textOf(state, name) !== key) continue;
    const value = child.lastChild;
    return value && value !== name ? value : null;
  }
  return null;
}

// --- What the document defines --------------------------------------------------------------------

/** A node type the script itself defines, with `define({...})`, `defineMacro` or `defineNode`. */
export interface LocalType {
  readonly type: string;
  /** The whole definition call. */
  readonly from: number;
  readonly to: number;
  /** Where the type's name is written. */
  readonly namePos: number;
  /** As much as can be read from the literal, for completion before the host knows the type. */
  readonly info: NodeTypeInfo;
}

export interface DocInfo {
  /** Each `id: '...'` in the document, with the node type it is given to. */
  readonly ids: ReadonlyMap<string, { readonly type: string; readonly pos: number }>;
  /** Each class, with the node types it is given to. */
  readonly classes: ReadonlyMap<string, ReadonlySet<string>>;
  readonly buses: readonly string[];
  readonly sequences: readonly string[];
  readonly localTypes: ReadonlyMap<string, LocalType>;
  /** Where each variable and function parameter is declared. */
  readonly definitions: ReadonlyMap<string, readonly SyntaxNode[]>;
}

const DEFINERS = new Set(['define', 'defineMacro', 'defineNode', 'register']);

function numberLiteral(state: EditorState, node: SyntaxNode | null): number | undefined {
  if (!node) return undefined;
  const value = Number(textOf(state, node));
  return node.name === 'Number' || node.name === 'UnaryExpression'
    ? Number.isFinite(value)
      ? value
      : undefined
    : undefined;
}

function localTypeInfo(state: EditorState, type: string, object: SyntaxNode): NodeTypeInfo {
  const params: ParamMeta[] = [];
  const paramsNode = propertyValue(state, object, 'params');
  if (paramsNode?.name === 'ObjectExpression') {
    for (let child = paramsNode.firstChild; child; child = child.nextSibling) {
      if (child.name !== 'Property') continue;
      const name = child.firstChild;
      const value = child.lastChild;
      if (name?.name !== 'PropertyDefinition') continue;
      const spec = value?.name === 'ObjectExpression' ? value : null;
      const defaultNode = spec ? propertyValue(state, spec, 'default') : null;
      const description = spec ? stringProperty(state, spec, 'description') : null;
      const base = {
        name: textOf(state, name),
        rate: 'control' as const,
        ...(description ? { description: stringValue(state, description) } : {}),
      };
      if (defaultNode?.name === 'BooleanLiteral') {
        params.push({ ...base, kind: 'boolean', default: textOf(state, defaultNode) === 'true' });
      } else if (isString(defaultNode)) {
        params.push({
          ...base,
          kind: 'choice',
          default: stringValue(state, defaultNode),
          choices: [],
        });
      } else {
        params.push({
          ...base,
          kind: 'number',
          default: numberLiteral(state, defaultNode) ?? 0,
          min: numberLiteral(state, spec ? propertyValue(state, spec, 'min') : null) ?? 0,
          max: numberLiteral(state, spec ? propertyValue(state, spec, 'max') : null) ?? 1,
          unit: 'none',
          curve: 'linear',
        });
      }
    }
  }
  const description = stringProperty(state, object, 'description');
  const shorthand = stringProperty(state, object, 'shorthand');
  return {
    type,
    category: 'utility',
    description: description ? stringValue(state, description) : 'Defined in this script.',
    isMacro: true,
    triggerable: propertyValue(state, object, 'trigger') !== null,
    shorthand: shorthand ? stringValue(state, shorthand) : null,
    modulates: null,
    params,
    options: {},
    triggerOptions: {},
  };
}

const scanned = new WeakMap<Tree, DocInfo>();

export function scanDocument(state: EditorState): DocInfo {
  const tree = treeOf(state);
  const known = scanned.get(tree);
  if (known) return known;

  const ids = new Map<string, { type: string; pos: number }>();
  const classes = new Map<string, Set<string>>();
  const buses = new Set<string>();
  const sequences = new Set<string>();
  const localTypes = new Map<string, LocalType>();
  const definitions = new Map<string, SyntaxNode[]>();

  tree.iterate({
    enter(ref) {
      if (ref.name === 'VariableDefinition') {
        const name = state.sliceDoc(ref.from, ref.to);
        const list = definitions.get(name);
        if (list) list.push(ref.node);
        else definitions.set(name, [ref.node]);
        return;
      }
      if (ref.name !== 'CallExpression') return;
      const call = ref.node;
      const callee = calleeOf(state, call);
      const list = call.getChild('ArgList');
      if (!callee || !list) return;
      const args = argumentsOf(list);
      const first = args[0];

      if (first?.name === 'ObjectExpression') {
        if (DEFINERS.has(callee.name)) {
          const typeNode = stringProperty(state, first, 'type');
          if (typeNode) {
            const type = stringValue(state, typeNode);
            localTypes.set(type, {
              type,
              from: call.from,
              to: call.to,
              namePos: typeNode.from + 1,
              info: localTypeInfo(state, type, first),
            });
          }
        } else if (callee.object) {
          const id = stringProperty(state, first, 'id');
          if (id) ids.set(stringValue(state, id), { type: callee.name, pos: id.from + 1 });
          const classNode = stringProperty(state, first, 'class');
          if (classNode) {
            for (const name of stringValue(state, classNode).split(/\s+/).filter(Boolean)) {
              const types = classes.get(name);
              if (types) types.add(callee.name);
              else classes.set(name, new Set([callee.name]));
            }
          }
        }
      } else if (isString(first)) {
        const value = stringValue(state, first);
        if (value === '') return;
        if (callee.name === 'bus') buses.add(value);
        if ((callee.name === 'sequence' || callee.name === 'steps') && args.length > 1) {
          sequences.add(value);
        }
      }
    },
  });

  const info: DocInfo = {
    // In the order written: an outer call is met before the calls it is chained from.
    ids: new Map([...ids].sort((a, b) => a[1].pos - b[1].pos)),
    classes,
    buses: [...buses],
    sequences: [...sequences],
    localTypes,
    definitions,
  };
  scanned.set(tree, info);
  return info;
}

/** Everything needed to answer a question about one state of one editor. */
export interface Scene {
  readonly state: EditorState;
  readonly tree: Tree;
  readonly catalog: ResolvedCatalog;
  readonly doc: DocInfo;
}

export function sceneOf(state: EditorState, catalog: ResolvedCatalog): Scene {
  return { state, tree: treeOf(state), catalog, doc: scanDocument(state) };
}

/** A node type by name: from the catalog, or else one the document defines. */
export function typeInfo(scene: Scene, name: string): NodeTypeInfo | undefined {
  return scene.catalog.types.get(name) ?? scene.doc.localTypes.get(name)?.info;
}

/** Every node type the script can use, the catalog's first. */
export function allTypes(scene: Scene): NodeTypeInfo[] {
  const types = [...scene.catalog.types.values()];
  for (const local of scene.doc.localTypes.values()) {
    if (!scene.catalog.types.has(local.type)) types.push(local.info);
  }
  return types;
}

// --- What an expression is ------------------------------------------------------------------------

/** What the expression before a dot is, as far as can be told. */
export interface Receiver {
  readonly kind: ReceiverKind | 'unknown';
  /**
   * For a chain: the type of its last node. For a selection: the node types it can hold.
   * null when that cannot be worked out, meaning any type.
   */
  readonly types: readonly string[] | null;
}

const UNKNOWN: Receiver = { kind: 'unknown', types: null };
const of = (kind: ReceiverKind, types: readonly string[] | null = null): Receiver => ({
  kind,
  types,
});

/** The node types a selector can match, or null when it could be any. */
export function selectorTypes(scene: Scene, selector: string): string[] | null {
  const found = new Set<string>();
  for (const part of selector.split(',')) {
    const compound =
      part
        .trim()
        .split(/[\s>]+/)
        .pop() ?? '';
    if (compound === '') return null;
    const type = /^[A-Za-z_][\w-]*/.exec(compound)?.[0];
    const id = /#([\w-]+)/.exec(compound)?.[1];
    const className = /\.([\w-]+)/.exec(compound)?.[1];
    if (type !== undefined && typeInfo(scene, type)) found.add(type);
    else if (id !== undefined) {
      const owner = scene.doc.ids.get(id);
      if (!owner || !typeInfo(scene, owner.type)) return null;
      found.add(owner.type);
    } else if (className !== undefined) {
      const owners = scene.doc.classes.get(className);
      if (!owners) return null;
      for (const owner of owners) found.add(owner);
    } else return null;
  }
  return found.size > 0 ? [...found] : null;
}

/** What a name refers to, from where it is declared. */
function classifyName(scene: Scene, name: string, pos: number, depth: number): Receiver {
  const declared = scene.doc.definitions.get(name);
  if (!declared || declared.length === 0) {
    // A name the host offers, such as `midi`, when the host has said what it is.
    const kind = scene.catalog.globals.get(name)?.kind;
    return kind ? of(kind) : UNKNOWN;
  }
  // The nearest declaration before the use; failing that, the first.
  const definition = [...declared].reverse().find((node) => node.from <= pos) ?? declared[0]!;
  const parent = definition.parent;
  if (!parent) return UNKNOWN;
  if (parent.name === 'VariableDeclaration') {
    let value = definition.nextSibling;
    while (value && value.name !== 'Equals') value = value.nextSibling;
    value = value?.nextSibling ?? null;
    return value ? classify(scene, value, depth + 1) : UNKNOWN;
  }
  if (parent.name === 'ParamList') {
    // A callback's parameter is known by what the callback is passed to.
    const fn = parent.parent;
    const list = fn?.parent;
    const call = list?.name === 'ArgList' ? list.parent : null;
    const callee = call ? calleeOf(scene.state, call) : null;
    if (!callee || !fn) return UNKNOWN;
    let index = 0;
    for (let child = parent.firstChild; child && child !== definition; child = child.nextSibling) {
      if (child.name === ',') index++;
    }
    if (callee.name === 'sequence' && index === 0) return of('event');
    if (callee.name === 'steps' && index === 3) return of('event');
    if (callee.name === 'onDisplay' && index === 0) return of('event');
    if (callee.name === 'split' && index === 0) return of('chain');
    if (callee.name === 'each' && index === 0) return of('node');
    if (callee.name === 'build' && index === 0 && callee.object) {
      const owner = classify(scene, callee.object, depth + 1);
      if (owner.kind === 'midi') return of('midi');
    }
    if (callee.name === 'on' && index === 0 && callee.object) {
      const owner = classify(scene, callee.object, depth + 1);
      if (owner.kind === 'midi') return of('midiEvent');
    }
    if (!callee.object && index === 0) {
      if (['keyPress', 'keyRelease', 'key_press'].includes(callee.name)) return of('keyInfo');
      if (['mouseMovement', 'mouse_movement'].includes(callee.name)) return of('mouseInfo');
    }
  }
  return UNKNOWN;
}

/** Works out what an expression is: a chain, a selection, the transport, and so on. */
export function classify(scene: Scene, node: SyntaxNode, depth = 0): Receiver {
  if (depth > 12) return UNKNOWN;
  const { state } = scene;
  switch (node.name) {
    case 'ParenthesizedExpression': {
      const inner = node.firstChild?.nextSibling;
      return inner ? classify(scene, inner, depth + 1) : UNKNOWN;
    }
    case 'VariableName': {
      const name = textOf(state, node);
      if (name === '__') return of('dunder');
      return classifyName(scene, name, node.from, depth);
    }
    case 'MemberExpression': {
      const object = node.firstChild;
      const property = node.lastChild;
      if (!object || property?.name !== 'PropertyName') return UNKNOWN;
      const owner = classify(scene, object, depth + 1);
      if (owner.kind === 'unknown') return UNKNOWN;
      const member = apiMember(owner.kind, textOf(state, property));
      if (!member?.returns || member.signature) return UNKNOWN;
      if (member.returns === 'same') return owner;
      return of(member.returns, member.returns === 'selection' ? owner.types : null);
    }
    case 'CallExpression': {
      const callee = calleeOf(state, node);
      const list = node.getChild('ArgList');
      if (!callee) return UNKNOWN;
      const first = list ? argumentsOf(list)[0] : undefined;
      if (!callee.object) {
        if (callee.name !== '__') return UNKNOWN;
        if (!first) return of('chain');
        return of(
          'selection',
          isString(first) ? selectorTypes(scene, stringValue(state, first)) : null,
        );
      }
      const owner = classify(scene, callee.object, depth + 1);
      if (owner.kind === 'unknown') return UNKNOWN;
      if (owner.kind === 'chain' && typeInfo(scene, callee.name)) {
        return of('chain', [callee.name]);
      }
      if (owner.kind === 'selection' && callee.name === 'select') {
        return of(
          'selection',
          isString(first) ? selectorTypes(scene, stringValue(state, first)) : null,
        );
      }
      const member = apiMember(owner.kind, callee.name);
      if (member?.signature) {
        if (!member.returns) return UNKNOWN;
        if (member.returns === 'same') return owner;
        // A chain from a selection or a bus continues from something that is not a new node.
        return of(member.returns, null);
      }
      // A parameter setter: `.frequency(200)` on a selection gives the selection back.
      if (owner.kind === 'selection' && isParamName(scene, callee.name)) return owner;
      return UNKNOWN;
    }
    default:
      return UNKNOWN;
  }
}

function isParamName(scene: Scene, name: string): boolean {
  return allTypes(scene).some((info) => info.params.some((param) => param.name === name));
}

// --- What a cursor position is --------------------------------------------------------------------

/** The call an argument belongs to. */
export interface CallSite {
  /** The function's name. */
  readonly name: string;
  /** What it is called on. `null` for a bare function such as `euclid(...)` or `__(...)`. */
  readonly receiver: Receiver | null;
  /** Which argument, counted from 0. */
  readonly index: number;
  readonly node: SyntaxNode;
  readonly args: readonly SyntaxNode[];
}

export type CursorContext =
  /** After a dot: `__().saw().|`. */
  | { readonly kind: 'member'; readonly from: number; readonly receiver: Receiver }
  /** A key of an options object: `.lowpass({ |`. */
  | {
      readonly kind: 'key';
      readonly from: number;
      readonly call: CallSite;
      /** The keys the object already has. */
      readonly present: ReadonlySet<string>;
    }
  /** The value of a key, outside a string: `{ loop: |`. */
  | { readonly kind: 'value'; readonly from: number; readonly key: string; readonly call: CallSite }
  /** Inside a string literal. */
  | {
      readonly kind: 'string';
      /** Just after the opening quote. */
      readonly from: number;
      /** The string's text up to the cursor. */
      readonly before: string;
      /** The call it is an argument of, or the call whose options object it is a value in. */
      readonly call: CallSite | null;
      /** The key it is the value of, when it is one. */
      readonly key: string | null;
    }
  /** A name on its own: a helper, `__`, a variable. */
  | { readonly kind: 'name'; readonly from: number };

function callSite(scene: Scene, call: SyntaxNode, pos: number): CallSite | null {
  const callee = calleeOf(scene.state, call);
  const list = call.getChild('ArgList');
  if (!callee || !list) return null;
  return {
    name: callee.name,
    receiver: callee.object ? classify(scene, callee.object) : null,
    index: argumentIndex(list, pos),
    node: call,
    args: argumentsOf(list),
  };
}

/** The call whose argument list directly holds `node`. */
function callHolding(scene: Scene, node: SyntaxNode): CallSite | null {
  const list = node.parent;
  if (list?.name !== 'ArgList' || !list.parent) return null;
  return callSite(scene, list.parent, node.from);
}

function presentKeys(
  state: EditorState,
  object: SyntaxNode,
  except: SyntaxNode | null,
): Set<string> {
  const keys = new Set<string>();
  for (let child = object.firstChild; child; child = child.nextSibling) {
    const name = child.name === 'Property' ? child.firstChild : null;
    if (name?.name === 'PropertyDefinition' && name !== except) keys.add(textOf(state, name));
  }
  return keys;
}

export function contextAt(scene: Scene, pos: number): CursorContext | null {
  const { state, tree } = scene;
  let node: SyntaxNode = tree.resolveInner(pos, -1);
  if (node.name === 'LineComment' || node.name === 'BlockComment') return null;
  if (node.name === 'RegExp' || node.name === 'Number') return null;

  if (node.name === 'TemplateString') return null;
  if (isString(node) && pos > node.from) {
    // After the closing quote is outside the string.
    const raw = textOf(state, node);
    const closed = raw.length > 1 && raw.endsWith(raw[0]!);
    if (closed && pos >= node.to) return null;
    const parent = node.parent;
    let call: CallSite | null = null;
    let key: string | null = null;
    if (parent?.name === 'ArgList') call = callHolding(scene, node);
    else if (parent?.name === 'Property') {
      const name = parent.firstChild;
      if (name?.name === 'PropertyDefinition') key = textOf(state, name);
      const object = parent.parent;
      if (object?.name === 'ObjectExpression') call = callHolding(scene, object);
    }
    return {
      kind: 'string',
      from: node.from + 1,
      before: state.sliceDoc(node.from + 1, pos),
      call,
      key,
    };
  }

  if (node.name === 'PropertyName' && node.parent?.name === 'MemberExpression') {
    const object = node.parent.firstChild;
    if (!object) return null;
    return { kind: 'member', from: node.from, receiver: classify(scene, object) };
  }
  if ((node.name === '.' || node.name === '?.') && node.parent?.name === 'MemberExpression') {
    const object = node.parent.firstChild;
    if (!object || pos !== node.to) return null;
    return { kind: 'member', from: pos, receiver: classify(scene, object) };
  }

  if (node.type.isError && node.parent) node = node.parent;

  // `.lowpass({ fre` with nothing after it reads as the start of an arrow function's parameters.
  if (node.name === 'PropertyName' && node.parent?.name === 'PatternProperty') {
    const pattern = node.parent.parent;
    let list: SyntaxNode | null = pattern?.parent ?? null;
    for (let hops = 0; list && list.name !== 'ArgList' && hops < 3; hops++) list = list.parent;
    if (pattern?.name !== 'ObjectPattern' || list?.name !== 'ArgList' || !list.parent) return null;
    const call = callSite(scene, list.parent, pattern.from);
    if (!call) return null;
    const present = new Set<string>();
    for (let child = pattern.firstChild; child; child = child.nextSibling) {
      const name = child.name === 'PatternProperty' ? child.firstChild : null;
      if (name && name.from !== node.from) present.add(textOf(state, name));
    }
    return { kind: 'key', from: node.from, call, present };
  }

  // A key of an object literal that is an argument of a call.
  if (node.name === 'PropertyDefinition' && node.parent?.name === 'Property') {
    const property = node.parent;
    const object = property.parent;
    // Only a key that is still being typed (no colon after it yet) or that the cursor is in.
    if (object?.name === 'ObjectExpression') {
      const call = callHolding(scene, object);
      if (call) {
        return { kind: 'key', from: node.from, call, present: presentKeys(state, object, node) };
      }
    }
    return null;
  }
  if (node.name === 'ObjectExpression' || node.name === '{' || node.name === ',') {
    const object = node.name === 'ObjectExpression' ? node : node.parent;
    if (object?.name === 'ObjectExpression') {
      const call = callHolding(scene, object);
      if (call) return { kind: 'key', from: pos, call, present: presentKeys(state, object, null) };
      return null;
    }
  }

  // The value of a key. In the space after a colon the innermost node is the property itself.
  const colon = node.name === 'Property' ? node.getChild(':') : null;
  if (colon && pos >= colon.to) node = colon;
  const property =
    node.name === ':' ? node.parent : node.parent?.name === 'Property' ? node.parent : null;
  if (property?.name === 'Property' && property.firstChild?.name === 'PropertyDefinition') {
    const object = property.parent;
    const call = object?.name === 'ObjectExpression' ? callHolding(scene, object) : null;
    const isName = node.name === 'VariableName';
    if (call && (node.name === ':' || isName)) {
      return {
        kind: 'value',
        from: isName ? node.from : pos,
        key: textOf(state, property.firstChild),
        call,
      };
    }
  }

  if (node.name === 'VariableName') return { kind: 'name', from: node.from };
  if (node.name === 'VariableDefinition' || node.name === 'PropertyDefinition') return null;
  return { kind: 'name', from: pos };
}

/** The innermost call whose brackets the cursor is directly inside, for signature help. */
export function callAround(scene: Scene, pos: number): CallSite | null {
  let node: SyntaxNode | null = scene.tree.resolveInner(pos, -1);
  for (; node; node = node.parent) {
    // The body of a callback is not "inside the call" for this purpose.
    if (
      node.name === 'ArrowFunction' ||
      node.name === 'FunctionExpression' ||
      node.name === 'FunctionDeclaration' ||
      node.name === 'Block'
    ) {
      return null;
    }
    if (node.name === 'ArgList' && node.parent && pos > node.from) {
      const closed = scene.state.sliceDoc(node.to - 1, node.to) === ')';
      if (closed && pos >= node.to) continue;
      return callSite(scene, node.parent, pos);
    }
  }
  return null;
}

// --- What is under a position (for hover and go to definition) -------------------------------------

export type Entity =
  | {
      readonly kind: 'type';
      readonly name: string;
      readonly info: NodeTypeInfo;
      readonly local: LocalType | null;
      readonly from: number;
      readonly to: number;
    }
  | { readonly kind: 'helper'; readonly name: string; readonly from: number; readonly to: number }
  | { readonly kind: 'global'; readonly name: string; readonly from: number; readonly to: number }
  | { readonly kind: 'dunder'; readonly from: number; readonly to: number }
  | {
      readonly kind: 'member';
      readonly receiver: ReceiverKind;
      readonly name: string;
      readonly from: number;
      readonly to: number;
    }
  | {
      /** A parameter setter: `.frequency(200)`. */
      readonly kind: 'setter';
      readonly name: string;
      readonly types: readonly string[] | null;
      readonly from: number;
      readonly to: number;
    }
  | {
      readonly kind: 'key';
      readonly name: string;
      readonly call: CallSite;
      readonly from: number;
      readonly to: number;
    }
  | {
      readonly kind: 'string';
      readonly value: string;
      readonly call: CallSite | null;
      readonly key: string | null;
      readonly from: number;
      readonly to: number;
    };

function typeEntity(scene: Scene, name: string, from: number, to: number): Entity | null {
  const info = typeInfo(scene, name);
  if (!info) return null;
  return { kind: 'type', name, info, local: scene.doc.localTypes.get(name) ?? null, from, to };
}

export function entityAt(scene: Scene, pos: number): Entity | null {
  const { state, tree } = scene;
  let node: SyntaxNode = tree.resolveInner(pos, 1);
  if (node.name !== 'PropertyName' && node.name !== 'VariableName' && node.name !== 'String') {
    const before = tree.resolveInner(pos, -1);
    if (before.name === 'PropertyName' || before.name === 'VariableName') node = before;
    else if (node.name !== 'PropertyDefinition') node = before;
  }
  const { from, to } = node;
  const name = textOf(state, node);

  if (node.name === 'PropertyName' && node.parent?.name === 'MemberExpression') {
    const object = node.parent.firstChild;
    if (!object) return null;
    const receiver = classify(scene, object);
    const isCalled = node.parent.parent?.name === 'CallExpression';
    if (receiver.kind === 'unknown') {
      // On something unknown (a variable holding a chain, say), a call by a type's name is still
      // most likely that type.
      return isCalled ? typeEntity(scene, name, from, to) : null;
    }
    if (receiver.kind === 'chain') {
      const type = typeEntity(scene, name, from, to);
      if (type) return type;
    }
    if (apiMember(receiver.kind, name)) {
      return { kind: 'member', receiver: receiver.kind, name, from, to };
    }
    if (receiver.kind === 'selection' && isParamName(scene, name)) {
      return { kind: 'setter', name, types: receiver.types, from, to };
    }
    return null;
  }
  if (node.name === 'VariableName') {
    if (name === '__') return { kind: 'dunder', from, to };
    // A name the script declares itself hides a helper of the same name.
    if (scene.doc.definitions.has(name)) return null;
    if (scene.catalog.helpers.has(name)) return { kind: 'helper', name, from, to };
    if (scene.catalog.globals.has(name)) return { kind: 'global', name, from, to };
    return null;
  }
  if (node.name === 'PropertyDefinition' && node.parent?.name === 'Property') {
    const object = node.parent.parent;
    const call = object?.name === 'ObjectExpression' ? callHolding(scene, object) : null;
    return call ? { kind: 'key', name, call, from, to } : null;
  }
  if (isString(node)) {
    const value = stringValue(state, node);
    const parent = node.parent;
    if (parent?.name === 'ArgList') {
      return { kind: 'string', value, call: callHolding(scene, node), key: null, from, to };
    }
    if (parent?.name === 'Property' && parent.firstChild?.name === 'PropertyDefinition') {
      const object = parent.parent;
      const call = object?.name === 'ObjectExpression' ? callHolding(scene, object) : null;
      const key = textOf(state, parent.firstChild);
      // `type: 'blip'` in a definition names the type being defined.
      if (key === 'type' && call && DEFINERS.has(call.name)) {
        return typeEntity(scene, value, from, to);
      }
      return { kind: 'string', value, call, key, from, to };
    }
  }
  return null;
}
