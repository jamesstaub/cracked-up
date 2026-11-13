/**
 * Documentation as the editor shows it, in completion details, hover tooltips and signature help:
 * one small model (`Doc`), what fills it from the catalog, and what turns it into DOM. Only text
 * nodes are made, so nothing from a catalog is ever read as HTML.
 */

import type { NodeTypeInfo, OptionInfo, ParamMeta } from '../api';
import type { ApiMember, ApiOption } from './api-docs';
import type { BufferEntry, GlobalInfo, HelperInfo } from './catalog';

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
