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
import {
  allTypes,
  canInsert,
  contextAt,
  hostCall,
  makesNode,
  referredArgument,
  sceneOf,
  selectorTypes,
  stringValue,
  targetOf,
  typeInfo,
} from './analysis';
import type { CallSite, CursorContext, Receiver, Scene } from './analysis';
import {
  API,
  apiMember,
  AT_OPTIONS,
  COMMON_INIT,
  DEFINITION_OPTIONS,
  DUNDER_CALL,
  DURATIONS,
  EVERY_OPTIONS,
  KEY_PRESS_OPTIONS,
  MIDI_BIND_OPTIONS,
  MIDI_EVENT_TYPES,
  MIDI_FILTER_OPTIONS,
  MIDI_FOLLOW_OPTIONS,
  MIDI_NOTE_OPTIONS,
  MIDI_SEND_OPTIONS,
  OFFSET_OPTIONS,
  RAMP_OPTIONS,
  SET_OPTIONS,
  RELEASE_OPTIONS,
  SEQUENCE_OPTIONS,
  START_OPTIONS,
  TRIGGER_COMMON,
} from './api-docs';
import type { ApiOption, ReceiverKind } from './api-docs';
import type { ArgumentKind, OptionKeyInfo, ResolvedCatalog, ValueInfo } from './catalog';
import {
  bufferDoc,
  functionDoc,
  globalDoc,
  hostMemberDoc,
  hostOptionInfo,
  idDoc,
  namedDoc,
  insertDoc,
  helperDoc,
  memberDoc,
  optionDetail,
  optionDoc,
  paramDetail,
  paramDoc,
  renderDoc,
  setterDoc,
  signatureText,
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
  inserts: 'bus inserts',
  sequence: 'sequence',
  param: 'parameter',
  event: 'event',
  position: 'position',
  midi: 'midi',
  midiOut: 'MIDI output',
  follow: 'clock follow',
  binding: 'binding',
  midiEvent: 'MIDI message',
  keyInfo: 'key',
  mouseInfo: 'pointer',
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

function typeOptions(scene: Scene, on: 'chain' | 'bus' | 'inserts' = 'chain'): Completion[] {
  const types =
    on === 'chain' ? allTypes(scene) : allTypes(scene).filter((type) => canInsert(type, on));
  return types.map((type) => ({
    label: type.type,
    type: 'class',
    detail: type.shorthand ? `${typeKind(type)} · ${type.shorthand}` : typeKind(type),
    info: info(on === 'chain' ? typeDoc(type) : insertDoc(type)),
    section: { name: on === 'chain' ? 'Node types' : 'Add as an insert', rank: 2 },
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
    case 'host': {
      const owner = receiver.host;
      if (!owner) return null;
      return (owner.members ?? [])
        .filter((member) => member && typeof member.name === 'string')
        .map((member) => ({
          label: member.name,
          type: member.signature ? 'method' : 'property',
          detail: member.signature ? member.signature.slice(member.name.length) : '',
          info: info(hostMemberDoc(member, owner)),
          section: { name: owner.name ?? 'Members', rank: 1 },
          ...(member.signature
            ? { apply: applyCall(member.name, takesArguments(member.signature)) }
            : {}),
        }));
    }
    case 'chain':
      return [...memberOptions('chain', { name: 'Chain', rank: 1 }), ...typeOptions(scene)];
    case 'bus':
      return [...memberOptions('bus', { name: 'Bus', rank: 1 }), ...typeOptions(scene, 'bus')];
    case 'inserts':
      return [
        ...memberOptions('inserts', { name: 'Bus', rank: 1 }),
        ...typeOptions(scene, 'inserts'),
      ];
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
  /** A key of a host function's options, as the host described it. */
  readonly host?: OptionKeyInfo;
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
    const host = hostCall(scene, call);
    if (host) {
      const argument = host.signature.args[index];
      if (argument?.kind !== 'options') return [];
      return (argument.options ?? [])
        .filter((option) => option && typeof option.name === 'string')
        .map((option) => {
          const shown = hostOptionInfo(option);
          return {
            name: option.name,
            detail: optionDetail(shown),
            doc: optionDoc(option.name, shown, `option of ${name}`),
            section: 'Options',
            host: option,
          };
        });
    }
    if (['keyPress', 'key_press'].includes(name) && index === 1) {
      return fromOptions(KEY_PRESS_OPTIONS, 'Options');
    }
    return name === 'define' || name === 'defineMacro' || name === 'defineNode'
      ? index === 0
        ? fromOptions(DEFINITION_OPTIONS, 'Definition', 'definition field')
        : []
      : [];
  }
  const kind = receiver.kind;
  if (kind === 'midi') {
    if ((name === 'on' && index === 2) || ((name === 'play' || name === 'learn') && index === 1)) {
      return fromOptions(MIDI_FILTER_OPTIONS, 'Which messages');
    }
    if (name === 'bind' && index === 0) return fromOptions(MIDI_BIND_OPTIONS, 'Controller');
    if (name === 'follow' && index === 1) return fromOptions(MIDI_FOLLOW_OPTIONS, 'Options');
    return [];
  }
  if (kind === 'midiOut') {
    if (name === 'note' && index === 1) return fromOptions(MIDI_NOTE_OPTIONS, 'Options');
    if ((name === 'noteOn' || name === 'cc') && index === 2) {
      return fromOptions(MIDI_SEND_OPTIONS, 'Options');
    }
    if (['noteOff', 'pitchBend', 'program'].includes(name) && index === 1) {
      return fromOptions(MIDI_SEND_OPTIONS, 'Options');
    }
    if (name === 'send' && index === 1) return fromOptions(AT_OPTIONS, 'Options');
    return [];
  }
  const type = typeInfo(scene, name);
  if (type && index === 0 && (kind === 'unknown' || makesNode(scene, receiver, name))) {
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
    if (name === 'set' && index === 1) return fromOptions(SET_OPTIONS, 'Options');
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
    if (name === 'set' && index === 1) return fromOptions(SET_OPTIONS, 'Options');
    if (name === 'reset' && index === 0) return fromOptions(SET_OPTIONS, 'Options');
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

const BOOLEANS: readonly ValueItem[] = [
  { text: 'true', bare: true },
  { text: 'false', bare: true },
];

/** What is offered for a value of a kind a host named, in a call of one of its functions. */
function kindItems(
  scene: Scene,
  pos: number,
  call: CallSite,
  kind: ArgumentKind | 'boolean',
  of: string | undefined,
): ValueItem[] | 'selector' | null {
  switch (kind) {
    case 'selector':
      return 'selector';
    case 'param': {
      const host = hostCall(scene, call);
      const target = targetOf(scene, host ? referredArgument(host, call, of) : undefined);
      if (target.kind === 'nodes') return paramItems(scene, target.types);
      // A bus has one parameter: its level.
      const gain = apiMember('bus', 'gain');
      return [
        {
          text: 'gain',
          detail: 'the level of the bus',
          ...(gain ? { doc: memberDoc(gain, 'bus') } : {}),
        },
      ];
    }
    case 'sequence':
      return sequenceItems(scene);
    case 'bus':
      return busNames(scene, pos, false);
    case 'buffer':
      return bufferItems(scene.catalog);
    case 'boolean':
      return [...BOOLEANS];
    default:
      return null;
  }
}

/** What is offered for the value of one key of a host function's options. */
function hostOptionItems(
  scene: Scene,
  pos: number,
  call: CallSite,
  option: OptionKeyInfo,
): ValueItem[] | 'selector' | null {
  if (Array.isArray(option.values) && option.values.length > 0) {
    return option.values
      .filter((value) => ['string', 'number', 'boolean'].includes(typeof value))
      .map((value) => ({
        text: String(value),
        detail: option.name,
        ...(typeof value === 'string' ? {} : { bare: true }),
      }));
  }
  return option.kind ? kindItems(scene, pos, call, option.kind, option.of) : null;
}

/** The values the editor can offer for one key of a call's options object. */
function valueItems(
  scene: Scene,
  call: CallSite,
  key: string,
  pos: number,
): ValueItem[] | 'selector' {
  const option = keyOptions(scene, call).find((candidate) => candidate.name === key);
  if (!option) return [];
  if (option.host) return hostOptionItems(scene, pos, call, option.host) ?? [];
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
  if (call.receiver?.kind === 'midi' && key === 'input') return portItems(scene, 'input');
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

/** The MIDI ports the host knows of, for where one is named. */
const portItems = (scene: Scene, direction: 'input' | 'output'): ValueItem[] =>
  (direction === 'input' ? scene.catalog.midiInputs : scene.catalog.midiOutputs).map((text) => ({
    text,
    detail: `MIDI ${direction}`,
  }));

const classNames = (scene: Scene): string[] =>
  unique([...scene.doc.classes.keys(), ...scene.catalog.classes]);

/** A name with what the host said it is for, when it said. */
const described = (text: string, detail: string, doc: Doc | null): ValueItem => ({
  text,
  detail,
  ...(doc ? { doc } : {}),
});

const sequenceItems = (scene: Scene): ValueItem[] =>
  unique([...scene.doc.sequences, ...scene.catalog.sequences]).map((text) =>
    described(text, 'sequence', namedDoc(scene.catalog.sequenceInfo.get(text), 'sequence')),
  );

function busNames(scene: Scene, pos: number, forSending: boolean): ValueItem[] {
  const main = namedDoc(scene.catalog.busInfo.get('main'), 'bus');
  const items: ValueItem[] = [described('main', 'the engine output', main)];
  for (const name of unique([...scene.doc.buses, ...scene.catalog.buses])) {
    if (name !== 'main') {
      items.push(described(name, 'bus', namedDoc(scene.catalog.busInfo.get(name), 'bus')));
    }
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
  const ids = new Map<string, string | undefined>();
  for (const [id, owner] of scene.doc.ids) ids.set(id, owner.type);
  for (const id of scene.catalog.ids) {
    if (!ids.has(id)) ids.set(id, scene.catalog.idInfo.get(id)?.type);
  }
  for (const [id, type] of ids) {
    const entry = scene.catalog.idInfo.get(id);
    const doc = entry?.description ? idDoc(id, type, entry) : null;
    options.push({
      label: `#${id}`,
      type: 'constant',
      detail: typeof type === 'string' ? type : 'id',
      ...(doc ? { info: info(doc) } : {}),
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

/** What a string is, by where it is written: the values to offer, or that it is a selector. */
export function stringItems(
  scene: Scene,
  pos: number,
  context: Pick<CursorContext & { kind: 'string' }, 'call' | 'key' | 'list'>,
): ValueItem[] | 'selector' | null {
  const { call, key } = context;
  if (!call) return null;
  if (key !== null) return valueItems(scene, call, key, pos);
  const { name, index, receiver } = call;
  const host = hostCall(scene, call);
  if (host) {
    // An item of a list argument is what the list's `items` says; any other string is the argument.
    let value: ValueInfo | undefined = host.signature.args[index];
    if (context.list) value = value?.kind === 'list' ? value.items : undefined;
    return value ? kindItems(scene, pos, call, value.kind, value.of) : null;
  }
  // Only the host's functions say what the items of a list are.
  if (context.list) return null;
  if (receiver === null) return name === '__' && index === 0 ? 'selector' : null;
  const kind = receiver.kind;
  if (kind === 'midi') {
    if (index !== 0) return null;
    if (name === 'on') return MIDI_EVENT_TYPES.map(([text, detail]) => ({ text, detail }));
    if (name === 'follow') return portItems(scene, 'input');
    if (name === 'output' || name === 'sendClock') return portItems(scene, 'output');
    return null;
  }
  if (index === 0) {
    if (name === 'to' || name === 'bus') return busNames(scene, pos, name === 'to');
    if (name === 'select' || name === 'filter' || name === 'connect' || name === 'modulate') {
      return 'selector';
    }
    if (kind === 'transport' || kind === 'unknown') {
      if (name === 'sequence' || name === 'steps' || name === 'get' || name === 'clear') {
        return sequenceItems(scene);
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
  for (const fn of scene.catalog.functions.values()) {
    if (scene.doc.definitions.has(fn.name)) continue;
    const signature = signatureText(fn.name, fn.signatures[0]!);
    options.push({
      label: fn.name,
      type: 'function',
      detail: signature.slice(fn.name.length),
      info: info(functionDoc(fn)),
      apply: applyCall(
        fn.name,
        fn.signatures.some((candidate) => candidate.args.length > 0),
      ),
    });
  }
  for (const global of scene.catalog.globals.values()) {
    if (scene.catalog.functions.has(global.name)) continue;
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
      const items = valueItems(scene, context.call, context.key, pos);
      if (items === 'selector' || items.length === 0) {
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
      // A word that is not a string (`true`) is not offered inside quotes.
      const strings = items.filter((item) => !item.bare || context.key === null);
      if (strings.length === 0) return null;
      return {
        from: context.from,
        options: inOrder(toCompletions(strings, false)),
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
