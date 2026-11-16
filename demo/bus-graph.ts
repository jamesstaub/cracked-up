/**
 * The routing pictures on the docs page. Each is drawn from the snapshot of the example beside it,
 * so a picture cannot say something the code does not do.
 *
 * `routeModel` turns a scope's snapshot into the things to draw, `routeLines` says the same in
 * words (the picture's text alternative, and what the tests compare), and `renderRoute` draws it.
 * The first two are pure.
 *
 * A bus is drawn as a box with its parts in the order the signal passes them: input, inserts,
 * level, output. What leaves the output is one of two things, and they are drawn differently: the
 * bus's own output on its way to the bus's destination (a heavy line, labelled `to ...`), and a
 * copy taken by a chain started with `bus.chain()` (a dashed line, labelled `copy`).
 *
 * The snapshot must be of a scope below the root, which is where the live demo runs code too. Of a
 * root scope's `main`, a snapshot says `to: null`, the same as for a bus sent nowhere.
 */

import type { ScopeSnapshot } from '../src';

/** `own`: a bus's output to its destination. `copy`: from a bus's output into a chain. */
export type RouteEdgeKind = 'own' | 'audio' | 'copy';

export interface RoutePart {
  readonly id: string;
  readonly type: string;
}

export interface RouteUnit {
  readonly key: string;
  /** `outer`: a bus of an outer scope (`main`), drawn closed. */
  readonly kind: 'node' | 'bus' | 'outer';
  readonly id: string;
  readonly type: string;
  readonly inserts: readonly RoutePart[];
  readonly level: number;
  /** A bus whose output has no destination (`to(null)`). */
  readonly detached: boolean;
}

export interface RouteEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: RouteEdgeKind;
  /** For a connection into a parameter: its name. */
  readonly param: string | null;
}

export interface RouteModel {
  readonly units: readonly RouteUnit[];
  readonly edges: readonly RouteEdge[];
  /** For each unit, how many steps from the left it is drawn. */
  readonly layers: ReadonlyMap<string, number>;
}

const nodeKey = (id: string): string => `node:${id}`;
const busKey = (name: string): string => `bus:${name}`;

/** Three significant digits at most, without trailing zeros. */
function formatLevel(value: number): string {
  return String(Number(value.toPrecision(3)));
}

export function routeModel(snapshot: ScopeSnapshot): RouteModel {
  const units = new Map<string, RouteUnit>();
  // An insert is drawn inside its bus, and anything connected to it meets the bus.
  const insertOf = new Map<string, string>();
  for (const [bus, ids] of Object.entries(snapshot.graph.inserts ?? {})) {
    for (const id of ids) insertOf.set(id, bus);
  }
  const types = new Map(snapshot.graph.nodes.map((node) => [node.id, node.type]));
  const keyOf = (id: string): string =>
    insertOf.has(id) ? busKey(insertOf.get(id)!) : nodeKey(id);

  for (const node of snapshot.graph.nodes) {
    if (insertOf.has(node.id)) continue;
    units.set(nodeKey(node.id), {
      key: nodeKey(node.id),
      kind: 'node',
      id: node.id,
      type: node.type,
      inserts: [],
      level: 1,
      detached: false,
    });
  }
  for (const bus of snapshot.buses) {
    units.set(busKey(bus.name), {
      key: busKey(bus.name),
      kind: 'bus',
      id: bus.name,
      type: 'bus',
      inserts: (snapshot.graph.inserts?.[bus.name] ?? []).map((id) => ({
        id,
        type: types.get(id) ?? '',
      })),
      level: bus.gain,
      detached: bus.to === null,
    });
  }
  const outer = (name: string): string => {
    const key = busKey(name);
    if (!units.has(key)) {
      units.set(key, {
        key,
        kind: 'outer',
        id: name,
        type: 'bus',
        inserts: [],
        level: 1,
        detached: false,
      });
    }
    return key;
  };

  const edges: RouteEdge[] = [];
  for (const edge of snapshot.graph.edges) {
    const fromBus = typeof edge.from !== 'string';
    const from = typeof edge.from === 'string' ? keyOf(edge.from) : outer(edge.from.bus);
    const to = 'bus' in edge.to ? outer(edge.to.bus) : keyOf(edge.to.node);
    edges.push({
      from,
      to,
      kind: fromBus ? 'copy' : 'audio',
      param: 'param' in edge.to ? edge.to.param : null,
    });
  }
  for (const bus of snapshot.buses) {
    if (bus.to !== null) {
      edges.push({ from: busKey(bus.name), to: outer(bus.to), kind: 'own', param: null });
    }
  }

  const list = [...units.values()];
  return { units: list, edges, layers: layersOf(list, edges) };
}

/** Longest path from the left. A unit with nothing before it sits just left of what it feeds. */
function layersOf(units: readonly RouteUnit[], edges: readonly RouteEdge[]): Map<string, number> {
  const layers = new Map<string, number>(units.map((unit) => [unit.key, 0]));
  // A graph with a loop in it stops moving after this many passes; none of the pictures has one.
  for (let pass = 0; pass < units.length; pass++) {
    let moved = false;
    for (const edge of edges) {
      if (edge.from === edge.to) continue;
      const wanted = layers.get(edge.from)! + 1;
      if (layers.get(edge.to)! < wanted) {
        layers.set(edge.to, wanted);
        moved = true;
      }
    }
    if (!moved) break;
  }
  const last = Math.max(0, ...layers.values());
  for (const unit of units) {
    const feeds = edges.filter((edge) => edge.from === unit.key && edge.to !== unit.key);
    const fed = edges.some((edge) => edge.to === unit.key && edge.from !== unit.key);
    // The engine's output goes at the far right.
    if (unit.kind === 'outer' && feeds.length === 0) layers.set(unit.key, last);
    else if (!fed && feeds.length > 0) {
      layers.set(unit.key, Math.min(...feeds.map((edge) => layers.get(edge.to)!)) - 1);
    }
  }
  return layers;
}

/**
 * The routing in words, one statement per line, from left to right. This is the text alternative
 * of the picture, and what a test compares against what an example is meant to build.
 */
export function routeLines(model: RouteModel): string[] {
  const byKey = new Map(model.units.map((unit) => [unit.key, unit]));
  const name = (key: string): string => {
    const unit = byKey.get(key)!;
    return unit.kind === 'node' ? unit.id : `bus ${unit.id}`;
  };
  const lines: string[] = [];
  const ordered = [...model.units].sort(
    (a, b) => model.layers.get(a.key)! - model.layers.get(b.key)!,
  );
  for (const unit of ordered) {
    if (unit.kind === 'bus') {
      const own = model.edges.find((edge) => edge.kind === 'own' && edge.from === unit.key);
      const parts = [
        'input',
        ...unit.inserts.map((insert) => `insert ${insert.id} (${insert.type})`),
        `level ${formatLevel(unit.level)}`,
        'output',
      ];
      lines.push(
        `bus ${unit.id}: ${parts.join(', ')}; ` +
          (own ? `its output goes to ${name(own.to)}` : 'its output goes nowhere'),
      );
    }
    if (unit.kind === 'outer' && unit.id === 'main') lines.push('bus main goes to the speakers');
    for (const edge of model.edges) {
      if (edge.from !== unit.key || edge.kind === 'own') continue;
      const from =
        edge.kind === 'copy' ? `a copy of the output of ${name(edge.from)}` : name(edge.from);
      if (edge.param !== null) lines.push(`${from} moves ${edge.param} of ${name(edge.to)}`);
      else lines.push(`${from} goes to ${name(edge.to)}`);
    }
  }
  return lines;
}

// --- Drawing --------------------------------------------------------------------------------------

const SVG = 'http://www.w3.org/2000/svg';
/** Width of one character of the 11px monospace the labels are set in. */
const CHAR = 6.65;
const BOX_HEIGHT = 36;
const ROW_PITCH = 80;
const BUS_PAD = 10;
const BUS_HEADER = 18;
const GAP = 30;
/** After a bus there is a label on the line: `to main`, `copy`. */
const GAP_AFTER_BUS = 84;
const GAP_AFTER_DETACHED = 150;
const INNER_GAP = 12;
const MARGIN = 12;

let figures = 0;

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number> = {},
  text?: string,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

const textWidth = (text: string): number => text.length * CHAR;

/** A node's two lines: its id, and its type under it. A made-up id (`gain-0`) is left out. */
function labelOf(part: RoutePart): [string, string | null] {
  const made =
    part.id.startsWith(`${part.type}-`) && /^\d+$/.test(part.id.slice(part.type.length + 1));
  return made || part.id === part.type ? [part.type, null] : [part.id, part.type];
}

function boxWidth(lines: readonly (string | null)[]): number {
  return Math.max(52, Math.ceil(Math.max(...lines.map((line) => textWidth(line ?? ''))) + 18));
}

/** A box with one or two centred lines of text. */
function box(
  x: number,
  cy: number,
  width: number,
  lines: readonly [string, string | null],
  className: string,
  corner = 5,
): SVGGElement {
  const group = svg('g', { class: className });
  group.append(
    svg('rect', { x, y: cy - BOX_HEIGHT / 2, width, height: BOX_HEIGHT, rx: corner }),
    svg(
      'text',
      { x: x + width / 2, y: lines[1] === null ? cy + 4 : cy - 2, 'text-anchor': 'middle' },
      lines[0],
    ),
  );
  if (lines[1] !== null) {
    group.append(
      svg(
        'text',
        { x: x + width / 2, y: cy + 11, 'text-anchor': 'middle', class: 'sub' },
        lines[1],
      ),
    );
  }
  return group;
}

interface Placed {
  readonly unit: RouteUnit;
  readonly width: number;
  x: number;
  row: number;
}

function unitWidth(unit: RouteUnit): number {
  if (unit.kind === 'node') return boxWidth(labelOf(unit));
  if (unit.kind === 'outer') {
    return boxWidth([`bus ${unit.id}`, unit.id === 'main' ? 'speakers' : 'outer']);
  }
  const inner = [
    textWidth('input'),
    ...unit.inserts.map((insert) => boxWidth(labelOf(insert))),
    boxWidth(['level', formatLevel(unit.level)]),
    textWidth('output'),
  ];
  return (
    BUS_PAD * 2 + inner.reduce((sum, width) => sum + width, 0) + INNER_GAP * (inner.length - 1)
  );
}

const PRIORITY: Record<RouteEdgeKind, number> = { own: 0, audio: 1, copy: 2 };

/**
 * Draws the model. Units are placed in columns by layer and in rows so that a bus's own output runs
 * straight along its row, and a chain that takes a copy of it runs in the row below.
 */
export function renderRoute(model: RouteModel): SVGSVGElement {
  const figure = figures++;
  const placed = new Map<string, Placed>(
    model.units.map((unit) => [unit.key, { unit, width: unitWidth(unit), x: 0, row: 0 }]),
  );
  const layerOf = (key: string): number => model.layers.get(key)!;
  const first = Math.min(...model.layers.values());
  const last = Math.max(...model.layers.values());

  // Rows. An edge that passes a column takes a row in it, so nothing is drawn across a box.
  const edges = model.edges.filter((edge) => edge.from !== edge.to);
  const taken = new Map<number, Set<number>>();
  /** The row each edge runs in, in each column it passes without stopping. */
  const passing = new Map<RouteEdge, Map<number, number>>();
  const free = (layer: number, wanted: number): number => {
    const rows = taken.get(layer) ?? new Set<number>();
    taken.set(layer, rows);
    for (let distance = 0; ; distance++) {
      for (const row of [wanted + distance, wanted - distance]) {
        if (row >= 0 && !rows.has(row)) {
          rows.add(row);
          return row;
        }
      }
    }
  };
  const rowBefore = (edge: RouteEdge, layer: number): number =>
    passing.get(edge)?.get(layer - 1) ?? placed.get(edge.from)!.row;
  for (let layer = first; layer <= last; layer++) {
    interface Candidate {
      readonly priority: number;
      readonly wanted: number;
      readonly place: (row: number) => void;
    }
    const candidates: Candidate[] = [];
    for (const item of placed.values()) {
      if (layerOf(item.unit.key) !== layer) continue;
      const incoming = edges
        .filter((edge) => edge.to === item.unit.key)
        .sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind]);
      const lead = incoming[0];
      candidates.push({
        // A unit with nothing before it takes what is left.
        priority: lead ? PRIORITY[lead.kind] : 9,
        wanted: lead ? rowBefore(lead, layer) : 0,
        place: (row) => (item.row = row),
      });
    }
    for (const edge of edges) {
      if (layerOf(edge.from) >= layer || layerOf(edge.to) <= layer) continue;
      candidates.push({
        // A bus's own output keeps its row ahead of anything else. Other lines take their turn
        // with the boxes, from the top, so lines that leave one box stay together.
        priority: PRIORITY[edge.kind] - (edge.kind === 'own' ? 0.5 : 0),
        wanted: rowBefore(edge, layer),
        place: (row) => {
          const rows = passing.get(edge) ?? new Map<number, number>();
          passing.set(edge, rows);
          rows.set(layer, row);
        },
      });
    }
    candidates.sort((a, b) => a.priority - b.priority || a.wanted - b.wanted);
    for (const candidate of candidates) candidate.place(free(layer, candidate.wanted));
  }

  // Columns.
  const columnX = new Map<number, number>();
  const columnWidth = new Map<number, number>();
  let x = MARGIN;
  for (let layer = first; layer <= last; layer++) {
    const items = [...placed.values()].filter((item) => layerOf(item.unit.key) === layer);
    const width = Math.max(0, ...items.map((item) => item.width));
    columnX.set(layer, x);
    columnWidth.set(layer, width);
    for (const item of items) item.x = x;
    const buses = items.filter((item) => item.unit.kind === 'bus');
    x +=
      width +
      (buses.some((item) => item.unit.detached)
        ? GAP_AFTER_DETACHED
        : buses.length > 0
          ? GAP_AFTER_BUS
          : GAP);
  }
  const lastItems = [...placed.values()].filter((item) => layerOf(item.unit.key) === last);
  const detachedLast = lastItems.some((item) => item.unit.detached);
  const totalWidth =
    columnX.get(last)! + columnWidth.get(last)! + MARGIN + (detachedLast ? GAP_AFTER_DETACHED : 0);
  const rows = 1 + Math.max(0, ...[...taken.values()].flatMap((set) => [...set]));
  const top = MARGIN + BUS_HEADER + BUS_PAD + BOX_HEIGHT / 2;
  const centre = (row: number): number => top + row * ROW_PITCH;
  const totalHeight = centre(rows - 1) + BOX_HEIGHT / 2 + BUS_PAD + MARGIN;

  const root = svg('svg', {
    class: 'route-graph',
    width: totalWidth,
    height: totalHeight,
    viewBox: `0 0 ${totalWidth} ${totalHeight}`,
    role: 'img',
    'aria-label': `${routeLines(model).join('. ')}.`,
  });
  const defs = svg('defs');
  for (const kind of ['own', 'audio', 'copy'] as const) {
    const marker = svg('marker', {
      id: `route-${figure}-${kind}`,
      viewBox: '0 0 8 8',
      refX: 7,
      refY: 4,
      markerWidth: 7,
      markerHeight: 7,
      markerUnits: 'userSpaceOnUse',
      orient: 'auto',
    });
    marker.append(svg('path', { d: 'M0 0.5 L8 4 L0 7.5 Z', class: `head ${kind}` }));
    defs.append(marker);
  }
  root.append(defs);

  // Edges go under the boxes.
  const lines = svg('g');
  const labels = svg('g');
  root.append(lines);
  for (const edge of edges) {
    const from = placed.get(edge.from)!;
    const to = placed.get(edge.to)!;
    const points: [number, number][] = [[from.x + from.width, centre(from.row)]];
    for (const [layer, row] of [...(passing.get(edge) ?? [])].sort((a, b) => a[0] - b[0])) {
      points.push([columnX.get(layer)! - 6, centre(row)]);
      points.push([columnX.get(layer)! + columnWidth.get(layer)! + 6, centre(row)]);
    }
    points.push([to.x - 2, centre(to.row)]);
    let d = `M${points[0]![0]} ${points[0]![1]}`;
    for (let index = 1; index < points.length; index++) {
      const [x0, y0] = points[index - 1]!;
      const [x1, y1] = points[index]!;
      if (y0 === y1) d += ` L${x1} ${y1}`;
      else {
        const bend = (x1 - x0) / 2;
        d += ` C${x0 + bend} ${y0} ${x1 - bend} ${y1} ${x1} ${y1}`;
      }
    }
    lines.append(
      svg('path', {
        d,
        class: `edge ${edge.kind}`,
        'marker-end': `url(#route-${figure}-${edge.kind})`,
      }),
    );
    const [startX, startY] = points[0]!;
    const [endX, endY] = points[points.length - 1]!;
    if (edge.kind === 'own') {
      labels.append(
        svg('text', { x: startX + 10, y: startY - 7, class: 'label own' }, `to ${to.unit.id}`),
      );
    } else if (edge.kind === 'copy') {
      labels.append(
        svg(
          'text',
          { x: endX - 8, y: endY + 15, 'text-anchor': 'end', class: 'label copy' },
          'copy',
        ),
      );
    } else if (edge.param !== null) {
      labels.append(
        svg('text', { x: endX - 8, y: endY - 7, 'text-anchor': 'end', class: 'label' }, edge.param),
      );
    }
  }

  for (const item of placed.values()) {
    const { unit, width } = item;
    const cy = centre(item.row);
    if (unit.kind === 'node') {
      root.append(box(item.x, cy, width, labelOf(unit), 'node'));
      continue;
    }
    if (unit.kind === 'outer') {
      const sub = unit.id === 'main' ? 'speakers' : 'outer';
      root.append(box(item.x, cy, width, [`bus ${unit.id}`, sub], 'bus closed'));
      continue;
    }
    const group = svg('g', { class: 'bus' });
    const boxTop = cy - BOX_HEIGHT / 2 - BUS_PAD - BUS_HEADER;
    group.append(
      svg('rect', {
        x: item.x,
        y: boxTop,
        width,
        height: BOX_HEIGHT + BUS_PAD * 2 + BUS_HEADER,
        rx: 10,
        class: 'frame',
      }),
      svg('text', { x: item.x + BUS_PAD, y: boxTop + 15, class: 'title' }, `bus ${unit.id}`),
      // The bus's own path, from one side to the other, under its parts.
      svg('path', { d: `M${item.x} ${cy} L${item.x + width} ${cy}`, class: 'edge own' }),
      svg('circle', { cx: item.x, cy, r: 3.5, class: 'port' }),
      svg('circle', { cx: item.x + width, cy, r: 3.5, class: 'port' }),
      svg('text', { x: item.x + BUS_PAD, y: cy - 7, class: 'part' }, 'input'),
      svg(
        'text',
        { x: item.x + width - BUS_PAD, y: cy - 7, 'text-anchor': 'end', class: 'part' },
        'output',
      ),
    );
    let partX = item.x + BUS_PAD + textWidth('input') + INNER_GAP;
    for (const insert of unit.inserts) {
      const partWidth = boxWidth(labelOf(insert));
      group.append(box(partX, cy, partWidth, labelOf(insert), 'node insert'));
      partX += partWidth + INNER_GAP;
    }
    const level: [string, string] = ['level', formatLevel(unit.level)];
    // Not a node of the graph, so not drawn as one: the fader is a lozenge.
    group.append(box(partX, cy, boxWidth(level), level, 'level', BOX_HEIGHT / 2));
    root.append(group);

    if (unit.detached) {
      // The output with no destination: a short line that ends in a cross.
      const endX = item.x + width + 26;
      const endY = cy - 24;
      lines.append(
        svg('path', { d: `M${item.x + width} ${cy} L${endX} ${endY}`, class: 'edge own' }),
        svg('path', {
          d: `M${endX - 5} ${endY - 5} L${endX + 5} ${endY + 5} M${endX - 5} ${endY + 5} L${endX + 5} ${endY - 5}`,
          class: 'edge own cross',
        }),
      );
      labels.append(
        svg('text', { x: endX + 11, y: endY + 4, class: 'label own' }, 'to(null): nowhere'),
      );
    }
  }
  root.append(labels);
  return root;
}
