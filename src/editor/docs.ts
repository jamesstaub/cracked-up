/**
 * Documentation as the editor shows it, in completion details, hover tooltips and signature help:
 * one small model (`Doc`), what fills it from the catalog, and what turns it into DOM. Only text
 * nodes are made, so nothing from a catalog is ever read as HTML.
 */

import type { NodeTypeInfo, OptionInfo, ParamMeta } from '../api';
import type { ApiMember, ApiOption } from './api-docs';
import type {
  BufferEntry,
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

export interface DocRow {
  readonly name: string;
  readonly detail: string;
  readonly description: string;
}

export interface Doc {
  /** The first line, in code type: a signature or a name. */
  readonly signature: string;
  /** A word for what it is: `filter`, `helper`, `parameter`. */
  readonly kind: string;
  readonly description?: string;
  /** Parameters or options, one per row. */
  readonly rows?: readonly DocRow[];
  /** A last line, such as an example. */
  readonly note?: string;
  /** The name in `signature` to mark as the argument being typed. */
  readonly active?: string;
}

export function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(4)));
}

/** A parameter's default and range on one line: `350 hz · 20 to 20000`. */
export function paramDetail(param: ParamMeta): string {
  if (param.kind === 'number') {
    const unit = param.unit === 'none' ? '' : ` ${param.unit}`;
    return `${formatNumber(param.default)}${unit} · ${formatNumber(param.min)} to ${formatNumber(param.max)}`;
  }
  if (param.kind === 'boolean') return `${param.default} · true or false`;
  const choices = param.choices.map((choice) => `'${choice}'`).join(' | ');
  return choices ? `'${param.default}' · ${choices}` : `'${param.default}'`;
}

export function optionDetail(option: OptionInfo | ApiOption): string {
  return option.default === undefined ? option.type : `${option.type} · default ${option.default}`;
}

const paramRow = (param: ParamMeta): DocRow => ({
  name: param.name,
  detail: paramDetail(param),
  description: param.description ?? '',
});

const optionRows = (options: Readonly<Record<string, OptionInfo>>): DocRow[] =>
  Object.entries(options).map(([name, option]) => ({
    name,
    detail: optionDetail(option),
    description: option.description,
  }));

/** How a node type is called: `lowpass({ frequency, q })`. */
export function typeSignature(info: NodeTypeInfo): string {
  const names = [...info.params.map((param) => param.name), ...Object.keys(info.options)];
  const object = names.length > 0 ? `{ ${names.join(', ')} }` : '';
  return info.shorthand && object
    ? `${info.type}(${info.shorthand} | ${object})`
    : `${info.type}(${object})`;
}

export function typeKind(info: NodeTypeInfo): string {
  return info.isMacro ? `${info.category} macro` : info.category;
}

export function typeDoc(info: NodeTypeInfo): Doc {
  const notes: string[] = [];
  if (info.shorthand) {
    const param = info.params.find((candidate) => candidate.name === info.shorthand);
    const value = param ? String(param.default) : '...';
    notes.push(`A bare value sets ${info.shorthand}: ${info.type}(${value}).`);
  }
  if (info.triggerable) notes.push('Can be triggered.');
  if (info.modulates) notes.push(`In a chain it modulates the next node's ${info.modulates}.`);
  return {
    signature: typeSignature(info),
    kind: typeKind(info),
    description: info.description,
    rows: [...info.params.map(paramRow), ...optionRows(info.options)],
    ...(notes.length > 0 ? { note: notes.join(' ') } : {}),
  };
}

/** A node type as it is described where calling it adds an insert to a bus. */
export function insertDoc(info: NodeTypeInfo): Doc {
  const doc = typeDoc({ ...info, modulates: null });
  const note =
    'On a bus this adds it as an insert: in series inside the bus, after the inserts already there.';
  return { ...doc, note: doc.note ? `${note} ${doc.note}` : note };
}

export function paramDoc(param: ParamMeta, owner?: string): Doc {
  return {
    signature: `${param.name}: ${paramDetail(param)}`,
    kind: owner ? `parameter of ${owner}` : 'parameter',
    ...(param.description ? { description: param.description } : {}),
  };
}

export function setterDoc(param: ParamMeta, owners: readonly string[]): Doc {
  const shown = owners.slice(0, 6).join(', ') + (owners.length > 6 ? ', ...' : '');
  return {
    signature: `${param.name}(value, options?)`,
    kind: 'parameter setter',
    description:
      `Sets ${param.name} on every selected node that has it. ${param.description ?? ''}`.trim(),
    note: `${paramDetail(param)}${shown ? `. On ${shown}.` : ''}`,
  };
}

export function optionDoc(name: string, option: OptionInfo | ApiOption, kind = 'option'): Doc {
  return {
    signature: `${name}: ${optionDetail(option)}`,
    kind,
    description: option.description,
  };
}

export function helperDoc(helper: HelperInfo, calledAs = helper.name): Doc {
  const notes: string[] = [];
  if (helper.example && helper.result) notes.push(`${helper.example} gives ${helper.result}`);
  if (helper.alias) {
    notes.push(
      calledAs === helper.alias ? `The same as ${helper.name}.` : `Also as ${helper.alias}.`,
    );
  }
  return {
    signature: helper.signature,
    kind: helper.group ? `helper · ${helper.group}` : 'helper',
    description: helper.description,
    ...(notes.length > 0 ? { note: notes.join(' ') } : {}),
  };
}

export function memberDoc(member: ApiMember, owner: string): Doc {
  return {
    signature: member.signature ?? member.name,
    kind: member.signature ? `${owner} method` : `${owner} property`,
    description: member.description,
  };
}

export function globalDoc(info: GlobalInfo): Doc {
  return { signature: info.signature ?? info.name, kind: 'global', description: info.description };
}

export function bufferDoc(entry: BufferEntry): Doc {
  const facts: string[] = [];
  if (typeof entry.duration === 'number') facts.push(`${formatNumber(entry.duration)} seconds`);
  if (entry.slices) facts.push(`${entry.slices} slices`);
  const description = [entry.description, facts.join(', ')].filter(Boolean).join(' ');
  return {
    signature: `'${entry.key}'`,
    kind: 'buffer',
    ...(description ? { description } : {}),
  };
}

// --- The host's own functions ------------------------------------------------------------------------

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** One way of calling a host function, on a line: `slider(target, param, options?)`. */
export function signatureText(name: string, signature: FunctionSignature): string {
  const args = signature.args.map(
    (argument) => `${text(argument.name)}${argument.optional ? '?' : ''}`,
  );
  return `${name}(${args.join(', ')})`;
}

/** A word or two for what a value is, as shown beside an argument. */
export function valueDetail(value: ValueInfo): string {
  switch (value.kind) {
    case 'selector':
      return 'selector or nodes';
    case 'param':
      return value.of ? `parameter of ${text(value.of)}` : 'parameter name';
    case 'sequence':
      return 'sequence name';
    case 'bus':
      return 'bus name';
    case 'buffer':
      return 'buffer name';
    case 'name':
      return 'string';
    case 'options':
      return (value.options ?? []).length > 0
        ? `{ ${(value.options ?? []).map((option) => text(option.name)).join(', ')} }`
        : 'object';
    case 'list':
      return value.items ? `list: ${valueDetail(value.items)}` : 'list';
    default:
      return '';
  }
}

const quoted = (value: string | number | boolean): string =>
  typeof value === 'string' ? `'${value}'` : String(value);

/** The type and default of an option of a host function, as an option of the library's is shown. */
export function hostOptionInfo(option: OptionKeyInfo): ApiOption {
  const type =
    text(option.type) ||
    (option.values && option.values.length > 0
      ? option.values.map(quoted).join(' | ')
      : option.kind === 'boolean'
        ? 'boolean'
        : option.kind
          ? valueDetail({ kind: option.kind, ...(option.of ? { of: option.of } : {}) })
          : 'value');
  return {
    name: text(option.name),
    type,
    ...(typeof option.default === 'string' ? { default: option.default } : {}),
    description: text(option.description),
  };
}

/** A host function: every way of calling it, and every argument once. */
export function functionDoc(info: FunctionInfo): Doc {
  const rows = new Map<string, DocRow>();
  for (const signature of info.signatures) {
    for (const argument of signature.args) {
      if (rows.has(argument.name)) continue;
      rows.set(argument.name, {
        name: text(argument.name),
        detail: valueDetail(argument),
        description: text(argument.description),
      });
    }
  }
  const returns = info.signatures.map((signature) => signature.returns).find(Boolean);
  const note = returns ? returnNote(returns) : '';
  return {
    signature: info.signatures.map((signature) => signatureText(info.name, signature)).join('\n'),
    kind: 'function',
    description: text(info.description),
    rows: [...rows.values()],
    ...(note ? { note } : {}),
  };
}

function returnNote(returns: ReturnInfo): string {
  const members = (returns.members ?? []).map(
    (member) => `.${text(member.signature) || member.name}`,
  );
  const what = text(returns.description) || (returns.name ? `Returns the ${returns.name}.` : '');
  return [what, members.length > 0 ? `It has ${members.join(', ')}.` : '']
    .filter(Boolean)
    .join(' ');
}

/** One way of calling a host function with one argument marked, for inside its brackets. */
export function callDoc(info: FunctionInfo, signature: FunctionSignature, index: number): Doc {
  const argument = signature.args[index];
  const described = argument?.description
    ? `${argument.name}: ${argument.description}`
    : text(signature.description) || text(info.description);
  const count = info.signatures.length;
  return {
    signature: signatureText(info.name, signature),
    kind:
      count > 1 ? `function · ${info.signatures.indexOf(signature) + 1} of ${count}` : 'function',
    ...(described ? { description: described } : {}),
    ...(argument ? { active: text(argument.name) } : {}),
  };
}

export function hostMemberDoc(member: MemberInfo, owner: ReturnInfo): Doc {
  const name = text(owner.name) || 'value';
  return {
    signature: text(member.signature) || text(member.name),
    kind: member.signature ? `${name} method` : `${name} property`,
    description: text(member.description),
  };
}

/** A bus or sequence the host described. null when there is nothing to say. */
export function namedDoc(entry: NamedEntry | undefined, kind: string): Doc | null {
  if (!entry || !text(entry.description)) return null;
  return { signature: `'${entry.name}'`, kind, description: text(entry.description) };
}

/** An id, with the type of its node when known. null when there is nothing to say. */
export function idDoc(name: string, type: string | undefined, entry?: IdEntry): Doc | null {
  const description = text(entry?.description);
  if (!type && !description) return null;
  return {
    signature: `#${name}`,
    kind: type ? `id of a ${type}` : 'id',
    ...(description ? { description } : {}),
  };
}

// --- DOM ------------------------------------------------------------------------------------------

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  content?: string | readonly (Node | string)[],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (typeof content === 'string') node.textContent = content;
  else if (content) node.append(...content);
  return node;
}

/** The signature line, with the active argument marked. */
function signatureLine(doc: Doc): HTMLElement {
  const line = el('code', 'cu-doc-signature');
  const active = doc.active;
  const index = active
    ? doc.signature.search(
        new RegExp(`(?<![\\w$])${active.replace(/[$.*+?()[\]{}|\\^]/g, '\\$&')}(?![\\w$])`),
      )
    : -1;
  if (!active || index < 0) {
    line.textContent = doc.signature;
    return line;
  }
  line.append(
    doc.signature.slice(0, index),
    el('span', 'cu-doc-active', active),
    doc.signature.slice(index + active.length),
  );
  return line;
}

export function rowsTable(rows: readonly DocRow[], className = 'cu-doc-rows'): HTMLElement {
  const table = el('table', className);
  for (const row of rows) {
    table.append(
      el('tr', undefined, [
        el('td', 'cu-doc-name', row.name),
        el('td', 'cu-doc-detail', row.detail),
        el('td', 'cu-doc-text', row.description),
      ]),
    );
  }
  return table;
}

/** A doc as DOM, for a tooltip. `brief` leaves out the rows. */
export function renderDoc(doc: Doc, options: { brief?: boolean } = {}): HTMLElement {
  const root = el('div', 'cu-doc');
  root.append(el('div', 'cu-doc-head', [signatureLine(doc), el('span', 'cu-doc-kind', doc.kind)]));
  if (doc.description) root.append(el('p', 'cu-doc-description', doc.description));
  if (!options.brief && doc.rows && doc.rows.length > 0) root.append(rowsTable(doc.rows));
  if (doc.note) root.append(el('p', 'cu-doc-note', doc.note));
  return root;
}
