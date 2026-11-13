/**
 * Docs page script. Builds the node reference from the engine's registry, so the reference is the
 * node definitions themselves, and adds a "Try it" link to every example.
 */

import { version } from '../package.json';
import { createEngine } from '../src';
import type { NodeTypeInfo, OptionInfo, ParamMeta } from '../src';
import { API } from '../src/editor/api-docs';
import { INTERACTION_DOCS } from '../src/util';
import { exampleFor } from './examples';
import { HELPER_GROUPS } from './helpers';
import { highlightBlocks } from './highlight';
import {
  MIDI_EVENT_MEMBERS,
  MIDI_FOLLOW_MEMBERS,
  MIDI_FUNCTIONS,
  MIDI_MEMBERS,
  MIDI_OUT_MEMBERS,
} from './midi-reference';
import type { MemberDoc } from './midi-reference';

const CATEGORY_TITLES: Record<string, string> = {
  source: 'Sources',
  filter: 'Filters',
  dynamics: 'Dynamics',
  delay: 'Delays',
  distortion: 'Distortion',
  modulator: 'Modulators',
  envelope: 'Envelopes',
  utility: 'Utilities',
  io: 'Input and output',
  synth: 'Synths',
};

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  content?: string | readonly (Node | string)[],
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (typeof content === 'string') node.textContent = content;
  else if (content) node.append(...content);
  if (className) node.className = className;
  return node;
}

const code = (text: string) => element('code', text);

function table(
  headings: readonly string[],
  rows: readonly (readonly (Node | string)[])[],
): HTMLElement {
  const head = element('thead', [
    element(
      'tr',
      headings.map((heading) => element('th', heading)),
    ),
  ]);
  const body = element(
    'tbody',
    rows.map((cells) =>
      element(
        'tr',
        cells.map((cell) => element('td', typeof cell === 'string' ? cell : [cell])),
      ),
    ),
  );
  return element('div', [element('table', [head, body])], 'table-wrap');
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(4)));
}

function paramRow(param: ParamMeta): (Node | string)[] {
  if (param.kind === 'number') {
    const unit = param.unit === 'none' ? '' : ` ${param.unit}`;
    return [
      code(param.name),
      `${formatNumber(param.default)}${unit}`,
      `${formatNumber(param.min)} to ${formatNumber(param.max)}`,
      param.curve,
      param.description ?? '',
    ];
  }
  if (param.kind === 'boolean') {
    return [code(param.name), String(param.default), 'true or false', '', param.description ?? ''];
  }
  return [code(param.name), param.default, param.choices.join(', '), '', param.description ?? ''];
}

function optionRows(options: Readonly<Record<string, OptionInfo>>): (Node | string)[][] {
  return Object.entries(options).map(([name, info]) => [
    code(name),
    info.type,
    info.default ?? '',
    info.description,
  ]);
}

function referenceFor(info: NodeTypeInfo): HTMLElement[] {
  const heading = element('h3', [code(info.type)]);
  heading.id = `node-${info.type}`;
  if (info.triggerable) heading.append(element('span', 'can be triggered', 'badge'));
  if (info.isMacro) heading.append(element('span', 'macro', 'badge'));

  const parts: HTMLElement[] = [heading, element('p', info.description)];
  if (info.shorthand) {
    parts.push(
      element('p', [
        'A bare value sets ',
        code(info.shorthand),
        ': ',
        code(`${info.type}(${info.params.find((p) => p.name === info.shorthand)?.default})`),
        '.',
      ]),
    );
  }
  parts.push(element('pre', [code(exampleFor(info))]));
  if (info.params.length > 0) {
    parts.push(
      table(
        ['Parameter', 'Default', 'Control range', 'Curve', 'What it does'],
        info.params.map(paramRow),
      ),
    );
  }
  const options = optionRows(info.options);
  if (options.length > 0) {
    parts.push(element('p', 'Options, set once when the node is made:'));
    parts.push(table(['Option', 'Accepts', 'Default', 'What it does'], options));
  }
  const triggerOptions = optionRows(info.triggerOptions);
  if (triggerOptions.length > 0) {
    parts.push(
      element('p', [
        'Options for ',
        code('trigger()'),
        ', besides ',
        code('at'),
        ' and any parameter value to use for that one trigger:',
      ]),
    );
    parts.push(table(['Option', 'Accepts', 'Default', 'What it does'], triggerOptions));
  }
  return parts;
}

function buildReference(types: readonly NodeTypeInfo[]): void {
  const body = document.querySelector<HTMLDivElement>('#reference-body')!;
  const categories = [...new Set(types.map((info) => info.category))];
  for (const category of categories) {
    for (const info of types.filter((candidate) => candidate.category === category)) {
      body.append(...referenceFor(info));
    }
  }
}

/** The helper reference: one table per group, from the same list the demos use. */
function buildHelpers(): void {
  const body = document.querySelector<HTMLDivElement>('#helpers-body')!;
  for (const group of HELPER_GROUPS) {
    body.append(
      element('h4', group.title),
      table(
        ['Helper', 'What it does', 'Example'],
        group.helpers.map((doc) => [
          anchored(
            `helper-${doc.name}`,
            doc.alias
              ? [code(doc.signature), element('div', ['or ', code(doc.alias)], 'alias')]
              : [code(doc.signature)],
          ),
          doc.description,
          element('div', [
            ...(doc.setup ? [code(doc.setup), element('br')] : []),
            code(doc.example),
            element('div', ['gives ', code(doc.result)], 'gives'),
          ]),
        ]),
      ),
    );
  }
}

/** Content with an id the contents list can link to. */
function anchored(id: string, content: readonly (Node | string)[]): HTMLElement {
  const node = element('div', content, 'anchor');
  node.id = id;
  return node;
}

/** One group of members in a reference: a heading, how each is written, and where each is linked from. */
interface MemberSection {
  title: string;
  /** What goes before a member's name where it is written: `__.transport.`, `midi.`. */
  prefix: string;
  /** The same, short, for the contents list. */
  short: string;
  /** Start of each member's id. */
  id: string;
  members: readonly MemberDoc[];
}

const SEQUENCING: readonly MemberSection[] = [
  {
    title: 'The transport',
    prefix: '__.transport.',
    short: 'transport.',
    id: 'transport',
    members: API.transport,
  },
  {
    title: 'A sequence, as sequence() returns it',
    prefix: 'sequence.',
    short: 'sequence.',
    id: 'sequence',
    members: API.sequence,
  },
  {
    title: 'The event a callback is given',
    prefix: 'ev.',
    short: 'ev.',
    id: 'event',
    members: API.event,
  },
];

const INTERACTION: readonly MemberSection[] = [
  {
    title: 'Every interaction helper',
    prefix: '',
    short: '',
    id: 'helper',
    members: INTERACTION_DOCS.map((doc) => ({
      name: doc.name,
      signature: doc.alias ? `${doc.signature}\nor ${doc.alias}` : doc.signature,
      description: doc.description,
    })),
  },
];

const MIDI: readonly MemberSection[] = [
  {
    title: 'Functions of cracked-up/midi',
    prefix: '',
    short: '',
    id: 'midi-fn',
    members: MIDI_FUNCTIONS,
  },
  { title: 'The midi object', prefix: 'midi.', short: 'midi.', id: 'midi', members: MIDI_MEMBERS },
  {
    title: 'An output, from midi.output()',
    prefix: 'out.',
    short: 'out.',
    id: 'midi-out',
    members: MIDI_OUT_MEMBERS,
  },
  {
    title: 'What midi.follow() gives',
    prefix: 'follow.',
    short: 'follow.',
    id: 'midi-follow',
    members: MIDI_FOLLOW_MEMBERS,
  },
  {
    title: 'The message a midi.on listener is given',
    prefix: 'message.',
    short: 'message.',
    id: 'midi-message',
    members: MIDI_EVENT_MEMBERS,
  },
];

/** A reference of members: one table per section, each row with an id. */
function buildMembers(containerId: string, sections: readonly MemberSection[]): void {
  const body = document.querySelector<HTMLDivElement>(`#${containerId}`)!;
  for (const section of sections) {
    body.append(
      element('h4', section.title),
      table(
        ['Name', 'What it does'],
        section.members.map((member) => {
          const [first = member.name, ...rest] = (member.signature ?? member.name).split('\n');
          return [
            anchored(`${section.id}-${member.name}`, [
              code(`${section.prefix}${first}`),
              ...rest.map((line) => element('div', line, 'alias')),
            ]),
            member.description,
          ];
        }),
      ),
    );
  }
}

/** Adds a group to the contents list with one link per member of each section. */
function listMembers(toc: HTMLElement, title: string, sections: readonly MemberSection[]): void {
  toc.append(element('div', title, 'group'));
  for (const section of sections) {
    for (const member of section.members) {
      const link = element('a', `${section.short}${member.name}`, 'sub');
      link.href = `#${section.id}-${member.name}`;
      toc.append(link);
    }
  }
}

function buildContents(types: readonly NodeTypeInfo[]): void {
  const toc = document.querySelector<HTMLElement>('#toc')!;
  toc.append(element('div', 'Guide', 'group'));
  for (const heading of document.querySelectorAll<HTMLHeadingElement>('article > h2')) {
    if (heading.id === 'reference') continue;
    const link = element('a', heading.textContent ?? '');
    link.href = `#${heading.id}`;
    toc.append(link);
  }
  // After the guide: every method of each area by name, then every node type.
  listMembers(toc, 'Sequencing', SEQUENCING);
  listMembers(toc, 'Interaction', INTERACTION);
  listMembers(toc, 'MIDI', MIDI);
  for (const group of HELPER_GROUPS) {
    toc.append(element('div', `Helpers: ${group.title.toLowerCase()}`, 'group'));
    for (const doc of group.helpers) {
      const link = element('a', doc.name, 'sub');
      link.href = `#helper-${doc.name}`;
      toc.append(link);
    }
  }
  const categories = [...new Set(types.map((info) => info.category))];
  for (const category of categories) {
    toc.append(element('div', CATEGORY_TITLES[category] ?? category, 'group'));
    for (const info of types.filter((candidate) => candidate.category === category)) {
      const link = element('a', info.type, 'sub');
      link.href = `#node-${info.type}`;
      toc.append(link);
    }
  }
}

/** Every example gets a link that opens it in the live demo. `data-static` marks ones that are not runnable. */
function addTryLinks(): void {
  for (const block of document.querySelectorAll<HTMLPreElement>('article pre')) {
    if (block.hasAttribute('data-static')) continue;
    const source = block.querySelector('code')?.textContent ?? '';
    const link = element('a', 'Try it', 'try');
    link.href = `./index.html#code=${encodeURIComponent(source)}`;
    link.target = 'cracked-up-demo';
    block.append(link);
  }
}

async function main(): Promise<void> {
  // The version shown is the one in package.json, so it cannot fall behind a release.
  const status = document.querySelector('#status');
  if (status) status.textContent = `Version ${version}, pre-alpha. ${status.textContent ?? ''}`;
  // The registry needs an engine, and an engine needs a context. A one-sample offline context makes
  // no sound and needs no user gesture.
  const engine = await createEngine({ context: new OfflineAudioContext(1, 1, 44100) });
  const types = engine.registry.list();
  buildReference(types);
  buildHelpers();
  buildMembers('sequencing-reference', SEQUENCING);
  buildMembers('interaction-reference', INTERACTION);
  buildMembers('midi-reference', MIDI);
  buildContents(types);
  // Before the links go in: highlighting rewrites each <code>, and a link reads its text.
  highlightBlocks(document.querySelector('article')!);
  addTryLinks();
  engine.dispose();
  // The reference was added after load, so a link straight to one of its entries needs a nudge.
  if (location.hash.length > 1) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}

void main();
