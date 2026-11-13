/**
 * A layered graph layout: signal flows left to right, one column per step along the longest path.
 *
 * Pure and deterministic: the same input gives the same output, and nothing here touches the DOM.
 * Given the positions of an earlier layout, nodes that are still there keep their row, and new nodes
 * are fitted into the gaps, so a graph that changes a little moves a little.
 *
 * The steps are the usual ones for this kind of layout (after Sugiyama): break cycles by reversing
 * the edge that closes each loop, give every node a column, put a small stand-in node in each column
 * a long edge passes through so edges get a lane of their own, order the columns to reduce crossings,
 * then choose rows.
 */

export interface LayoutNode {
  readonly key: string;
  readonly width: number;
  readonly height: number;
  /**
   * For a node nothing feeds: sit in the column just before what it feeds instead of at the far
   * left. Used for modulators, which belong next to what they move.
   */
  readonly float?: boolean;
}

export interface LayoutEdge {
  readonly key: string;
  readonly from: string;
  readonly to: string;
  /**
   * A connection that should not decide where a loop is cut or which way the graph runs: modulation.
   * A loop is broken at one of its ordinary edges when it has one.
   */
  readonly weak?: boolean;
}

export interface Point {
  x: number;
  y: number;
}

export interface Box extends Point {
  width: number;
  height: number;
  /** The column, counting from 0 at the left. */
  layer: number;
}

export interface EdgeRoute {
  /** From the source's right edge to the target's left edge, through any lanes in between. */
  points: Point[];
  /** True for the edge that closes a loop: it runs right to left. */
  reversed: boolean;
}

export interface LayoutOptions {
  /** Space between columns. */
  layerGap?: number;
  /** Space between nodes in a column. */
  nodeGap?: number;
  /** Top-left corners from an earlier layout, by node key. Nodes found here keep their row. */
  previous?: ReadonlyMap<string, Point>;
}

export interface LayoutResult {
  nodes: Map<string, Box>;
  edges: Map<string, EdgeRoute>;
  /** The box around everything. With `previous`, `x` and `y` need not be 0. */
  bounds: { x: number; y: number; width: number; height: number };
}

/** Height of the lane a long edge takes in the columns it crosses. */
const LANE = 12;
/** How far an edge that closes a loop swings out past its ends to turn round. */
const TURN = 40;

interface Item {
  key: string;
  width: number;
  height: number;
  layer: number;
  /** Top edge. */
  y: number;
  dummy: boolean;
  /** Order of appearance, for stable tie-breaks. */
  index: number;
  float: boolean;
  ins: Item[];
  outs: Item[];
}

export function layout(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  options: LayoutOptions = {},
): LayoutResult {
  const layerGap = options.layerGap ?? 56;
  const nodeGap = options.nodeGap ?? 16;
  const previous = options.previous;

  const items = new Map<string, Item>();
  for (const node of nodes) {
    if (items.has(node.key)) continue;
    items.set(node.key, {
      key: node.key,
      width: node.width,
      height: node.height,
      layer: 0,
      y: 0,
      dummy: false,
      index: items.size,
      float: node.float === true,
      ins: [],
      outs: [],
    });
  }
  const real = [...items.values()];

  // Edges between known, different nodes. Several edges between the same pair count once for placing,
  // as an ordinary edge if any of them is one.
  const usable = edges.filter(
    (edge) => edge.from !== edge.to && items.has(edge.from) && items.has(edge.to),
  );
  const pairKey = (a: Item, b: Item): string => `${a.key}\u0000${b.key}`;
  const strong = new Map<Item, Item[]>(real.map((item) => [item, []]));
  const strongPairs = new Set<string>();
  for (const edge of usable) {
    if (edge.weak) continue;
    const from = items.get(edge.from)!;
    const to = items.get(edge.to)!;
    if (strongPairs.has(pairKey(from, to))) continue;
    strongPairs.add(pairKey(from, to));
    strong.get(from)!.push(to);
  }

  // --- 1. Break cycles: a depth-first walk along the ordinary edges, and any edge back onto the
  // walk's own path is reversed.
  const backward = new Set<string>();
  const state = new Map<Item, 0 | 1 | 2>();
  const hasIncoming = new Set<Item>();
  for (const targets of strong.values()) for (const target of targets) hasIncoming.add(target);
  const visit = (start: Item): void => {
    if (state.get(start)) return;
    const stack: [Item, number][] = [[start, 0]];
    state.set(start, 1);
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      const [item, next] = top;
      const targets = strong.get(item)!;
      if (next >= targets.length) {
        state.set(item, 2);
        stack.pop();
        continue;
      }
      top[1] = next + 1;
      const target = targets[next]!;
      const seen = state.get(target) ?? 0;
      if (seen === 1) backward.add(pairKey(item, target));
      else if (seen === 0) {
        state.set(target, 1);
        stack.push([target, 0]);
      }
    }
  };
  // Start from the nodes nothing feeds, so loops are entered where the signal enters them.
  for (const item of real) if (!hasIncoming.has(item)) visit(item);
  for (const item of real) visit(item);

  /** The acyclic graph the rest works on: each pair once, loop-closing edges turned round. */
  const dagOut = new Map<Item, Item[]>(real.map((item) => [item, []]));
  const dagIn = new Map<Item, Item[]>(real.map((item) => [item, []]));
  const dagPairs = new Set<string>();
  const addToDag = (a: Item, b: Item): void => {
    if (dagPairs.has(pairKey(a, b))) return;
    dagPairs.add(pairKey(a, b));
    dagOut.get(a)!.push(b);
    dagIn.get(b)!.push(a);
  };
  for (const [item, targets] of strong) {
    for (const target of targets) {
      if (backward.has(pairKey(item, target))) addToDag(target, item);
      else addToDag(item, target);
    }
  }
  // Weak edges join as they are unless that would close a loop, in which case they are the one reversed.
  const reaches = (from: Item, to: Item): boolean => {
    const seen = new Set<Item>([from]);
    const queue = [from];
    while (queue.length > 0) {
      const item = queue.pop()!;
      if (item === to) return true;
      for (const next of dagOut.get(item)!) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return false;
  };
  for (const edge of usable) {
    if (!edge.weak) continue;
    const from = items.get(edge.from)!;
    const to = items.get(edge.to)!;
    if (strongPairs.has(pairKey(from, to)) || dagPairs.has(pairKey(from, to))) continue;
    if (strongPairs.has(pairKey(to, from)) || reaches(to, from)) {
      backward.add(pairKey(from, to));
      addToDag(to, from);
    } else addToDag(from, to);
  }

  // --- 2. Columns: the longest path from the left, in topological order.
  const order: Item[] = [];
  const waiting = new Map<Item, number>(real.map((item) => [item, dagIn.get(item)!.length]));
  const ready = real.filter((item) => waiting.get(item) === 0);
  while (ready.length > 0) {
    const item = ready.shift()!;
    order.push(item);
    for (const target of dagOut.get(item)!) {
      const left = waiting.get(target)! - 1;
      waiting.set(target, left);
      if (left === 0) ready.push(target);
    }
  }
  for (const item of order) {
    for (const target of dagOut.get(item)!) target.layer = Math.max(target.layer, item.layer + 1);
  }
  // A floating node nothing feeds (an lfo) sits just left of what it feeds, not at the far left.
  for (let i = order.length - 1; i >= 0; i--) {
    const item = order[i]!;
    const outs = dagOut.get(item)!;
    if (!item.float || dagIn.get(item)!.length > 0 || outs.length === 0) continue;
    item.layer = Math.max(0, Math.min(...outs.map((target) => target.layer)) - 1);
  }

  // --- 3. Lanes for edges that cross columns.
  const layers: Item[][] = [];
  const layerOf = (index: number): Item[] => (layers[index] ??= []);
  for (const item of real) layerOf(item.layer).push(item);
  for (let i = 0; i < layers.length; i++) layers[i] ??= [];

  /** For each edge that runs left to right, by its pair: the lanes between its ends, left to right. */
  const lanes = new Map<string, Item[]>();
  /**
   * For each edge that closes a loop, by its pair: its lanes, left to right. These include a lane in
   * the column of each end, beside the node, so the edge can pass its own ends on the way round.
   */
  const loops = new Map<string, Item[]>();
  let laneCount = 0;
  const lane = (layer: number): Item => {
    const item: Item = {
      key: `\u0000lane${laneCount++}`,
      width: 0,
      height: LANE,
      layer,
      y: 0,
      dummy: true,
      index: real.length + laneCount,
      float: false,
      ins: [],
      outs: [],
    };
    layerOf(layer).push(item);
    return item;
  };
  const link = (from: Item, to: Item): void => {
    from.outs.push(to);
    to.ins.push(from);
  };
  const forward = new Set<string>();
  for (const edge of usable) {
    const from = items.get(edge.from)!;
    const to = items.get(edge.to)!;
    if (!backward.has(pairKey(from, to))) forward.add(pairKey(from, to));
  }
  for (const a of real) {
    for (const b of dagOut.get(a)!) {
      if (forward.has(pairKey(a, b))) {
        const chain: Item[] = [];
        let from = a;
        for (let layer = a.layer + 1; layer < b.layer; layer++) {
          const next = lane(layer);
          link(from, next);
          chain.push(next);
          from = next;
        }
        link(from, b);
        lanes.set(pairKey(a, b), chain);
      }
      if (backward.has(pairKey(b, a))) {
        const chain: Item[] = [];
        for (let layer = a.layer; layer <= b.layer; layer++) {
          const next = lane(layer);
          const before = chain[chain.length - 1];
          if (before) link(before, next);
          chain.push(next);
        }
        // The end lanes are drawn towards the nodes they sit beside, without pulling on those nodes.
        chain[0]!.ins.push(a);
        chain[chain.length - 1]!.outs.push(b);
        loops.set(pairKey(b, a), chain);
      }
    }
  }

  const centre = (item: Item): number => item.y + item.height / 2;
  const mean = (list: readonly Item[]): number | null =>
    list.length === 0 ? null : list.reduce((sum, item) => sum + centre(item), 0) / list.length;

  const known = (item: Item): Point | undefined =>
    item.dummy ? undefined : previous?.get(item.key);
  const incremental = previous !== undefined && real.some((item) => known(item) !== undefined);

  if (!incremental) {
    // --- 4a. Order each column to reduce crossings: sweep right, then left, a few times, moving each
    // node towards the average position of its neighbours in the column just visited.
    const position = new Map<Item, number>();
    const renumber = (): void => {
      for (const layer of layers) layer.forEach((item, i) => position.set(item, i));
    };
    renumber();
    const sweep = (forward: boolean): void => {
      const from = forward ? 1 : layers.length - 2;
      const step = forward ? 1 : -1;
      for (let l = from; l >= 0 && l < layers.length; l += step) {
        const layer = layers[l]!;
        const weight = new Map<Item, number>();
        for (const item of layer) {
          const near = forward ? item.ins : item.outs;
          const sum = near.reduce((total, other) => total + position.get(other)!, 0);
          weight.set(item, near.length > 0 ? sum / near.length : position.get(item)!);
        }
        layer.sort(
          (a, b) => weight.get(a)! - weight.get(b)! || position.get(a)! - position.get(b)!,
        );
        layer.forEach((item, i) => position.set(item, i));
      }
    };
    for (let i = 0; i < 4; i++) {
      sweep(true);
      sweep(false);
    }

    // --- 5a. Rows: stack each column, then pull nodes towards their neighbours while keeping the order.
    for (const layer of layers) {
      let y = 0;
      for (const item of layer) {
        item.y = y;
        y += item.height + nodeGap;
      }
    }
    const relax = (forward: boolean): void => {
      const from = forward ? 1 : layers.length - 2;
      const step = forward ? 1 : -1;
      for (let l = from; l >= 0 && l < layers.length; l += step) {
        const layer = layers[l]!;
        const wanted = layer.map((item) => {
          const target = mean(forward ? item.ins : item.outs);
          return target === null ? item.y : target - item.height / 2;
        });
        const placed = separate(
          wanted,
          layer.map((item) => item.height),
          nodeGap,
        );
        layer.forEach((item, i) => (item.y = placed[i]!));
      }
    };
    for (let i = 0; i < 6; i++) {
      relax(true);
      relax(false);
    }
    relax(true);
  } else {
    // --- 4b/5b. Keep what was there. Known nodes take their old row; the rest go in the nearest gap
    // to where their neighbours are.
    for (const layer of layers) {
      const kept = layer
        .filter((item) => known(item) !== undefined)
        .sort((a, b) => known(a)!.y - known(b)!.y || a.index - b.index);
      const placed = separate(
        kept.map((item) => known(item)!.y),
        kept.map((item) => item.height),
        nodeGap,
      );
      kept.forEach((item, i) => (item.y = placed[i]!));
    }
    const settled = new Set<Item>();
    for (const layer of layers) {
      for (const item of layer) if (known(item) !== undefined) settled.add(item);
    }
    for (const layer of layers) {
      const taken = layer
        .filter((item) => settled.has(item))
        .map((item): [number, number] => [item.y, item.y + item.height]);
      for (const item of layer) {
        if (settled.has(item)) continue;
        const near = [...item.ins, ...item.outs].filter((other) => settled.has(other));
        const target = mean(near);
        const bottom = taken.reduce((low, span) => Math.max(low, span[1] + nodeGap), 0);
        const wanted = target === null ? bottom : target - item.height / 2;
        item.y = nearestGap(taken, wanted, item.height, nodeGap);
        taken.push([item.y, item.y + item.height]);
        settled.add(item);
      }
      layer.sort((a, b) => a.y - b.y || a.index - b.index);
    }
  }

  // --- 6. Columns to x, nodes centred in their column.
  const columnX: number[] = [];
  const columnWidth: number[] = [];
  let x = 0;
  for (let l = 0; l < layers.length; l++) {
    const width = layers[l]!.reduce((widest, item) => Math.max(widest, item.width), 0);
    columnX.push(x);
    columnWidth.push(width);
    x += width + layerGap;
  }
  if (!incremental) {
    const all = layers.flat();
    const shift = all.reduce((least, item) => Math.min(least, item.y), Infinity);
    // Whole and half pixels only, so positions carried into later layouts stay exact.
    if (Number.isFinite(shift))
      for (const item of all) item.y = Math.round((item.y - shift) * 2) / 2;
  }

  const boxes = new Map<string, Box>();
  const itemX = (item: Item): number =>
    columnX[item.layer]! + (columnWidth[item.layer]! - item.width) / 2;
  for (const item of real) {
    boxes.set(item.key, {
      x: itemX(item),
      y: item.y,
      width: item.width,
      height: item.height,
      layer: item.layer,
    });
  }

  // --- 7. Routes.
  const routes = new Map<string, EdgeRoute>();
  for (const edge of edges) {
    const from = items.get(edge.from);
    const to = items.get(edge.to);
    if (!from || !to || from === to) continue;
    const reversed = backward.has(pairKey(from, to));
    const chain = (reversed ? loops : lanes).get(pairKey(from, to)) ?? [];
    // A lane runs level across the whole of its column, so the edge clears whatever is in it.
    const through = chain.map((item) => [
      { x: columnX[item.layer]!, y: centre(item) },
      { x: columnX[item.layer]! + columnWidth[item.layer]!, y: centre(item) },
    ]);
    if (reversed) through.reverse().forEach((pair) => pair.reverse());
    routes.set(edge.key, {
      points: [
        { x: itemX(from) + from.width, y: centre(from) },
        ...through.flat(),
        { x: itemX(to), y: centre(to) },
      ],
      reversed,
    });
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of boxes.values()) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  for (const route of routes.values()) {
    for (const point of route.points) {
      minY = Math.min(minY, point.y - LANE / 2);
      maxY = Math.max(maxY, point.y + LANE / 2);
    }
    if (route.reversed) {
      // It turns round outside both of its ends.
      maxX = Math.max(maxX, route.points[0]!.x + TURN);
      minX = Math.min(minX, route.points[route.points.length - 1]!.x - TURN);
    }
  }
  const bounds =
    boxes.size === 0
      ? { x: 0, y: 0, width: 0, height: 0 }
      : { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  return { nodes: boxes, edges: routes, bounds };
}

/**
 * Positions as close as possible to `wanted` (least squares) with each item at least its own height
 * plus `gap` below the one before. Items are in their final order.
 */
export function separate(
  wanted: readonly number[],
  heights: readonly number[],
  gap: number,
): number[] {
  // Take out the space each item needs below the ones before it; what is left must only not decrease,
  // which is solved by merging neighbours that are out of order into blocks at their average.
  const offsets: number[] = [];
  let offset = 0;
  for (let i = 0; i < wanted.length; i++) {
    offsets.push(offset);
    offset += heights[i]! + gap;
  }
  const blocks: { sum: number; count: number }[] = [];
  for (let i = 0; i < wanted.length; i++) {
    blocks.push({ sum: wanted[i]! - offsets[i]!, count: 1 });
    while (blocks.length > 1) {
      const last = blocks[blocks.length - 1]!;
      const before = blocks[blocks.length - 2]!;
      if (before.sum / before.count <= last.sum / last.count) break;
      before.sum += last.sum;
      before.count += last.count;
      blocks.pop();
    }
  }
  const out: number[] = [];
  for (const block of blocks) {
    // An item that collides with nothing gets exactly what it asked for, with no rounding error, so
    // a node that is kept in place really is in the same place.
    if (block.count === 1) out.push(wanted[out.length]!);
    else {
      for (let i = 0; i < block.count; i++) {
        out.push(block.sum / block.count + offsets[out.length]!);
      }
    }
  }
  return out;
}

/** The top edge nearest to `wanted` at which something `height` tall fits clear of every taken span. */
function nearestGap(
  taken: readonly [number, number][],
  wanted: number,
  height: number,
  gap: number,
): number {
  const fits = (y: number): boolean =>
    taken.every((span) => y + height + gap <= span[0] || y >= span[1] + gap);
  if (fits(wanted)) return wanted;
  let best = wanted;
  let distance = Infinity;
  for (const span of taken) {
    for (const candidate of [span[0] - gap - height, span[1] + gap]) {
      const away = Math.abs(candidate - wanted);
      if (away < distance && fits(candidate)) {
        best = candidate;
        distance = away;
      }
    }
  }
  return best;
}

/**
 * The route as an SVG path: horizontal at both ends, so edges leave and enter nodes squarely. An edge
 * that closes a loop leaves to the right, turns back, and comes in from the left.
 */
export function edgePath(route: EdgeRoute): string {
  const points = route.points;
  const first = points[0];
  if (!first) return '';
  const n = (value: number): string => String(Math.round(value * 10) / 10);
  let d = `M${n(first.x)} ${n(first.y)}`;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (a.y === b.y && b.x > a.x !== route.reversed) {
      d += ` L${n(b.x)} ${n(b.y)}`;
      continue;
    }
    if (!route.reversed) {
      const pull = Math.max(16, (b.x - a.x) / 2);
      d += ` C${n(a.x + pull)} ${n(a.y)} ${n(b.x - pull)} ${n(b.y)} ${n(b.x)} ${n(b.y)}`;
      continue;
    }
    // Right to left. Each end swings outwards to turn round; in between it runs along its lanes.
    const leaving = i === 1;
    const arriving = i === points.length - 1;
    const pull = Math.max(16, (a.x - b.x) / 2);
    const c1x = leaving ? Math.max(a.x, b.x) + TURN * 1.3 : a.x - pull;
    const c2x = arriving ? Math.min(a.x, b.x) - TURN * 1.3 : b.x + pull;
    d += ` C${n(c1x)} ${n(a.y)} ${n(c2x)} ${n(b.y)} ${n(b.x)} ${n(b.y)}`;
  }
  return d;
}
