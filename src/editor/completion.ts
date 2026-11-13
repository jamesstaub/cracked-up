/**
 * Completion from the catalog. `completionsAt` is the whole of it as a plain function of an editor
 * state, a position and a catalog, which is what the tests call; `completionSource` wraps it for
 * CodeMirror.
 */

import { insertCompletionText, pickedCompletion } from '@codemirror/autocomplete';
import type {
  Completion,
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from '@codemirror/autocomplete';
import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { NodeTypeInfo, OptionInfo, ParamMeta } from '../api';
import { allTypes, contextAt, sceneOf, selectorTypes, stringValue, typeInfo } from './analysis';
import type { CallSite, CursorContext, Receiver, Scene } from './analysis';
import {
  API,
  AT_OPTIONS,
  COMMON_INIT,
  DEFINITION_OPTIONS,
  DUNDER_CALL,
  DURATIONS,
  EVERY_OPTIONS,
  OFFSET_OPTIONS,
  RAMP_OPTIONS,
  RELEASE_OPTIONS,
  SEQUENCE_OPTIONS,
  START_OPTIONS,
  TRIGGER_COMMON,
} from './api-docs';
import type { ApiOption, ReceiverKind } from './api-docs';
import type { ResolvedCatalog } from './catalog';
import {
  bufferDoc,
  globalDoc,
  helperDoc,
  memberDoc,
  optionDetail,
  optionDoc,
  paramDetail,
  paramDoc,
  renderDoc,
  setterDoc,
  typeDoc,
  typeKind,
} from './docs';
import type { Doc } from './docs';

const info = (doc: Doc) => (): Node => renderDoc(doc);

const OWNER_NAMES: Readonly<Record<ReceiverKind, string>> = {
  dunder: '__',
  transport: 'transport',
  chain: 'chain',
  selection: 'selection',
  node: 'node',
  bus: 'bus',
  sequence: 'sequence',
  param: 'parameter',
  event: 'event',
  position: 'position',
};

// --- How a completion is put into the text ---------------------------------------------------------

/** Inserts `name()` with the cursor between the brackets, or just `name` when brackets follow. */
function applyCall(name: string, takesArguments: boolean) {
  return (view: EditorView, completion: Completion, from: number, to: number): void => {
    const hasBrackets = view.state.sliceDoc(to, to + 1) === '(';
    const text = hasBrackets ? name : `${name}()`;
    const cursor = from + name.length + (hasBrackets ? 0 : takesArguments ? 1 : 2);
    view.dispatch({
      ...insertCompletionText(view.state, text, from, to),
      selection: { anchor: cursor },
      annotations: pickedCompletion.of(completion),
    });
  };
}

/** Inserts `key: `, or just `key` when a colon already follows. */
function applyKey(name: string) {
  return (view: EditorView, completion: Completion, from: number, to: number): void => {
    const hasColon = /^\s*:/.test(view.state.sliceDoc(to, to + 20));
    view.dispatch({
      ...insertCompletionText(view.state, hasColon ? name : `${name}: `, from, to),
      annotations: pickedCompletion.of(completion),
    });
  };
}

const takesArguments = (signature: string): boolean => !signature.endsWith('()');

// --- After a dot ----------------------------------------------------------------------------------

function memberOptions(kind: ReceiverKind, section: { name: string; rank: number }): Completion[] {
  return API[kind].map((member) => ({
    label: member.name,
    type: member.signature ? 'method' : 'property',
    detail: member.signature ? member.signature.slice(member.name.length) : '',
    info: info(memberDoc(member, OWNER_NAMES[kind])),
    section,
    ...(member.signature
      ? { apply: applyCall(member.name, takesArguments(member.signature)) }
      : {}),
  }));
}

function typeOptions(scene: Scene): Completion[] {
  return allTypes(scene).map((type) => ({
    label: type.type,
    type: 'class',
    detail: type.shorthand ? `${typeKind(type)} · ${type.shorthand}` : typeKind(type),
    info: info(typeDoc(type)),
    section: { name: 'Node types', rank: 2 },
    apply: applyCall(type.type, true),
  }));
}

/** The parameters of the given types (or of all types), each with the types that have it. */
function paramsOf(
  scene: Scene,
  types: readonly string[] | null,
): Map<string, { param: ParamMeta; owners: string[] }> {
  const found = new Map<string, { param: ParamMeta; owners: string[] }>();
  const infos = types ? types.flatMap((name) => typeInfo(scene, name) ?? []) : allTypes(scene);
  for (const type of infos) {
    for (const param of type.params) {
      const entry = found.get(param.name);
      if (entry) entry.owners.push(type.type);
      else found.set(param.name, { param, owners: [type.type] });
    }
  }
  return found;
}

function setterOptions(scene: Scene, types: readonly string[] | null): Completion[] {
  // A parameter whose name is already a method (`release`) has no setter.
  const methods = new Set(API.selection.map((member) => member.name));
  return [...paramsOf(scene, types)]
    .filter(([name]) => !methods.has(name))
    .map(([name, { param, owners }]) => ({
      label: name,
      type: 'function',
      detail: `(value) · ${paramDetail(param)}`,
      info: info(setterDoc(param, owners)),
      section: { name: 'Parameter setters', rank: 2 },
      apply: applyCall(name, true),
    }));
}

function memberCompletions(scene: Scene, receiver: Receiver): Completion[] | null {
  switch (receiver.kind) {
    case 'unknown':
      return null;
    case 'chain':
      return [...memberOptions('chain', { name: 'Chain', rank: 1 }), ...typeOptions(scene)];
    case 'selection':
      return [
        ...memberOptions('selection', { name: 'Selection', rank: 1 }),
        ...setterOptions(scene, receiver.types),
      ];
    default:
      return memberOptions(receiver.kind, { name: OWNER_NAMES[receiver.kind], rank: 1 });
  }
}

// --- Keys of an options object ---------------------------------------------------------------------

export interface KeyOption {
  readonly name: string;
  readonly detail: string;
  readonly doc: Doc;
  readonly section: string;
  /** What the value can be, when the editor can offer values. */
  readonly param?: ParamMeta;
  readonly option?: OptionInfo | ApiOption;
}

const fromParams = (
  params: Iterable<{ param: ParamMeta; owners: string[] }>,
  section: string,
): KeyOption[] =>
  [...params].map(({ param, owners }) => ({
    name: param.name,
    detail: paramDetail(param),
    doc: paramDoc(param, owners.slice(0, 4).join(', ')),
    section,
    param,
  }));

const fromOptions = (
  options: Readonly<Record<string, OptionInfo>> | readonly ApiOption[],
  section: string,
  kind = 'option',
): KeyOption[] => {
  const entries: [string, OptionInfo | ApiOption][] = Array.isArray(options)
    ? (options as readonly ApiOption[]).map((option) => [option.name, option])
    : Object.entries(options as Readonly<Record<string, OptionInfo>>);
  return entries.map(([name, option]) => ({
    name,
    detail: optionDetail(option),
    doc: optionDoc(name, option, kind),
    section,
    option,
  }));
};

const typesOf = (scene: Scene, types: readonly string[] | null): NodeTypeInfo[] =>
  types ? types.flatMap((name) => typeInfo(scene, name) ?? []) : allTypes(scene);

/** The keys an options object accepts, given the call it is an argument of. */
export function keyOptions(scene: Scene, call: CallSite): KeyOption[] {
  const { name, index, receiver } = call;
  if (receiver === null) {
    return name === 'define' || name === 'defineMacro' || name === 'defineNode'
      ? index === 0
        ? fromOptions(DEFINITION_OPTIONS, 'Definition', 'definition field')
        : []
      : [];
  }
  const kind = receiver.kind;
  const type = typeInfo(scene, name);
  if (type && index === 0 && (kind === 'chain' || kind === 'unknown')) {
    return [
      ...fromParams(paramsOf(scene, [name]).values(), 'Parameters'),
      ...fromOptions(type.options, 'Options', `option of ${name}`),
      ...fromOptions(COMMON_INIT, 'Every node', 'option of every node'),
    ];
  }
  if (kind === 'selection' || kind === 'node' || kind === 'unknown') {
    const types = kind === 'selection' ? receiver.types : null;
    if (name === 'set' && index === 0)
      return fromParams(paramsOf(scene, types).values(), 'Parameters');
    if (name === 'set' && index === 1) return fromOptions(AT_OPTIONS, 'Options');
    if (name === 'trigger' && index === 0) {
      const merged: Record<string, OptionInfo> = {};
      const triggerable = typesOf(scene, types).filter((candidate) => candidate.triggerable);
      for (const candidate of triggerable) Object.assign(merged, candidate.triggerOptions);
      const optionNames = new Set(Object.keys(merged));
      const params = [
        ...paramsOf(
          scene,
          triggerable.map((candidate) => candidate.type),
        ).values(),
      ];
      return [
        ...fromOptions(merged, 'Trigger options', 'trigger option'),
        ...fromOptions(
          TRIGGER_COMMON.filter((option) => !optionNames.has(option.name)),
          'Trigger options',
          'trigger option',
        ),
        ...fromParams(
          params.filter(({ param }) => !optionNames.has(param.name) && param.name !== 'at'),
          'Parameters, for this trigger only',
        ),
      ];
    }
    if (name === 'release' && index === 0) return fromOptions(RELEASE_OPTIONS, 'Options');
    if (name === 'ramp' && index === 2) return fromOptions(RAMP_OPTIONS, 'Options');
    if (name === 'offset' && index === 2) return fromOptions(OFFSET_OPTIONS, 'Options');
    if ((name === 'call' && index === 2) || (name === 'bypass' && index === 1)) {
      return fromOptions(AT_OPTIONS, 'Options');
    }
  }
  if (kind === 'param') {
    if (name === 'ramp' && index === 1) return fromOptions(RAMP_OPTIONS, 'Options');
    if (name === 'offset' && index === 1) return fromOptions(OFFSET_OPTIONS, 'Options');
    if (['set', 'clearOffset', 'cancel', 'reset'].includes(name)) {
      return fromOptions(AT_OPTIONS, 'Options');
    }
  }
  if (kind === 'transport' || kind === 'unknown') {
    if (name === 'sequence' && index <= 1) return fromOptions(SEQUENCE_OPTIONS, 'Sequence options');
    if (name === 'every' && index === 2) return fromOptions(EVERY_OPTIONS, 'Options');
    if (kind === 'transport' && name === 'start') return fromOptions(START_OPTIONS, 'Options');
    if (kind === 'transport' && (name === 'stop' || name === 'pause')) {
      return fromOptions(AT_OPTIONS, 'Options');
    }
  }
  if (kind === 'sequence' && name === 'update' && index === 0) {
    return fromOptions(SEQUENCE_OPTIONS, 'Sequence options');
  }
  if (name === 'define' || name === 'register') {
    return index === 0 ? fromOptions(DEFINITION_OPTIONS, 'Definition', 'definition field') : [];
  }
  return [];
}

function keyCompletions(scene: Scene, context: CursorContext & { kind: 'key' }): Completion[] {
  const sections = new Map<string, number>();
  return keyOptions(scene, context.call)
    .filter((option) => !context.present.has(option.name))
    .map((option) => {
      if (!sections.has(option.section)) sections.set(option.section, sections.size + 1);
      return {
        label: option.name,
        type: 'property',
        detail: option.detail,
        info: info(option.doc),
        section: { name: option.section, rank: sections.get(option.section)! },
        apply: applyKey(option.name),
      };
    });
}

// --- Values ----------------------------------------------------------------------------------------

interface ValueItem {
  /** The value as text, without quotes. */
  readonly text: string;
  readonly detail?: string;
  readonly doc?: Doc;
  /** A word, not a string: `true`. */
  readonly bare?: boolean;
}

/** The quoted alternatives in an option's type: `"'open' | 'closed'"` gives `open`, `closed`. */
function quotedAlternatives(type: string): string[] {
  return [...type.matchAll(/'([^']*)'/g)].map((match) => match[1] ?? '');
}

function bufferItems(catalog: ResolvedCatalog): ValueItem[] {
  return catalog.buffers.map((entry) => {
    const doc = bufferDoc(entry);
    return {
      text: entry.key,
      detail: entry.slices ? `buffer · ${entry.slices} slices` : 'buffer',
      doc,
    };
  });
}

const durationItems = (): ValueItem[] => DURATIONS.map(([text, detail]) => ({ text, detail }));

/** The values the editor can offer for one key of a call's options object. */
function valueItems(scene: Scene, call: CallSite, key: string): ValueItem[] {
  const option = keyOptions(scene, call).find((candidate) => candidate.name === key);
  if (!option) return [];
  if (option.param) {
    if (option.param.kind === 'boolean') {
      return [
        { text: 'true', bare: true },
        { text: 'false', bare: true },
      ];
    }
    if (option.param.kind === 'choice') {
      return option.param.choices.map((choice) => ({ text: choice, detail: option.name }));
    }
    return [];
  }
  const type = option.option?.type ?? '';
  if (/BufferRef|AudioBuffer/.test(type) || key === 'buffer' || key === 'into') {
    return bufferItems(scene.catalog);
  }
  if (/duration|position/i.test(type)) return durationItems();
  if (type === 'boolean') {
    return [
      { text: 'true', bare: true },
      { text: 'false', bare: true },
    ];
  }
  if (key === 'class') return classNames(scene).map((text) => ({ text, detail: 'class' }));
  return quotedAlternatives(type).map((text) => ({ text, detail: option.name }));
}

const unique = (names: readonly string[]): string[] => [...new Set(names)];

const classNames = (scene: Scene): string[] =>
  unique([...scene.doc.classes.keys(), ...scene.catalog.classes]);

function busNames(scene: Scene, pos: number, forSending: boolean): ValueItem[] {
  const items: ValueItem[] = [{ text: 'main', detail: 'the engine output' }];
  for (const name of unique([...scene.doc.buses, ...scene.catalog.buses])) {
    if (name !== 'main') items.push({ text: name, detail: 'bus' });
  }
  // Inside a macro's definition, its two own buses.
  const inMacro = [...scene.doc.localTypes.values()].some(
    (local) => pos > local.from && pos < local.to,
  );
  if (inMacro) {
    items.push({ text: 'out', detail: "the macro's output" });
    if (!forSending) items.push({ text: 'in', detail: "the macro's input" });
  }
  return items;
}

function paramItems(scene: Scene, types: readonly string[] | null): ValueItem[] {
  return [...paramsOf(scene, types).values()].map(({ param, owners }) => ({
    text: param.name,
    detail: paramDetail(param),
    doc: paramDoc(param, owners.slice(0, 4).join(', ')),
  }));
}

const toCompletions = (items: readonly ValueItem[], quote: boolean): Completion[] =>
  items.map((item) => ({
    label: quote && !item.bare ? `'${item.text}'` : item.text,
    type: item.bare ? 'keyword' : 'constant',
    ...(item.detail ? { detail: item.detail } : {}),
    ...(item.doc ? { info: info(item.doc) } : {}),
  }));

// --- Inside a string --------------------------------------------------------------------------------

function selectorCompletions(scene: Scene, pos: number, before: string): CompletionResult {
  const token = /[#.]?[\w-]*$/.exec(before)?.[0] ?? '';
  const options: Completion[] = [];
  const ids = new Map<string, string>();
  for (const [id, owner] of scene.doc.ids) ids.set(id, owner.type);
  for (const id of scene.catalog.ids) if (!ids.has(id)) ids.set(id, 'id');
  for (const [id, type] of ids) {
    options.push({
      label: `#${id}`,
      type: 'constant',
      detail: type,
      section: { name: 'Ids', rank: 1 },
    });
  }
  for (const name of classNames(scene)) {
    const owners = scene.doc.classes.get(name);
    options.push({
      label: `.${name}`,
      type: 'constant',
      detail: owners ? [...owners].join(', ') : 'class',
      section: { name: 'Classes', rank: 2 },
    });
  }
  for (const type of allTypes(scene)) {
    options.push({
      label: type.type,
      type: 'class',
      detail: typeKind(type),
      info: info(typeDoc(type)),
      section: { name: 'Node types', rank: 3 },
    });
  }
  options.push({
    label: '*',
    type: 'keyword',
    detail: 'everything in the scope',
    section: { name: 'Node types', rank: 3 },
  });
  return { from: pos - token.length, options: inOrder(options), validFor: /^[#.]?[\w-]*$/ };
}

function stringItems(
  scene: Scene,
  pos: number,
  context: CursorContext & { kind: 'string' },
): ValueItem[] | 'selector' | null {
  const { call, key } = context;
  if (!call) return null;
  if (key !== null) return valueItems(scene, call, key);
  const { name, index, receiver } = call;
  if (receiver === null) return name === '__' && index === 0 ? 'selector' : null;
  const kind = receiver.kind;
  if (index === 0) {
    if (name === 'to' || name === 'bus') return busNames(scene, pos, name === 'to');
    if (name === 'select' || name === 'filter' || name === 'connect' || name === 'modulate') {
      return 'selector';
    }
    if (kind === 'transport' || kind === 'unknown') {
      if (name === 'sequence' || name === 'steps' || name === 'get' || name === 'clear') {
        return unique([...scene.doc.sequences, ...scene.catalog.sequences]).map((text) => ({
          text,
          detail: 'sequence',
        }));
      }
      if (['every', 'at', 'seconds', 'seek', 'toAudioTime'].includes(name)) return durationItems();
    }
    if (['param', 'params', 'ramp', 'offset'].includes(name)) {
      return paramItems(scene, kind === 'selection' ? receiver.types : null);
    }
  }
  if (index === 1 && name === 'modulate') {
    const target = call.args[0];
    const types =
      target?.name === 'String' ? selectorTypes(scene, stringValue(scene.state, target)) : null;
    return paramItems(scene, types);
  }
  return null;
}

// --- Names on their own -----------------------------------------------------------------------------

function nameCompletions(scene: Scene): Completion[] {
  const options: Completion[] = [
    {
      label: '__',
      type: 'namespace',
      detail: '(selector?)',
      info: info({ ...memberDoc(DUNDER_CALL, ''), kind: 'cracked-up' }),
      boost: 10,
    },
  ];
  for (const helper of scene.catalog.helperList) {
    if (scene.doc.definitions.has(helper.name)) continue;
    options.push({
      label: helper.name,
      type: 'function',
      detail: helper.signature.slice(helper.name.length),
      info: info(helperDoc(helper)),
      apply: applyCall(helper.name, true),
    });
    if (helper.alias && !scene.doc.definitions.has(helper.alias)) {
      options.push({
        label: helper.alias,
        type: 'function',
        detail: `same as ${helper.name}`,
        info: info(helperDoc(helper, helper.alias)),
        apply: applyCall(helper.alias, true),
        boost: -20,
      });
    }
  }
  for (const global of scene.catalog.globals.values()) {
    options.push({
      label: global.name,
      type: global.signature ? 'function' : 'variable',
      ...(global.signature ? { detail: global.signature.slice(global.name.length) } : {}),
      info: info(globalDoc(global)),
      ...(global.signature
        ? { apply: applyCall(global.name, takesArguments(global.signature)) }
        : {}),
    });
  }
  return options;
}

// --- The source -------------------------------------------------------------------------------------

/**
 * Keeps options in the order they were listed (parameters before options, ids as written) where
 * CodeMirror would otherwise sort equal matches by name. The nudge is far smaller than the
 * difference between a good and a poor match, so typing still ranks by match first.
 */
function inOrder(options: Completion[]): Completion[] {
  return options.map((option, index) =>
    option.boost === undefined && option.type !== 'class'
      ? { ...option, boost: -index / 1000 }
      : option,
  );
}

const WORD = /^[\w$]*$/;

/**
 * The completions at a position, or null when there are none to offer. `explicit` is whether the
 * user asked (Ctrl-Space) rather than typed.
 */
export function completionsAt(
  state: EditorState,
  pos: number,
  catalog: ResolvedCatalog,
  explicit = false,
): CompletionResult | null {
  const scene = sceneOf(state, catalog);
  const context = contextAt(scene, pos);
  if (!context) return null;
  const result = (from: number, options: Completion[] | null): CompletionResult | null =>
    options && options.length > 0 ? { from, options: inOrder(options), validFor: WORD } : null;

  switch (context.kind) {
    case 'member':
      return result(context.from, memberCompletions(scene, context.receiver));
    case 'key':
      return result(context.from, keyCompletions(scene, context));
    case 'value': {
      const items = valueItems(scene, context.call, context.key);
      if (items.length === 0) {
        return explicit || context.from < pos ? nameResult(scene, context.from) : null;
      }
      return {
        from: context.from,
        options: inOrder(toCompletions(items, true)),
        validFor: /^['\w$-]*$/,
      };
    }
    case 'string': {
      const items = stringItems(scene, pos, context);
      if (items === null) return null;
      if (items === 'selector') return selectorCompletions(scene, pos, context.before);
      if (items.length === 0) return null;
      return {
        from: context.from,
        options: inOrder(toCompletions(items, false)),
        validFor: /^[^'"`\n]*$/,
      };
    }
    case 'name':
      // Unasked, only once something has been typed.
      if (!explicit && context.from === pos) return null;
      return nameResult(scene, context.from);
  }
}

function nameResult(scene: Scene, from: number): CompletionResult {
  return { from, options: nameCompletions(scene), validFor: WORD };
}

/** A CodeMirror completion source that reads the catalog current at the time of each request. */
export function completionSource(
  catalog: (state: EditorState) => ResolvedCatalog,
): CompletionSource {
  return (context: CompletionContext) => {
    try {
      return completionsAt(context.state, context.pos, catalog(context.state), context.explicit);
    } catch {
      // Help must never get in the way of typing.
      return null;
    }
  };
}
