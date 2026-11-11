/**
 * Docs page script. Builds the node reference from the engine's registry, so the reference is the
 * node definitions themselves, and adds a "Try it" link to every example.
 */

import { createEngine } from '../src';
import type { NodeTypeInfo, OptionInfo, ParamMeta } from '../src';

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

/** A one-line example built from the type's own defaults. */
function exampleFor(info: NodeTypeInfo): string {
  const shorthand = info.params.find((param) => param.name === info.shorthand);
  const argument = shorthand ? String(shorthand.default) : '';
  if (info.type === 'sampler') {
    return `__().sampler({ id: 'hit', buffer: 'kick' }).to('main');\nevery(0.5, () => __('#hit').trigger());`;
  }
  if (info.category === 'source') {
    return `__().${info.type}(${argument}).gain(0.2).to('main');`;
  }
  if (info.category === 'filter') {
    const settings = info.params
      .map((param) => {
        const value =
          param.name === 'frequency'
            ? 800
            : param.name === 'gain'
              ? 12
              : param.name === 'q'
                ? 4
                : 0;
        return `${param.name}: ${value}`;
      })
      .join(', ');
    return `__().saw(110).${info.type}({ ${settings} }).gain(0.2).to('main');`;
  }
  if (info.type === 'panner') {
    return `__().saw(110).gain(0.2).panner(-0.8).to('main');`;
  }
  return `__().saw(110).${info.type}(${argument}).gain(0.2).to('main');`;
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

function buildContents(types: readonly NodeTypeInfo[]): void {
  const toc = document.querySelector<HTMLElement>('#toc')!;
  toc.append(element('div', 'Guide', 'group'));
  for (const heading of document.querySelectorAll<HTMLHeadingElement>('article > h2')) {
    if (heading.id === 'reference') continue;
    const link = element('a', heading.textContent ?? '');
    link.href = `#${heading.id}`;
    toc.append(link);
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
  // The registry needs an engine, and an engine needs a context. A one-sample offline context makes
  // no sound and needs no user gesture.
  const engine = await createEngine({ context: new OfflineAudioContext(1, 1, 44100) });
  const types = engine.registry.list();
  buildReference(types);
  buildContents(types);
  addTryLinks();
  engine.dispose();
  // The reference was added after load, so a link straight to one of its entries needs a nudge.
  if (location.hash.length > 1) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}

void main();
