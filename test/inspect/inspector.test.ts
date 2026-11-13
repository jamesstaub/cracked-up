import { afterEach, describe, expect, it } from 'vitest';
import type { Engine, Node, ScopeApi } from '../../src';
import { createInspector, openInspector, toggleInspector } from '../../src/inspect';
import type { Inspector } from '../../src/inspect';
import { offlineEngine } from '../core/setup';
import { frames, liveEngine, wait, watchAnalysers } from './util';

function patch(extra: boolean) {
  return (__: ScopeApi): void => {
    __.bus('drums');
    __().sampler({ id: 'kick' }).to('drums');
    __().sampler({ id: 'snare' }).gain(0.6).to('drums');
    __()
      .saw({ id: 'bass' })
      .lowpass({ id: 'filter', frequency: 600 })
      .overdrive({ id: 'drive', bypass: true })
      .tapedelay({ id: 'echo' })
      .to('main');
    __().lfo({ id: 'wobble', frequency: 4, depth: 350 }).modulate('#filter', 'frequency');
    if (extra) __().noise({ id: 'hiss' }).bandpass(3000).to('drums');
  };
}

/** Whatever a test opened, removed again afterwards. */
const opened: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const close of opened.splice(0)) await close();
});

function host(width = 900, height = 600): HTMLElement {
  const parent = document.createElement('div');
  parent.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:${height}px;display:grid`;
  document.body.append(parent);
  opened.push(() => parent.remove());
  return parent;
}

function inspect(target: Parameters<typeof createInspector>[0], parent = host()): Inspector {
  const inspector = createInspector(target, { parent });
  opened.push(() => inspector.destroy());
  return inspector;
}

async function offline(extra = false): Promise<Engine> {
  const engine = await offlineEngine(0.1);
  await engine.scope('live').build(patch(extra));
  return engine;
}

const shadow = (inspector: Inspector): ShadowRoot => inspector.element.shadowRoot!;
const all = (inspector: Inspector, selector: string): HTMLElement[] => [
  ...shadow(inspector).querySelectorAll<HTMLElement>(selector),
];
/** The drawn node whose label reads as given, e.g. `sampler kick` or `bus drums`. */
const drawn = (inspector: Inspector, label: string): HTMLElement | undefined =>
  all(inspector, '[aria-label]').find((element) =>
    (element.getAttribute('aria-label') ?? '').startsWith(label),
  );
const node = (engine: Engine, id: string): Node => engine.scope('live').select(`#${id}`).first()!;

describe('the inspector', () => {
  it('draws an offline engine: every node, bus and connection, with no taps', async () => {
    const engine = await offline();
    const inspector = inspect(engine);
    await frames(3);

    // root: main, the speakers and the live scope; inside live: 8 nodes, drums, and its view of main.
    expect(inspector.stats()).toMatchObject({ nodes: 13, taps: 0 });
    expect(drawn(inspector, 'sampler kick')).toBeDefined();
    expect(drawn(inspector, 'bus drums')).toBeDefined();
    expect(drawn(inspector, 'scope live')).toBeDefined();
    expect(drawn(inspector, 'overdrive drive')!.getAttribute('aria-label')).toContain('bypassed');
    expect(drawn(inspector, 'overdrive drive')!.classList.contains('bypassed')).toBe(true);
    expect(drawn(inspector, 'tapedelay echo')!.classList.contains('macro')).toBe(true);
    expect(drawn(inspector, 'lfo wobble')!.classList.contains('control')).toBe(true);
    expect(drawn(inspector, 'bus main, of an outer scope')).toBeDefined();

    const paths = [...shadow(inspector).querySelectorAll('svg path:not(.head)')];
    expect(paths).toHaveLength(inspector.stats().edges);
    expect(paths.filter((path) => path.classList.contains('modulation'))).toHaveLength(1);
    expect(shadow(inspector).querySelector('svg text')!.textContent).toBe('frequency');
    expect(shadow(inspector).querySelector('.status .state')!.textContent).toContain('offline');
    expect(shadow(inspector).querySelector('.status .count')!.textContent).toBe(
      '8 nodes, 11 connections',
    );
  });

  it('shows just the scope it is given', async () => {
    const engine = await offline();
    const inspector = inspect(engine.scope('live'));
    expect(inspector.scope).toBe(engine.scope('live'));
    expect(drawn(inspector, 'scope live')).toBeUndefined();
    expect(drawn(inspector, 'sampler kick')).toBeDefined();
    expect(all(inspector, '.crumbs button').map((button) => button.textContent)).toEqual(['live']);
  });

  it('says so when a scope has nothing in it', async () => {
    const engine = await offlineEngine(0.1);
    const inspector = inspect(engine.scope('empty'));
    const empty = shadow(inspector).querySelector<HTMLElement>('.empty')!;
    expect(empty.hidden).toBe(false);
    expect(empty.textContent).toBe('This scope has no nodes yet.');
    engine.scope('empty').chain().sine().to('main');
    inspector.refresh();
    expect(empty.hidden).toBe(true);
  });

  it('follows the graph as it is rebuilt: kept nodes keep their element and their place', async () => {
    const engine = await offline();
    const live = engine.scope('live');
    const inspector = inspect(live);
    const kept = ['sampler kick', 'sampler snare', 'saw bass', 'lowpass filter', 'bus drums'];
    const before = new Map(kept.map((label) => [label, drawn(inspector, label)!]));
    const places = new Map([...before].map(([label, el]) => [label, el.style.transform]));
    expect(drawn(inspector, 'noise hiss')).toBeUndefined();

    // No refresh() here: the inspector hears about the new nodes and redraws on the next frame.
    await live.build(patch(true));
    await frames(3);
    expect(drawn(inspector, 'noise hiss')).toBeDefined();
    for (const [label, element] of before) {
      expect(drawn(inspector, label), label).toBe(element);
      expect(element.style.transform, label).toBe(places.get(label));
    }

    await live.build(patch(false));
    await frames(3);
    expect(drawn(inspector, 'noise hiss')).toBeUndefined();
    for (const [label, element] of before) {
      expect(drawn(inspector, label), label).toBe(element);
      expect(element.style.transform, label).toBe(places.get(label));
    }
  });

  it('notices changes that send no event: a connection, a bypass', async () => {
    const engine = await offline();
    const live = engine.scope('live');
    const inspector = inspect(live);
    const edges = inspector.stats().edges;
    node(engine, 'kick').connect(node(engine, 'filter'));
    node(engine, 'drive').bypass = false;
    // Read a few times a second, so well within a second.
    await wait(700);
    await frames(2);
    expect(inspector.stats().edges).toBe(edges + 1);
    expect(drawn(inspector, 'overdrive drive')!.classList.contains('bypassed')).toBe(false);
  });

  it('keeps the pan, the zoom and what was opened when the graph changes', async () => {
    const engine = await offline();
    const live = engine.scope('live');
    const inspector = inspect(live);
    await frames(2);
    const world = shadow(inspector).querySelector<HTMLElement>('.world')!;

    shadow(inspector).querySelector<HTMLElement>('button[aria-label="Zoom in"]')!.click();
    const viewport = shadow(inspector).querySelector<HTMLElement>('.viewport')!;
    viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    inspector.expand(node(engine, 'echo'));
    const view = world.style.transform;
    expect(view).toContain('scale(');
    expect(all(inspector, '.group')).toHaveLength(1);
    const count = inspector.stats().nodes;
    expect(count).toBeGreaterThan(25);

    await live.build(patch(true));
    await frames(3);
    expect(world.style.transform).toBe(view);
    expect(all(inspector, '.group')).toHaveLength(1);
    expect(inspector.stats().nodes).toBe(count + 2);
    expect(drawn(inspector, 'gain feedback')).toBeDefined();

    inspector.expand(node(engine, 'echo'), false);
    expect(all(inspector, '.group')).toHaveLength(0);
    expect(drawn(inspector, 'gain feedback')).toBeUndefined();
  });

  it('opens a macro in place from its button, and keeps the macro where it was on screen', async () => {
    const engine = await offline();
    const inspector = inspect(engine.scope('live'));
    await frames(2);
    const echo = drawn(inspector, 'tapedelay echo')!;
    const at = echo.getBoundingClientRect();
    const button = echo.querySelector<HTMLButtonElement>('.expand')!;
    expect(button.getAttribute('aria-expanded')).toBe('false');
    button.click();

    const group = all(inspector, '.group')[0]!;
    expect(group.querySelector('.expand')!.getAttribute('aria-expanded')).toBe('true');
    const now = group.getBoundingClientRect();
    expect(now.left).toBeCloseTo(at.left, 0);
    expect(now.top).toBeCloseTo(at.top, 0);
    expect(now.width).toBeGreaterThan(at.width * 2);
    // The loop inside is drawn, with one edge running back.
    expect(drawn(inspector, 'gain record')).toBeDefined();

    group.querySelector<HTMLButtonElement>('.expand')!.click();
    expect(all(inspector, '.group')).toHaveLength(0);
  });

  it('goes into a macro and back out by the trail', async () => {
    const engine = await offline();
    const inspector = inspect(engine);
    const crumbs = (): string[] =>
      all(inspector, '.crumbs button').map((button) => button.textContent ?? '');
    expect(crumbs()).toEqual(['root']);

    inspector.setScope(node(engine, 'echo').insideScope!);
    expect(crumbs()).toEqual(['root', 'live', 'tapedelay #echo']);
    expect(drawn(inspector, 'gain feedback')).toBeDefined();
    expect(drawn(inspector, 'bus in')).toBeDefined();
    expect(drawn(inspector, 'sampler kick')).toBeUndefined();

    all(inspector, '.crumbs button')[1]!.click();
    expect(inspector.scope).toBe(engine.scope('live'));
    expect(crumbs()).toEqual(['root', 'live']);
    expect(drawn(inspector, 'sampler kick')).toBeDefined();

    // A double click on a macro goes in as well.
    drawn(inspector, 'tapedelay echo')!.dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true }),
    );
    expect(inspector.scope).toBe(node(engine, 'echo').insideScope);
  });

  it('can be reached by keyboard: nodes take focus, Enter opens the panel, Escape closes it', async () => {
    const engine = await offline();
    const selected: (string | null)[] = [];
    const parent = host();
    const inspector = createInspector(engine.scope('live'), {
      parent,
      onSelect: (found) => selected.push(found?.id ?? null),
    });
    opened.push(() => inspector.destroy());
    const kick = drawn(inspector, 'sampler kick')!;
    expect(kick.tabIndex).toBe(0);
    expect(kick.getAttribute('role')).toBe('button');
    kick.focus();
    expect(shadow(inspector).activeElement).toBe(kick);

    kick.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const panel = shadow(inspector).querySelector<HTMLElement>('.detail')!;
    expect(panel.hidden).toBe(false);
    expect(inspector.selected).toBe(node(engine, 'kick'));
    expect(kick.classList.contains('selected')).toBe(true);

    let reachedOutside = false;
    const outside = (): void => void (reachedOutside = true);
    parent.addEventListener('keydown', outside);
    panel.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }),
    );
    expect(panel.hidden).toBe(true);
    expect(inspector.selected).toBeNull();
    // That Escape was the panel's; it must not also close whatever holds the inspector.
    expect(reachedOutside).toBe(false);
    expect(shadow(inspector).activeElement).toBe(kick);
    expect(selected).toEqual(['kick', null]);
  });

  it('shows a clicked node in the detail panel, live', async () => {
    const engine = await offline();
    const inspector = inspect(engine.scope('live'));
    drawn(inspector, 'lowpass filter')!.click();
    const panel = shadow(inspector).querySelector<HTMLElement>('.detail')!;
    expect(panel.querySelector('h2')!.textContent).toBe('lowpass');
    expect(panel.querySelector('header .name')!.textContent).toBe('#filter');
    expect(panel.querySelector('.desc')!.textContent).toBe(
      engine.registry.describe('lowpass').description,
    );
    const rows = (): string[][] =>
      [...panel.querySelectorAll('tr')].map((row) =>
        [...row.querySelectorAll('td')].map((cell) => cell.textContent ?? ''),
      );
    expect(rows()[0]!.slice(0, 2)).toEqual(['frequency', '600 Hz']);
    expect(rows()[0]![2]).toContain('20 to 20000');
    expect(rows()[0]![2]).toContain('moved by lfo #wobble');
    expect(rows()[1]!.slice(0, 2)).toEqual(['q', '1']);
    expect(panel.querySelector('.links')!.textContent).toBe('From saw #bass. To overdrive #drive.');
    expect(inspector.detail()!.params[0]).toMatchObject({ name: 'frequency', value: 600 });

    // A value set from elsewhere shows up without the panel being touched.
    node(engine, 'filter').param('frequency').set(1500);
    await frames(3);
    expect(rows()[0]![1]).toBe('1500 Hz');

    // The same through the API, for a bus.
    inspector.select(engine.scope('live').bus('drums'));
    expect(panel.querySelector('h2')!.textContent).toBe('bus');
    expect(panel.querySelector('header .name')!.textContent).toBe('drums');
    expect(rows()[0]!.slice(0, 2)).toEqual(['gain', '1']);
    expect(panel.querySelector('.actions')!.children).toHaveLength(0);

    inspector.select(null);
    expect(panel.hidden).toBe(true);
  });

  it('has a bypass switch, and a trigger button on what can be triggered', async () => {
    const engine = await offline();
    const inspector = inspect(engine.scope('live'));
    const panel = shadow(inspector).querySelector<HTMLElement>('.detail')!;

    inspector.select(node(engine, 'drive'));
    const box = panel.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    expect(box.checked).toBe(true);
    expect(panel.querySelector('.trigger')).toBeNull();
    box.click();
    expect(node(engine, 'drive').bypass).toBe(false);
    expect(drawn(inspector, 'overdrive drive')!.classList.contains('bypassed')).toBe(false);

    // Bypassed from elsewhere, the switch follows.
    node(engine, 'drive').bypass = true;
    await wait(700);
    await frames(2);
    expect(panel.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(true);

    inspector.select(node(engine, 'kick'));
    const calls: unknown[] = [];
    const kick = node(engine, 'kick');
    const trigger = kick.trigger.bind(kick);
    kick.trigger = (options) => {
      calls.push(options);
      return trigger(options);
    };
    panel.querySelector<HTMLButtonElement>('.trigger')!.click();
    expect(calls).toEqual([{}]);

    inspector.select(node(engine, 'echo'));
    expect(panel.querySelector('.open')!.textContent).toBe('Open inside');
    panel.querySelector<HTMLButtonElement>('.open')!.click();
    expect(inspector.scope).toBe(node(engine, 'echo').insideScope);
  });

  it('closes the panel when its node is removed, and follows a node that was replaced', async () => {
    const engine = await offline(true);
    const live = engine.scope('live');
    const inspector = inspect(live);
    inspector.select(node(engine, 'hiss'));
    expect(inspector.selected!.id).toBe('hiss');
    await live.build(patch(false));
    await frames(3);
    expect(inspector.selected).toBeNull();
    expect(shadow(inspector).querySelector<HTMLElement>('.detail')!.hidden).toBe(true);

    // A node rebuilt under the same id (its creation options changed) is a new object.
    inspector.select(node(engine, 'bass'));
    const old = node(engine, 'bass');
    await live.build((__) => {
      patch(false)(__);
      __().saw({ id: 'other', gate: 'closed' }).to('main');
    });
    await live.build((__) => {
      __.bus('drums');
      __().saw({ id: 'bass', gate: 'closed' }).to('main');
    });
    await frames(3);
    expect(node(engine, 'bass')).not.toBe(old);
    expect(inspector.selected).toBe(node(engine, 'bass'));
  });

  it('does not throw when its scope is disposed', async () => {
    const engine = await offline();
    const inspector = inspect(engine.scope('live'));
    engine.scope('live').dispose();
    await frames(3);
    expect(() => inspector.refresh()).not.toThrow();
    expect(inspector.stats().nodes).toBe(0);
    expect(shadow(inspector).querySelector<HTMLElement>('.empty')!.hidden).toBe(false);
  });

  it('removes its element and stops when destroyed', async () => {
    const engine = await offline();
    const parent = host();
    const inspector = createInspector(engine, { parent });
    expect(parent.children).toHaveLength(1);
    inspector.destroy();
    expect(parent.children).toHaveLength(0);
    // Changes after that are not listened to, and nothing throws.
    await engine.scope('live').build(patch(true));
    await frames(2);
    inspector.refresh();
    inspector.destroy();
  });
});

describe('the inspector on a live context', () => {
  it('draws the graph with idle meters while audio is suspended', async () => {
    const context = new AudioContext();
    opened.push(() => context.close());
    if (context.state === 'running') await context.suspend();
    const { createEngine } = await import('../../src');
    const engine = await createEngine({ context });
    await engine.scope('live').build(patch(false));
    const watch = watchAnalysers();
    opened.push(() => watch.restore());
    const inspector = inspect(engine);
    await frames(5);
    expect(inspector.stats().nodes).toBe(13);
    expect(inspector.stats().taps).toBe(0);
    expect(watch.made).toBe(0);
    // WebKit calls a context that has not been allowed to start "interrupted".
    expect(shadow(inspector).querySelector('.status .state')!.textContent).toMatch(
      /^audio (suspended|interrupted): meters idle$/,
    );
  });

  it('taps what is on screen while audio runs, and leaves nothing behind when destroyed', async (test) => {
    const { engine, context, running } = await liveEngine();
    opened.push(() => context.close());
    if (!running) return test.skip();
    const live = engine.scope('live');
    await live.build(patch(false));
    const inside = node(engine, 'echo').insideScope!;
    const state = (): string =>
      JSON.stringify([engine.root.snapshot(), live.snapshot(), inside.snapshot()]);
    const before = state();
    const watch = watchAnalysers();
    opened.push(() => watch.restore());

    const inspector = createInspector(engine, { parent: host() });
    inspector.select(node(engine, 'filter'));
    await wait(400);
    // One tap per output in view (8 nodes and 3 buses: the speakers and the scope's frame have no
    // output of their own), and one for the detail panel.
    expect(inspector.stats().taps).toBe(12);
    expect(watch.open).toBe(12);
    expect(shadow(inspector).querySelector('.status .state')!.textContent).toBe('audio running');
    expect(state()).toBe(before);

    // The meters read what is there: a running saw, an lfo of depth 350, and a sampler with nothing
    // to play. The saw's filter passes it on; the bus everything ends at was turned down to nothing.
    const bass = inspector.level(node(engine, 'bass'))!;
    expect(bass.kind).toBe('audio');
    if (bass.kind === 'audio') {
      expect(bass.peakDb).toBeGreaterThan(-3);
      expect(bass.rmsDb).toBeGreaterThan(-9);
      expect(bass.rmsDb).toBeLessThan(-3);
    }
    const wobble = inspector.level(node(engine, 'wobble'))!;
    expect(wobble.kind).toBe('control');
    if (wobble.kind === 'control') {
      expect(wobble.high).toBeGreaterThan(300);
      expect(wobble.high).toBeLessThanOrEqual(351);
      expect(wobble.low).toBeLessThan(-300);
    }
    expect(inspector.level(node(engine, 'kick'))).toMatchObject({ kind: 'audio', peakDb: -100 });
    expect(inspector.level(engine.bus('main'))).toMatchObject({ kind: 'audio', peakDb: -100 });
    expect(inspector.level(live.bus('drums'))).toMatchObject({ kind: 'audio', peakDb: -100 });

    // Opening the macro taps what is inside it too, as far as it is in view.
    inspector.expand(node(engine, 'echo'));
    inspector.fit();
    await wait(300);
    expect(inspector.stats().taps).toBeGreaterThan(30);
    expect(state()).toBe(before);

    inspector.destroy();
    expect(inspector.stats().taps).toBe(0);
    expect(inspector.level(node(engine, 'bass'))).toBeNull();
    expect(watch.open).toBe(0);
    expect(state()).toBe(before);
  });

  it('taps only what is in view', async (test) => {
    const { engine, context, running } = await liveEngine();
    opened.push(() => context.close());
    if (!running) return test.skip();
    const live = engine.scope('live');
    for (let i = 0; i < 40; i++)
      live
        .chain()
        .sine({ frequency: 100 + i })
        .gain(0.1)
        .to('main');
    // A small window onto a graph of 80 nodes in 40 rows.
    const inspector = inspect(live, host(360, 240));
    await wait(300);
    const stats = inspector.stats();
    expect(stats.nodes).toBe(81);
    expect(stats.visibleNodes).toBeLessThan(30);
    // Each visible node, plus at most the bus the visible connections lead to.
    expect(stats.taps).toBeLessThanOrEqual(stats.visibleNodes + 1);
    expect(stats.taps).toBeGreaterThan(4);
  });

  it('stops listening when audio is suspended', async (test) => {
    const { engine, context, running } = await liveEngine();
    opened.push(() => context.close());
    if (!running) return test.skip();
    await engine.scope('live').build(patch(false));
    const inspector = inspect(engine);
    await wait(300);
    expect(inspector.stats().taps).toBeGreaterThan(0);
    await context.suspend();
    // Taps are kept for a second in case they are wanted again, then removed.
    await wait(1500);
    expect(inspector.stats().taps).toBe(0);
  });
});

describe('openInspector', () => {
  it('opens a sidebar with a close button, and Escape inside it closes it', async () => {
    const engine = await offline();
    let closed = 0;
    const win = openInspector(engine, { mode: 'sidebar', width: 380, onClose: () => closed++ });
    opened.push(() => win.close());
    expect(document.body.contains(win.element)).toBe(true);
    const frame = win.element.shadowRoot!.querySelector<HTMLElement>('.window')!;
    expect(frame.classList.contains('sidebar')).toBe(true);
    expect(frame.getAttribute('role')).toBe('complementary');
    expect(Math.round(frame.getBoundingClientRect().width)).toBe(380);
    expect(win.inspector.stats().nodes).toBe(13);
    expect(win.closed).toBe(false);

    // Its "Full width" button takes it to the whole page and back.
    const widen = win.element.shadowRoot!.querySelector<HTMLElement>('.window-width')!;
    widen.click();
    expect(win.wide).toBe(true);
    expect(Math.round(frame.getBoundingClientRect().width)).toBe(window.innerWidth);
    expect(widen.textContent).toBe('Narrow');
    widen.click();
    expect(win.wide).toBe(false);
    expect(Math.round(frame.getBoundingClientRect().width)).toBe(380);

    // Escape somewhere else on the page is not the sidebar's business.
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(win.closed).toBe(false);
    frame.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(win.closed).toBe(true);
    expect(document.body.contains(win.element)).toBe(false);
    expect(closed).toBe(1);
    win.close();
    expect(closed).toBe(1);
  });

  it('opens a modal that Escape, its button or a click outside closes', async () => {
    const engine = await offline();
    const modal = openInspector(engine.scope('live'), { mode: 'modal', title: 'Graph: live' });
    opened.push(() => modal.close());
    const root = modal.element.shadowRoot!;
    const frame = root.querySelector<HTMLElement>('.window')!;
    expect(frame.getAttribute('role')).toBe('dialog');
    expect(frame.getAttribute('aria-modal')).toBe('true');
    expect(root.querySelector('h1')!.textContent).toBe('Graph: live');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(modal.closed).toBe(true);

    const second = openInspector(engine, { mode: 'modal' });
    second.element.shadowRoot!.querySelector<HTMLElement>('.window-close')!.click();
    expect(second.closed).toBe(true);

    const third = openInspector(engine, { mode: 'modal' });
    third.element.shadowRoot!.querySelector<HTMLElement>('.backdrop')!.click();
    expect(third.closed).toBe(true);
  });

  it('toggles: one call opens, the next closes', async () => {
    const engine = await offline();
    const first = toggleInspector(engine);
    opened.push(() => first?.close());
    expect(first!.closed).toBe(false);
    expect(toggleInspector(engine)).toBeNull();
    expect(first!.closed).toBe(true);
    // Closed by its own button, the next toggle opens a new one.
    const second = toggleInspector(engine)!;
    opened.push(() => second.close());
    second.element.shadowRoot!.querySelector<HTMLElement>('.window-close')!.click();
    const third = toggleInspector(engine);
    opened.push(() => third?.close());
    expect(third).not.toBeNull();
    expect(third!.closed).toBe(false);
  });
});

describe('the core entry point', () => {
  it('does not load the inspector', async () => {
    // Follow every import from the core entry, as the test server serves it, and look for the inspector.
    const seen = new Set<string>();
    const queue = [new URL('../../src/index.ts', import.meta.url).href];
    while (queue.length > 0) {
      const url = queue.pop()!;
      if (seen.has(url)) continue;
      seen.add(url);
      const code = await (await fetch(url)).text();
      for (const match of code.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
        const next = new URL(match[1]!, url).href;
        if (next.includes('/src/')) queue.push(next);
      }
    }
    expect(seen.size).toBeGreaterThan(20);
    expect([...seen].filter((url) => url.includes('/inspect/'))).toEqual([]);
  });
});
