/**
 * The inspector: a live drawing of a scope's graph with a level meter on every output and movement
 * along every connection that is carrying signal.
 *
 * How it is put together:
 * - Structure (boxes, lines, labels) is DOM and SVG, updated only when the graph changes. Elements
 *   are kept by key, so a node that is still there is the same element in the same place.
 * - Everything that moves (meters, the dashes along connections) is painted on one canvas laid over
 *   the graph, from one `requestAnimationFrame` loop. Nothing in the DOM changes per frame.
 * - Levels come from taps (see `taps.ts`) on the outputs that are on screen, and only those.
 */

import type { Bus, Engine, Node, NodeTypeInfo, Scope } from '../api';
import { edgePath, layout } from './layout';
import type { LayoutResult, Point } from './layout';
import { LevelMeter, METER_FLOOR_DB, RangeMeter, measure } from './meter';
import type { BlockStats } from './meter';
import { buildModel, readScope, signature } from './model';
import type { Handle, NodeDetail, ViewEdge, ViewGraph, ViewNode } from './model';
import { DetailPanel } from './panel';
import type { Palette } from './panel';
import { STYLES } from './styles';
import { TapSet } from './taps';

export type InspectorTheme = 'auto' | 'light' | 'dark';

export interface InspectorOptions {
  /** The element to draw into. The inspector fills it; give it a size. */
  parent: HTMLElement;
  /** `auto` follows the system setting. Default `auto`. */
  theme?: InspectorTheme;
  /** `false` draws the graph without listening to anything. Default true. */
  meters?: boolean;
  /** Called when a node is selected or the selection is cleared. */
  onSelect?: (node: Node | null) => void;
}

export interface InspectorStats {
  /** Nodes and connections drawn, inside expanded macros and scopes included. */
  nodes: number;
  edges: number;
  /** How many of those nodes are in view. */
  visibleNodes: number;
  /** Analysers attached right now. 0 whenever audio is not running. */
  taps: number;
  /** Milliseconds of script per animation frame: the average over recent frames, and the worst of them. */
  frameMs: number;
  worstFrameMs: number;
}

/** What the meter on one output reads at this moment. */
export type LevelReading =
  | {
      readonly kind: 'audio';
      /** Decibels relative to full scale; -100 stands for silence. */
      readonly peakDb: number;
      readonly rmsDb: number;
      /** The highest peak of the last second or so. */
      readonly holdDb: number;
      readonly clipped: boolean;
    }
  | {
      readonly kind: 'control';
      readonly value: number;
      /** The lowest and highest values of the last two seconds. */
      readonly low: number;
      readonly high: number;
    };

export interface Inspector {
  /** The inspector's own element, a child of `parent`. */
  readonly element: HTMLElement;
  /** The scope on show. */
  readonly scope: Scope;
  /** Shows another scope: a child scope, or the inside of a macro (`node.insideScope`). */
  setScope(scope: Scope): void;
  /** Reads the graph again now. It is also read when nodes come and go, and a few times a second. */
  refresh(): void;
  /**
   * Brings the whole graph into view, however small that makes it, and keeps it so until the next
   * pan or zoom. Before this is called the view starts at the left of the graph, at a readable size.
   */
  fit(): void;
  /** Lays the graph out from scratch, forgetting where nodes were. */
  tidy(): void;
  /** Opens a macro or child scope in place, or with `false` closes it. */
  expand(target: Node | Scope, open?: boolean): void;
  /** Opens the detail panel for a node or bus of the scope on show; `null` closes it. */
  select(target: Node | Bus | null): void;
  /** The node the detail panel is showing, if it is showing a node. */
  readonly selected: Node | null;
  /** What the detail panel is showing, as data. */
  detail(): NodeDetail | null;
  /**
   * What the meter on a node's or bus's output reads now. Null when it is not being metered: it is
   * out of view, inside something closed, or audio is not running.
   */
  level(target: Node | Bus): LevelReading | null;
  setTheme(theme: InspectorTheme): void;
  stats(): InspectorStats;
  /** Removes the element, every tap and every listener. */
  destroy(): void;
}

const NODE_W = 124;
const NODE_H = 38;
const BUS_H = 28;
const GROUP_HEAD = 26;
const GROUP_PAD = 14;
/** Movement of the dashes along a busy connection, in pixels per second. */
const FLOW_SPEED = 36;
const DASH = [3, 11] as const;
const MIN_ZOOM = 0.15;
/** The smallest scale the view chooses for itself. Below this the labels cannot be read. */
const READABLE_ZOOM = 0.7;
const MAX_ZOOM = 2.5;

interface Transform {
  x: number;
  y: number;
  k: number;
}

/** What is remembered per scope shown, so going into a macro and back out restores the view. */
interface ViewState {
  transform: Transform | null;
  /** True once the user has panned or zoomed; until then the view keeps fitting the graph. */
  moved: boolean;
  /** True after Fit: fit the whole graph however small that makes it. */
  whole: boolean;
  /** Macros and scopes the user opened or closed, by key. */
  toggles: Map<string, boolean>;
  /** Node positions of the last layout, per graph path. */
  positions: Map<string, Map<string, Point>>;
}

interface Arranged {
  graph: ViewGraph;
  result: LayoutResult;
  inner: Map<string, Arranged>;
}

interface PlacedNode {
  key: string;
  node: ViewNode;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Drawn opened up, as a frame round its inner graph. */
  open: boolean;
  /** 0 for the scope on show, 1 for what is inside an opened macro or scope in it, and so on. */
  depth: number;
}

interface PlacedEdge {
  edge: ViewEdge;
  d: string;
  path: Path2D | null;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  end: Point;
  control: boolean;
}

interface EdgeEls {
  path: SVGPathElement;
  head: SVGPathElement;
}

const SVG = 'http://www.w3.org/2000/svg';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function sizeOf(node: ViewNode): { width: number; height: number } {
  if (node.kind === 'output') return { width: 44, height: BUS_H };
  if (node.kind === 'bus') {
    return { width: Math.min(160, Math.max(64, node.id.length * 7.2 + 44)), height: BUS_H };
  }
  return { width: node.expandable ? NODE_W + 14 : NODE_W, height: NODE_H };
}

function isEngine(target: Engine | Scope): target is Engine {
  return 'root' in target && 'registry' in target;
}

export function createInspector(target: Engine | Scope, options: InspectorOptions): Inspector {
  return new InspectorImpl(target, options);
}

class InspectorImpl implements Inspector {
  readonly element = el('div', 'cu-inspector');
  private engine: Engine;
  private home: Scope;
  private current: Scope;
  private states = new WeakMap<Scope, ViewState>();
  private options: InspectorOptions;

  private root = el('div', 'root');
  private crumbs = el('nav', 'crumbs');
  private body = el('div', 'body');
  private viewport = el('div', 'viewport');
  private world = el('div', 'world');
  private groupLayer = el('div', 'groups');
  private svg = document.createElementNS(SVG, 'svg');
  private nodeLayer = el('div', 'nodes');
  private canvas = el('canvas', 'live');
  private empty = el('div', 'empty');
  private statusCount = el('span', 'count');
  private statusState = el('span', 'state');
  private statusCost = el('span', 'cost');
  private probes = el('div', 'probe');
  private panel: DetailPanel;

  private model: ViewGraph | null = null;
  private sig = '';
  private handles = new Map<string, Handle>();
  private placed = new Map<string, PlacedNode>();
  private placedEdges: PlacedEdge[] = [];
  private bounds = { x: 0, y: 0, width: 0, height: 0 };
  private nodeEls = new Map<string, HTMLElement>();
  private edgeEls = new Map<string, EdgeEls>();
  /** One label per node that has modulated parameters, naming them. By the node's key. */
  private labelEls = new Map<string, SVGTextElement>();
  private selectedKey: string | null = null;
  private selectedHandle: Handle | null = null;

  private transform: Transform = { x: 0, y: 0, k: 1 };
  private size = { width: 0, height: 0 };
  private visibleNodes: PlacedNode[] = [];
  private visibleEdges: PlacedEdge[] = [];
  private viewDirty = true;
  private paintDirty = true;

  private taps: TapSet | null = null;
  private probe: TapSet | null = null;
  private meters = new Map<string, LevelMeter | RangeMeter>();
  private block: BlockStats = { peak: 0, rms: 0, min: 0, max: 0, last: 0 };
  private wanted = new Map<string, AudioNode>();
  private probeWanted = new Map<string, AudioNode>();

  private raf = 0;
  private lastFrame = 0;
  private sincePoll = 0;
  private sinceStatus = 1;
  private sinceColors = 10;
  private flow = 0;
  private dirty = true;
  private textDirty = false;
  private frameMs = 0;
  private worst: number[] = [];
  private destroyed = false;

  private colors: Palette = {
    bg: '#fff',
    panel: '#fff',
    text: '#000',
    muted: '#666',
    border: '#ccc',
    edge: '#bbb',
    accent: '#b4530a',
    ok: '#2f7d4f',
    clip: '#c42b1c',
    mod: '#8a3ea8',
  };
  private probeEls = new Map<keyof Palette, HTMLElement>();
  private reducedMotion: MediaQueryList | null = null;
  private unsubscribe: (() => void)[] = [];
  private cleanup: (() => void)[] = [];
  private suppressClick = false;

  constructor(target: Engine | Scope, options: InspectorOptions) {
    this.options = options;
    this.home = isEngine(target) ? target.root : target;
    this.engine = this.home.engine;
    this.current = this.home;

    this.panel = new DetailPanel({
      meterFor: (id) => {
        // Modulators live in the same scope as what they move, so they share its key prefix.
        const key = this.selectedKey;
        if (key === null) return null;
        const prefix = key.slice(0, key.lastIndexOf('#') + 1);
        return this.meters.get(prefix + id) ?? null;
      },
      close: () => this.selectKey(null),
      enter: () => {
        if (this.selectedKey !== null) this.enter(this.selectedKey);
      },
      changed: () => this.refresh(),
    });

    this.build();
    options.parent.append(this.element);
    this.setTheme(options.theme ?? 'auto');
    this.resolveColors();
    this.measureViewport();
    this.refresh();
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  // --- Public ---------------------------------------------------------------------------------------

  get scope(): Scope {
    return this.current;
  }

  get selected(): Node | null {
    return this.selectedHandle?.node ?? null;
  }

  setScope(scope: Scope): void {
    if (scope === this.current) return;
    this.state().transform = { ...this.transform };
    // A scope outside the one the inspector was opened on becomes the new starting point.
    if (!this.pathTo(scope)) this.home = scope;
    this.current = scope;
    this.selectKey(null);
    for (const element of this.nodeEls.values()) element.remove();
    for (const els of this.edgeEls.values()) this.removeEdgeEls(els);
    for (const label of this.labelEls.values()) label.remove();
    this.nodeEls.clear();
    this.edgeEls.clear();
    this.labelEls.clear();
    this.meters.clear();
    this.sig = '';
    const saved = this.state().transform;
    if (saved) this.setTransform(saved);
    this.refresh();
  }

  refresh(): void {
    if (this.destroyed) return;
    this.dirty = false;
    this.sincePoll = 0;
    const state = this.state();
    const expanded = (key: string, kind: 'macro' | 'scope'): boolean =>
      state.toggles.get(key) ?? kind === 'scope';
    let model: ViewGraph;
    this.empty.textContent = 'This scope has no nodes yet.';
    try {
      const reading = readScope(this.current, expanded);
      model = buildModel(reading.source, expanded);
      this.handles = reading.handles;
      this.subscribe(reading.scopes);
    } catch (error) {
      // The scope was disposed under us. Show that instead of a stale graph.
      this.handles = new Map();
      this.subscribe([]);
      model = { path: '', name: this.current.name, nodes: [], edges: [] };
      this.empty.textContent = `This scope can no longer be read: ${
        error instanceof Error ? error.message : String(error)
      }`;
    }
    const sig = signature(model);
    this.syncSelection();
    if (sig === this.sig && this.model) return;
    this.sig = sig;
    this.model = model;
    this.place();
  }

  fit(): void {
    const state = this.state();
    state.moved = false;
    state.whole = true;
    this.fitNow();
  }

  tidy(): void {
    const state = this.state();
    state.positions.clear();
    state.moved = false;
    this.place();
  }

  expand(target: Node | Scope, open = true): void {
    const key = this.keyOf(target);
    if (key !== null) this.setOpen(key, open);
  }

  select(target: Node | Bus | null): void {
    this.selectKey(target === null ? null : this.keyOf(target));
  }

  detail(): NodeDetail | null {
    return this.panel.detail();
  }

  level(target: Node | Bus): LevelReading | null {
    // A bus can be drawn more than once (in its own scope, and in each child scope that uses it).
    // Read whichever of them is being listened to.
    for (const key of this.keysOf(target)) {
      const meter = this.meters.get(key);
      if (!meter || !this.taps?.has(key)) continue;
      if (meter instanceof LevelMeter) {
        const { peakDb, rmsDb, holdDb, clipped } = meter;
        return { kind: 'audio', peakDb, rmsDb, holdDb, clipped };
      }
      return { kind: 'control', value: meter.value, low: meter.low, high: meter.high };
    }
    return null;
  }

  setTheme(theme: InspectorTheme): void {
    if (theme === 'auto') this.element.removeAttribute('data-theme');
    else this.element.setAttribute('data-theme', theme);
    this.sinceColors = 10;
  }

  stats(): InspectorStats {
    return {
      nodes: this.placed.size,
      edges: this.placedEdges.length,
      visibleNodes: this.visibleNodes.length,
      taps: (this.taps?.count ?? 0) + (this.probe?.count ?? 0),
      frameMs: this.frameMs,
      worstFrameMs: this.worst.reduce((most, ms) => Math.max(most, ms), 0),
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.taps?.clear();
    this.probe?.clear();
    this.meters.clear();
    for (const off of this.unsubscribe) off();
    for (const off of this.cleanup) off();
    this.unsubscribe = [];
    this.cleanup = [];
    this.element.remove();
  }

  // --- Building the DOM -----------------------------------------------------------------------------

  private build(): void {
    const shadow = this.element.attachShadow({ mode: 'open' });
    const style = el('style');
    style.textContent = STYLES;

    const bar = el('div', 'bar');
    this.crumbs.setAttribute('aria-label', 'Scope');
    const tool = (text: string, label: string, run: () => void): HTMLButtonElement => {
      const button = el('button', 'tool', text);
      button.type = 'button';
      button.title = label;
      button.setAttribute('aria-label', label);
      button.addEventListener('click', run);
      return button;
    };
    bar.append(
      this.crumbs,
      tool('Tidy', 'Lay the graph out again', () => this.tidy()),
      tool('−', 'Zoom out', () => this.zoomBy(1 / 1.25)),
      tool('+', 'Zoom in', () => this.zoomBy(1.25)),
      tool('Fit', 'Fit the whole graph in view', () => this.fit()),
    );

    this.viewport.tabIndex = 0;
    this.viewport.setAttribute('role', 'group');
    this.viewport.setAttribute(
      'aria-label',
      'Graph. Arrow keys pan, plus and minus zoom, 0 fits it in view.',
    );
    this.svg.setAttribute('class', 'edges');
    this.svg.setAttribute('aria-hidden', 'true');
    this.world.append(this.groupLayer, this.svg, this.nodeLayer);
    this.canvas.setAttribute('aria-hidden', 'true');
    this.viewport.append(this.world, this.canvas, this.empty);

    this.body.append(this.viewport, this.panel.element);
    const status = el('div', 'status');
    status.append(this.statusCount, this.statusState, this.statusCost);

    for (const name of Object.keys(this.colors) as (keyof Palette)[]) {
      const probe = el('span');
      probe.style.color = `var(--${name})`;
      this.probes.append(probe);
      this.probeEls.set(name, probe);
    }
    this.root.append(bar, this.body, status, this.probes);
    shadow.append(style, this.root);

    this.listen();
  }

  private on<T extends EventTarget>(
    target: T,
    type: string,
    listener: (event: never) => void,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, listener as EventListener, options);
    this.cleanup.push(() => target.removeEventListener(type, listener as EventListener, options));
  }

  private listen(): void {
    const viewport = this.viewport;

    // Dragging anywhere pans. A press that does not move is a click, handled below.
    let drag: { id: number; x: number; y: number; moved: boolean } | null = null;
    this.on(viewport, 'pointerdown', (event: PointerEvent) => {
      if (event.button !== 0) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    });
    this.on(viewport, 'pointermove', (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.moved) {
        if (Math.hypot(dx, dy) < 4) return;
        drag.moved = true;
        viewport.classList.add('panning');
        try {
          viewport.setPointerCapture(event.pointerId);
        } catch {
          // The pointer is already gone; the pan simply ends.
        }
      }
      drag.x = event.clientX;
      drag.y = event.clientY;
      this.userTransform({ ...this.transform, x: this.transform.x + dx, y: this.transform.y + dy });
    });
    const endDrag = (event: PointerEvent): void => {
      if (!drag || event.pointerId !== drag.id) return;
      if (drag.moved) {
        // The click that follows a drag is not a selection.
        this.suppressClick = true;
        setTimeout(() => (this.suppressClick = false), 0);
      }
      drag = null;
      viewport.classList.remove('panning');
    };
    this.on(viewport, 'pointerup', endDrag);
    this.on(viewport, 'pointercancel', endDrag);

    this.on(
      viewport,
      'wheel',
      (event: WheelEvent) => {
        event.preventDefault();
        if (event.ctrlKey || event.metaKey) {
          const rect = viewport.getBoundingClientRect();
          this.zoomAt(
            event.clientX - rect.left,
            event.clientY - rect.top,
            Math.exp(-event.deltaY * 0.01),
          );
        } else {
          this.userTransform({
            ...this.transform,
            x: this.transform.x - event.deltaX,
            y: this.transform.y - event.deltaY,
          });
        }
      },
      { passive: false },
    );

    this.on(viewport, 'click', (event: MouseEvent) => {
      if (this.suppressClick) return;
      const target = event.target as Element;
      const holder = target.closest<HTMLElement>('[data-key]');
      const key = holder?.dataset['key'];
      if (key === undefined) return;
      if (target.closest('.expand')) this.toggle(key);
      else if (target.closest('.enter')) this.enter(key);
      else this.selectKey(key);
    });
    this.on(viewport, 'dblclick', (event: MouseEvent) => {
      const target = event.target as Element;
      if (target.closest('button')) return;
      const key = target.closest<HTMLElement>('[data-key]')?.dataset['key'];
      if (key !== undefined) this.enter(key);
    });

    this.on(this.root, 'keydown', (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement;
      if (event.key === 'Escape' && this.panel.open) {
        // Escape closes the panel first; a second press reaches whatever holds the inspector.
        event.stopPropagation();
        const key = this.selectedKey;
        this.selectKey(null);
        if (key !== null) this.focusable(key)?.focus();
        return;
      }
      if (!this.viewport.contains(target)) return;
      const key = target.closest<HTMLElement>('[data-key]')?.dataset['key'];
      if ((event.key === 'Enter' || event.key === ' ') && key !== undefined) {
        if (target.closest('button')) return;
        event.preventDefault();
        this.selectKey(key);
        return;
      }
      const step = 60;
      const pan = (dx: number, dy: number): void => {
        event.preventDefault();
        this.userTransform({
          ...this.transform,
          x: this.transform.x + dx,
          y: this.transform.y + dy,
        });
      };
      if (event.key === 'ArrowLeft') pan(step, 0);
      else if (event.key === 'ArrowRight') pan(-step, 0);
      else if (event.key === 'ArrowUp') pan(0, step);
      else if (event.key === 'ArrowDown') pan(0, -step);
      else if (event.key === '+' || event.key === '=') this.zoomBy(1.25);
      else if (event.key === '-') this.zoomBy(1 / 1.25);
      else if (event.key === '0') this.fit();
    });

    // Bring a node into view when the keyboard reaches it. The browser may also have scrolled the
    // viewport to do so; undo that, since panning is done with a transform.
    this.on(viewport, 'focusin', (event: FocusEvent) => {
      const key = (event.target as HTMLElement).closest<HTMLElement>('[data-key]')?.dataset['key'];
      const node = key === undefined ? undefined : this.placed.get(key);
      if (node && (event.target as HTMLElement).matches(':focus-visible')) this.reveal(node);
    });
    this.on(viewport, 'scroll', () => {
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
    });

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        this.measureViewport();
        if (!this.state().moved) this.fitNow();
      });
      observer.observe(viewport);
      this.cleanup.push(() => observer.disconnect());
    }
    if (typeof matchMedia === 'function') {
      this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
      const scheme = matchMedia('(prefers-color-scheme: dark)');
      this.on(scheme, 'change', () => (this.sinceColors = 10));
    }
  }

  // --- Scopes and state -----------------------------------------------------------------------------

  private state(): ViewState {
    let state = this.states.get(this.current);
    if (!state) {
      state = {
        transform: null,
        moved: false,
        whole: false,
        toggles: new Map(),
        positions: new Map(),
      };
      this.states.set(this.current, state);
    }
    return state;
  }

  /** The scopes from the starting scope down to `scope`, or null if it is not inside it. */
  private pathTo(scope: Scope): Scope[] | null {
    const chain = [scope];
    let at = scope;
    while (at !== this.home) {
      const up = at.owner ? at.owner.scope : at.parent;
      if (!up) return null;
      chain.unshift(up);
      at = up;
    }
    return chain;
  }

  private renderCrumbs(): void {
    const chain = this.pathTo(this.current) ?? [this.current];
    const parts: HTMLElement[] = [];
    chain.forEach((scope, index) => {
      if (index > 0) parts.push(el('span', 'sep', '›'));
      const owner = scope.owner;
      const button = el('button', '', owner ? `${owner.type} #${owner.id}` : scope.name);
      button.type = 'button';
      if (scope === this.current) button.setAttribute('aria-current', 'true');
      else button.addEventListener('click', () => this.setScope(scope));
      parts.push(button);
    });
    this.crumbs.replaceChildren(...parts);
  }

  private subscribe(scopes: readonly Scope[]): void {
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
    const changed = (): void => {
      this.dirty = true;
    };
    for (const scope of scopes) {
      this.unsubscribe.push(
        scope.on('node:added', changed),
        scope.on('node:removed', changed),
        scope.on('param:changed', () => {
          this.textDirty = true;
        }),
      );
    }
  }

  private *keysOf(target: Node | Bus | Scope): Generator<string> {
    for (const [key, handle] of this.handles) {
      if (handle.node === target || handle.scope === target) yield key;
      // A bus reached from a child scope is a view of the same bus; its output tells them apart.
      else if (handle.bus && 'gain' in target && 'output' in target) {
        if (handle.bus.output === (target as Bus).output) yield key;
      }
    }
  }

  private keyOf(target: Node | Bus | Scope): string | null {
    for (const key of this.keysOf(target)) return key;
    return null;
  }

  private toggle(key: string): void {
    const node = this.placed.get(key);
    if (!node) return;
    this.setOpen(key, !node.open);
    this.focusable(key)?.focus({ preventScroll: true });
  }

  /**
   * Opens or closes a macro or scope in place. Opening one can make the graph several times larger,
   * so the view stops fitting the whole graph and instead keeps the thing that was opened where it is.
   */
  private setOpen(key: string, open: boolean): void {
    const state = this.state();
    const before = this.placed.get(key);
    state.toggles.set(key, open);
    state.moved = true;
    this.refresh();
    const after = this.placed.get(key);
    if (!before || !after) return;
    const t = this.transform;
    this.setTransform({
      k: t.k,
      x: t.x + (before.x - after.x) * t.k,
      y: t.y + (before.y - after.y) * t.k,
    });
  }

  /** Shows the inside of a macro or child scope on its own. */
  private enter(key: string): void {
    const handle = this.handles.get(key);
    const inside = handle?.node?.insideScope ?? handle?.scope ?? null;
    if (inside) this.setScope(inside);
  }

  private focusable(key: string): HTMLElement | null {
    const element = this.nodeEls.get(key);
    if (!element) return null;
    return element.classList.contains('group')
      ? element.querySelector<HTMLElement>('.group-head')
      : element;
  }

  // --- Selection ------------------------------------------------------------------------------------

  private selectKey(key: string | null): void {
    const handle = key === null ? undefined : this.handles.get(key);
    const usable = handle && (handle.node || handle.bus) ? handle : null;
    const previous = this.selectedKey;
    this.selectedKey = usable ? key : null;
    this.selectedHandle = usable;
    if (previous !== null) this.nodeEls.get(previous)?.classList.remove('selected');
    if (usable && key !== null) {
      this.nodeEls.get(key)?.classList.add('selected');
      this.showPanel(key, usable);
    } else {
      this.panel.hide();
      this.probe?.clear();
    }
    this.body.classList.toggle('with-detail', this.panel.open);
    if (previous !== this.selectedKey) this.options.onSelect?.(usable?.node ?? null);
  }

  private showPanel(key: string, handle: Handle): void {
    const registry = this.engine.registry;
    const type = handle.node?.type;
    const info: NodeTypeInfo | null =
      type !== undefined && registry.has(type) ? registry.describe(type) : null;
    const placed = this.placed.get(key);
    const route = this.placedEdges.find((e) => e.edge.from === key && e.edge.kind === 'route');
    const busTo = route ? (this.placed.get(route.edge.to)?.node.id ?? null) : null;
    this.panel.show(
      handle,
      info,
      placed?.node.signal ?? 'audio',
      busTo,
      Boolean(handle.node?.insideScope),
    );
  }

  /** After a refresh: the selected node may be gone, or be a new node with the same id. */
  private syncSelection(): void {
    const key = this.selectedKey;
    if (key === null) return;
    const handle = this.handles.get(key);
    if (!handle || !(handle.node || handle.bus)) {
      this.selectKey(null);
    } else if (handle.node !== this.selectedHandle?.node) {
      this.selectedHandle = handle;
      this.showPanel(key, handle);
    }
  }

  // --- Layout and structure -------------------------------------------------------------------------

  private arrange(graph: ViewGraph, state: ViewState): Arranged {
    const inner = new Map<string, Arranged>();
    const nodes = graph.nodes.map((node) => {
      if (!node.children) {
        return { key: node.key, ...sizeOf(node), float: node.signal === 'control' };
      }
      const child = this.arrange(node.children, state);
      inner.set(node.key, child);
      return {
        key: node.key,
        width: Math.max(NODE_W + 40, child.result.bounds.width + GROUP_PAD * 2),
        height: GROUP_HEAD + GROUP_PAD * 2 + child.result.bounds.height,
      };
    });
    const previous = state.positions.get(graph.path);
    const edges = graph.edges.map((edge) => ({
      key: edge.key,
      from: edge.from,
      to: edge.to,
      weak: edge.kind === 'modulation',
    }));
    const result = layout(nodes, edges, { layerGap: 44, ...(previous ? { previous } : {}) });
    const positions = new Map<string, Point>();
    for (const [key, box] of result.nodes) positions.set(key, { x: box.x, y: box.y });
    state.positions.set(graph.path, positions);
    return { graph, result, inner };
  }

  private flatten(arranged: Arranged, ox: number, oy: number, depth: number): void {
    const control = new Set<string>();
    for (const node of arranged.graph.nodes) {
      const box = arranged.result.nodes.get(node.key);
      if (!box) continue;
      if (node.signal === 'control') control.add(node.key);
      const inner = arranged.inner.get(node.key);
      const x = ox + box.x;
      const y = oy + box.y;
      this.placed.set(node.key, {
        key: node.key,
        node,
        x,
        y,
        w: box.width,
        h: box.height,
        open: inner !== undefined,
        depth,
      });
      if (inner) {
        const b = inner.result.bounds;
        // Centre the inner graph in a frame that is wider than it.
        const spare = box.width - GROUP_PAD * 2 - b.width;
        this.flatten(
          inner,
          x + GROUP_PAD + spare / 2 - b.x,
          y + GROUP_HEAD + GROUP_PAD - b.y,
          depth + 1,
        );
      }
    }
    for (const edge of arranged.graph.edges) {
      const route = arranged.result.edges.get(edge.key);
      if (!route) continue;
      const points = route.points.map((point) => ({ x: point.x + ox, y: point.y + oy }));
      const d = edgePath({ points, reversed: route.reversed });
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const point of points) {
        x0 = Math.min(x0, point.x);
        y0 = Math.min(y0, point.y);
        x1 = Math.max(x1, point.x);
        y1 = Math.max(y1, point.y);
      }
      // Curves bulge past their end points, most of all the ones that turn back.
      const slack = route.reversed ? 60 : 20;
      this.placedEdges.push({
        edge,
        d,
        path: typeof Path2D === 'function' ? new Path2D(d) : null,
        x0: x0 - slack,
        y0: y0 - slack,
        x1: x1 + slack,
        y1: y1 + slack,
        end: points[points.length - 1]!,
        control: edge.kind === 'modulation' || control.has(edge.from),
      });
    }
  }

  /** Lays the model out and brings the DOM in line with it. */
  private place(): void {
    const model = this.model;
    if (!model) return;
    const state = this.state();
    const arranged = this.arrange(model, state);
    this.placed = new Map();
    this.placedEdges = [];
    this.flatten(arranged, 0, 0, 0);
    this.bounds = arranged.result.bounds;

    // Nodes: keep the element of every key that is still there.
    const focused = this.element.shadowRoot?.activeElement ?? null;
    for (const [key, element] of this.nodeEls) {
      const now = this.placed.get(key);
      if (now && now.open === element.classList.contains('group')) continue;
      element.remove();
      this.nodeEls.delete(key);
    }
    for (const node of this.placed.values()) {
      let element = this.nodeEls.get(node.key);
      if (!element) {
        element = node.open ? this.makeGroup(node) : this.makeNode(node);
        this.nodeEls.set(node.key, element);
        (node.open ? this.groupLayer : this.nodeLayer).append(element);
      }
      this.updateElement(element, node);
    }
    // Tab order follows the picture: left to right, then top to bottom.
    const order = [...this.placed.values()]
      .filter((node) => !node.open)
      .sort((a, b) => a.x - b.x || a.y - b.y);
    const inOrder = order.map((node) => this.nodeEls.get(node.key)!);
    const children = this.nodeLayer.children;
    if (inOrder.some((element, index) => children[index] !== element)) {
      this.nodeLayer.append(...inOrder);
      if (focused instanceof HTMLElement && focused.isConnected) {
        focused.focus({ preventScroll: true });
      }
    }

    // Edges.
    const seen = new Set<string>();
    const driven = new Map<string, string[]>();
    for (const placed of this.placedEdges) {
      const { edge } = placed;
      seen.add(edge.key);
      let els = this.edgeEls.get(edge.key);
      if (!els) {
        const path = document.createElementNS(SVG, 'path');
        path.setAttribute('class', edge.kind);
        const head = document.createElementNS(SVG, 'path');
        head.setAttribute('class', `head ${edge.kind}`);
        els = { path, head };
        this.edgeEls.set(edge.key, els);
        this.svg.append(path, head);
      }
      els.path.setAttribute('d', placed.d);
      const { x, y } = placed.end;
      els.head.setAttribute('d', `M${x} ${y}l-6 -3.5v7z`);
      if (edge.param !== null) {
        const names = driven.get(edge.to) ?? [];
        if (!driven.has(edge.to)) driven.set(edge.to, names);
        if (!names.includes(edge.param)) names.push(edge.param);
      }
    }
    for (const [key, els] of this.edgeEls) {
      if (seen.has(key)) continue;
      this.removeEdgeEls(els);
      this.edgeEls.delete(key);
    }
    // The parameters being modulated are named just above the node they belong to.
    for (const [key, label] of this.labelEls) {
      if (driven.has(key)) continue;
      label.remove();
      this.labelEls.delete(key);
    }
    for (const [key, names] of driven) {
      const target = this.placed.get(key);
      if (!target) continue;
      let label = this.labelEls.get(key);
      if (!label) {
        label = document.createElementNS(SVG, 'text');
        this.labelEls.set(key, label);
        this.svg.append(label);
      }
      const text = names.join(', ');
      if (label.textContent !== text) label.textContent = text;
      label.setAttribute('x', String(target.x + 3));
      label.setAttribute('y', String(target.y - 4));
    }

    for (const key of this.meters.keys()) if (!this.placed.has(key)) this.meters.delete(key);
    this.empty.hidden = this.placed.size > 0;
    this.renderCrumbs();
    if (this.selectedKey !== null) this.nodeEls.get(this.selectedKey)?.classList.add('selected');
    this.viewDirty = true;
    this.sinceStatus = 1;
    if (!state.moved) this.fitNow();
  }

  private removeEdgeEls(els: EdgeEls): void {
    els.path.remove();
    els.head.remove();
  }

  private makeNode(placed: PlacedNode): HTMLElement {
    const { node } = placed;
    const element = el('div', 'node');
    element.dataset['key'] = node.key;
    if (node.kind === 'output') {
      element.append(el('span', 'type', 'out'));
      element.setAttribute('aria-label', 'The speakers');
      return element;
    }
    element.tabIndex = 0;
    element.setAttribute('role', 'button');
    element.append(el('span', 'type'), el('span', 'name'));
    if (node.expandable) element.append(this.expandButton(false));
    return element;
  }

  private makeGroup(placed: PlacedNode): HTMLElement {
    const { node } = placed;
    const element = el('div', 'group');
    element.dataset['key'] = node.key;
    const head = el('div', 'group-head');
    head.tabIndex = 0;
    head.setAttribute('role', 'button');
    const enter = el('button', 'enter', '↗');
    enter.type = 'button';
    enter.title = 'Show only this';
    enter.setAttribute('aria-label', 'Show only this');
    head.append(this.expandButton(true), el('span', 'type'), el('span', 'name'), enter);
    element.append(head);
    return element;
  }

  private expandButton(open: boolean): HTMLButtonElement {
    const button = el('button', 'expand', open ? '▾' : '▸');
    button.type = 'button';
    button.title = open ? 'Close' : 'Open in place';
    button.setAttribute('aria-label', open ? 'Close' : 'Open in place');
    button.setAttribute('aria-expanded', String(open));
    return button;
  }

  private updateElement(element: HTMLElement, placed: PlacedNode): void {
    const { node } = placed;
    element.style.transform = `translate(${placed.x}px, ${placed.y}px)`;
    element.style.width = `${placed.w}px`;
    element.style.height = `${placed.h}px`;
    const base = placed.open ? 'group' : 'node';
    const classes = [
      base,
      node.kind,
      node.category ? `cat-${node.category}` : '',
      node.macro ? 'macro' : '',
      node.signal === 'control' ? 'control' : '',
      node.bypassed ? 'bypassed' : '',
      node.external ? 'external' : '',
      node.key === this.selectedKey ? 'selected' : '',
    ];
    element.className = classes.filter(Boolean).join(' ');
    if (node.kind === 'output') return;

    const type = element.querySelector<HTMLElement>('.type')!;
    const name = element.querySelector<HTMLElement>('.name')!;
    const names = node.classes.map((item) => `.${item}`);
    let typeText = node.type;
    let nameText = '';
    if (node.kind === 'bus') typeText = node.id;
    else if (node.kind === 'scope') nameText = node.id;
    else nameText = [node.autoId ? '' : `#${node.id}`, ...names].filter(Boolean).join(' ');
    if (type.textContent !== typeText) type.textContent = typeText;
    if (name.textContent !== nameText) name.textContent = nameText;

    let flag = element.querySelector<HTMLElement>(':scope > .flag');
    if (node.bypassed && !placed.open) {
      if (!flag) {
        flag = el('span', 'flag', 'bypassed');
        element.append(flag);
      }
    } else flag?.remove();

    const said = [
      node.kind === 'bus' ? `bus ${node.id}` : node.kind === 'scope' ? `scope ${node.id}` : '',
      node.kind === 'node' ? `${node.type} ${node.id}` : '',
      node.external ? 'of an outer scope' : '',
      node.macro ? 'macro' : '',
      node.bypassed ? 'bypassed' : '',
    ];
    const target = placed.open ? element.querySelector<HTMLElement>('.group-head')! : element;
    target.setAttribute('aria-label', said.filter(Boolean).join(', '));
    target.title = node.kind === 'node' ? `${node.type} #${node.id}` : node.id;
  }

  // --- Pan and zoom ---------------------------------------------------------------------------------

  private measureViewport(): void {
    const width = this.viewport.clientWidth;
    const height = this.viewport.clientHeight;
    if (width === this.size.width && height === this.size.height) return;
    this.size = { width, height };
    const ratio = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(width * ratio));
    this.canvas.height = Math.max(1, Math.round(height * ratio));
    this.viewDirty = true;
  }

  private setTransform(next: Transform): void {
    this.transform = next;
    this.world.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.k})`;
    this.viewDirty = true;
  }

  /** A change the user made: from now on the view stays where they put it. */
  private userTransform(next: Transform): void {
    this.state().moved = true;
    this.setTransform(next);
  }

  private zoomAt(x: number, y: number, factor: number): void {
    const t = this.transform;
    const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, t.k * factor));
    const scale = k / t.k;
    this.userTransform({ k, x: x - (x - t.x) * scale, y: y - (y - t.y) * scale });
  }

  private zoomBy(factor: number): void {
    this.zoomAt(this.size.width / 2, this.size.height / 2, factor);
  }

  private fitNow(): void {
    const { width, height } = this.size;
    const b = this.bounds;
    if (width === 0 || height === 0 || b.width === 0 || b.height === 0) return;
    const pad = 20;
    // Until Fit is asked for, the graph is not shrunk past the point where its labels can be read.
    const k = Math.max(
      this.state().whole ? MIN_ZOOM : READABLE_ZOOM,
      Math.min(1, (width - pad * 2) / b.width, (height - pad * 2) / b.height),
    );
    // Centred when it fits; otherwise from the left and top, where the signal starts.
    const x = b.width * k <= width - pad * 2 ? (width - b.width * k) / 2 : pad;
    const y = b.height * k <= height - pad * 2 ? (height - b.height * k) / 2 : pad;
    this.setTransform({ k, x: x - b.x * k, y: y - b.y * k });
  }

  /** Pans just enough to show a node the keyboard has reached: for an opened macro, its heading. */
  private reveal(node: PlacedNode): void {
    const t = this.transform;
    const pad = 16;
    const left = node.x * t.k + t.x;
    const top = node.y * t.k + t.y;
    const right = left + Math.min(node.w, NODE_W + 14) * t.k;
    const bottom = top + Math.min(node.h, NODE_H) * t.k;
    let dx = 0;
    let dy = 0;
    if (left < pad) dx = pad - left;
    else if (right > this.size.width - pad) dx = this.size.width - pad - right;
    if (top < pad) dy = pad - top;
    else if (bottom > this.size.height - pad) dy = this.size.height - pad - bottom;
    if (dx !== 0 || dy !== 0) this.userTransform({ ...t, x: t.x + dx, y: t.y + dy });
  }

  // --- The frame loop -------------------------------------------------------------------------------

  private tick = (now: number): void => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.tick);
    const started = performance.now();
    const dt = Math.min(0.25, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;

    this.sincePoll += dt;
    // Connections and bypass change without an event, so the graph is also read a few times a second.
    if (this.dirty || this.sincePoll >= 0.4) this.refresh();
    this.sinceColors += dt;
    if (this.sinceColors >= 2) this.resolveColors();

    this.frame(dt);

    const cost = performance.now() - started;
    this.frameMs += (cost - this.frameMs) * 0.05;
    this.worst.push(cost);
    if (this.worst.length > 120) this.worst.shift();
    this.sinceStatus += dt;
    if (this.sinceStatus >= 0.5) this.renderStatus();
  };

  private outputOf(key: string): AudioNode | null {
    const handle = this.handles.get(key);
    if (!handle) return null;
    if (handle.node) return handle.node.disposed ? null : handle.node.output;
    return handle.bus?.output ?? null;
  }

  private frame(dt: number): void {
    if (this.viewDirty) this.cull();
    const context = this.engine.context;
    const running =
      this.options.meters !== false && !this.engine.offline && context.state === 'running';

    // Which outputs to listen to: every node in view, and the source of every connection in view.
    const wanted = this.wanted;
    wanted.clear();
    if (running) {
      for (const node of this.visibleNodes) {
        const output = this.outputOf(node.key);
        if (output) wanted.set(node.key, output);
      }
      for (const edge of this.visibleEdges) {
        const key = edge.edge.from;
        if (wanted.has(key)) continue;
        const output = this.outputOf(key);
        if (output) wanted.set(key, output);
      }
      if (this.selectedKey !== null) {
        const prefix = this.selectedKey.slice(0, this.selectedKey.lastIndexOf('#') + 1);
        for (const id of this.panel.modulatorIds()) {
          const output = this.outputOf(prefix + id);
          if (output) wanted.set(prefix + id, output);
        }
      }
    }
    if (wanted.size > 0 && !this.taps) this.taps = new TapSet(context);
    const taps = this.taps;
    taps?.sync(wanted, dt);

    for (const key of wanted.keys()) {
      if (this.meters.has(key)) continue;
      const control = this.placed.get(key)?.node.signal === 'control';
      this.meters.set(key, control ? new RangeMeter() : new LevelMeter());
    }
    let active = false;
    for (const [key, meter] of this.meters) {
      const samples = running && wanted.has(key) ? (taps?.read(key) ?? null) : null;
      if (samples) {
        meter.update(measure(samples, this.block), dt);
        active = true;
      } else if (meter instanceof LevelMeter) {
        // Out of view or paused: let it fall, then forget it.
        meter.idle(dt);
        if (meter.silent) this.meters.delete(key);
        else active = true;
      } else {
        this.meters.delete(key);
        this.paintDirty = true;
      }
    }

    if (active || this.paintDirty) {
      this.flow = (this.flow + dt * FLOW_SPEED) % (DASH[0] + DASH[1]);
      this.paint();
      this.paintDirty = active;
    }

    if (this.panel.open && this.selectedKey !== null) {
      const probeWanted = this.probeWanted;
      probeWanted.clear();
      const output = running ? this.outputOf(this.selectedKey) : null;
      if (output) probeWanted.set('probe', output);
      if (output && !this.probe) this.probe = new TapSet(context, 2048, 0.5);
      this.probe?.sync(probeWanted, dt);
      if (this.textDirty) this.panel.textChanged();
      this.panel.frame(
        output ? (this.probe?.analyser('probe') ?? null) : null,
        dt,
        this.colors,
        context.sampleRate,
      );
    }
    this.textDirty = false;
  }

  /** Works out what is in view. Done when the view or the layout changes, not every frame. */
  private cull(): void {
    this.viewDirty = false;
    this.paintDirty = true;
    const t = this.transform;
    const x0 = -t.x / t.k;
    const y0 = -t.y / t.k;
    const x1 = x0 + this.size.width / t.k;
    const y1 = y0 + this.size.height / t.k;
    this.visibleNodes = [];
    this.visibleEdges = [];
    if (this.size.width === 0 || this.size.height === 0) return;
    for (const node of this.placed.values()) {
      if (node.x < x1 && node.x + node.w > x0 && node.y < y1 && node.y + node.h > y0) {
        this.visibleNodes.push(node);
      }
    }
    for (const edge of this.placedEdges) {
      if (edge.x0 < x1 && edge.x1 > x0 && edge.y0 < y1 && edge.y1 > y0) {
        this.visibleEdges.push(edge);
      }
    }
  }

  private paint(): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const ratio = window.devicePixelRatio || 1;
    const t = this.transform;
    const colors = this.colors;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(ratio * t.k, 0, 0, ratio * t.k, ratio * t.x, ratio * t.y);

    // Connections: dashes that move with the signal, and show only as strongly as it is flowing.
    const still = this.reducedMotion?.matches ?? false;
    ctx.lineCap = 'round';
    ctx.lineWidth = 2.5;
    if (still) ctx.setLineDash([]);
    else {
      ctx.setLineDash(DASH as unknown as number[]);
      ctx.lineDashOffset = -this.flow;
    }
    for (const edge of this.visibleEdges) {
      const meter = this.meters.get(edge.edge.from);
      if (!meter || !edge.path) continue;
      const activity = meter.activity;
      if (activity < 0.02) continue;
      ctx.globalAlpha = (still ? 0.6 : 1) * (0.2 + 0.8 * activity);
      ctx.strokeStyle = edge.control ? colors.mod : colors.accent;
      ctx.stroke(edge.path);
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // Meters, in the slot at the right edge of each node.
    for (const node of this.visibleNodes) {
      const meter = this.meters.get(node.key);
      if (!meter) continue;
      const x = node.x + node.w - (node.node.kind === 'bus' ? 13 : 10);
      const y = node.y + 5;
      const h = (node.open ? GROUP_HEAD : node.h) - 10;
      const w = 4;
      if (meter instanceof LevelMeter) {
        const at = (db: number): number =>
          h * Math.min(1, Math.max(0, (db - METER_FLOOR_DB) / -METER_FLOOR_DB));
        ctx.fillStyle = colors.ok;
        ctx.globalAlpha = 0.4;
        const peak = at(meter.peakDb);
        ctx.fillRect(x, y + h - peak, w, peak);
        ctx.globalAlpha = 1;
        const rms = at(meter.rmsDb);
        ctx.fillRect(x, y + h - rms, w, rms);
        if (meter.holdDb > METER_FLOOR_DB) {
          ctx.fillStyle = meter.clipped ? colors.clip : colors.text;
          ctx.fillRect(x - 1, y + h - at(meter.holdDb) - 0.75, w + 2, 1.5);
        }
      } else if (meter.scale > 0) {
        // A control signal: zero in the middle, the range it has covered, and where it is now.
        const mid = y + h / 2;
        const at = (value: number): number =>
          mid - (Math.max(-1, Math.min(1, value / meter.scale)) * h) / 2;
        ctx.fillStyle = colors.mod;
        ctx.globalAlpha = 0.35;
        const top = at(meter.high);
        ctx.fillRect(x, top, w, Math.max(1, at(meter.low) - top));
        ctx.globalAlpha = 1;
        ctx.fillRect(x - 1, at(meter.value) - 1, w + 2, 2);
        ctx.fillStyle = colors.muted;
        ctx.fillRect(x - 2, mid - 0.5, 1.5, 1);
      }
    }
  }

  private renderStatus(): void {
    this.sinceStatus = 0;
    const nodes = [...this.placed.values()].filter((node) => node.node.kind === 'node').length;
    const edges = this.placedEdges.length;
    this.statusCount.textContent = `${nodes} node${nodes === 1 ? '' : 's'}, ${edges} connection${
      edges === 1 ? '' : 's'
    }`;
    const state = this.engine.offline ? 'offline' : this.engine.context.state;
    this.statusState.textContent =
      state === 'running'
        ? 'audio running'
        : state === 'offline'
          ? 'offline engine: no meters'
          : `audio ${state}: meters idle`;
    this.statusState.classList.toggle('running', state === 'running');
    const stats = this.stats();
    this.statusCost.textContent = `${stats.taps} taps · ${stats.frameMs.toFixed(2)} ms/frame`;
    this.statusCost.title =
      'Analysers attached, and the script time this inspector uses per animation frame.';
  }

  /** Reads the theme's colours as the browser resolved them, for painting on the canvas. */
  private resolveColors(): void {
    this.sinceColors = 0;
    let changed = false;
    for (const [name, probe] of this.probeEls) {
      const color = getComputedStyle(probe).color;
      if (color && color !== this.colors[name]) {
        this.colors[name] = color;
        changed = true;
      }
    }
    if (changed) this.paintDirty = true;
  }
}
