import { describe, expect, it } from 'vitest';
import { edgePath, layout, separate } from '../../src/inspect/layout';
import type { LayoutEdge, LayoutNode, LayoutResult } from '../../src/inspect/layout';

const node = (key: string, width = 100, height = 40): LayoutNode => ({ key, width, height });
const edge = (from: string, to: string, weak = false): LayoutEdge => ({
  key: `${from}>${to}`,
  from,
  to,
  weak,
});
const nodes = (...keys: string[]): LayoutNode[] => keys.map((key) => node(key));
const chain = (...keys: string[]): LayoutEdge[] =>
  keys.slice(1).map((key, i) => edge(keys[i]!, key));

/** Pairs of nodes whose boxes overlap. */
function overlaps(result: LayoutResult): string[] {
  const boxes = [...result.nodes.entries()];
  const found: string[] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const [ka, a] = boxes[i]!;
      const [kb, b] = boxes[j]!;
      const apart =
        a.x + a.width <= b.x ||
        b.x + b.width <= a.x ||
        a.y + a.height <= b.y ||
        b.y + b.height <= a.y;
      if (!apart) found.push(`${ka}/${kb}`);
    }
  }
  return found;
}

/** A small repeatable random source, so the large test graph is the same every run. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

describe('layout', () => {
  it('puts a chain in columns from left to right, on one row', () => {
    const result = layout(nodes('a', 'b', 'c'), chain('a', 'b', 'c'));
    const [a, b, c] = ['a', 'b', 'c'].map((key) => result.nodes.get(key)!);
    expect([a!.layer, b!.layer, c!.layer]).toEqual([0, 1, 2]);
    expect(a!.x).toBeLessThan(b!.x);
    expect(b!.x).toBeLessThan(c!.x);
    expect(b!.y).toBe(a!.y);
    expect(c!.y).toBe(a!.y);
    expect(result.bounds.x).toBe(0);
    expect(result.bounds.y).toBe(0);
  });

  it('puts the branches of a split in one column, apart, and joins them again', () => {
    const result = layout(nodes('src', 'left', 'right', 'sum'), [
      edge('src', 'left'),
      edge('src', 'right'),
      edge('left', 'sum'),
      edge('right', 'sum'),
    ]);
    const left = result.nodes.get('left')!;
    const right = result.nodes.get('right')!;
    expect(left.layer).toBe(1);
    expect(right.layer).toBe(1);
    expect(Math.abs(left.y - right.y)).toBeGreaterThanOrEqual(40);
    expect(result.nodes.get('sum')!.layer).toBe(2);
    expect(overlaps(result)).toEqual([]);
    // The source and the sum sit between their two branches.
    const middle = (left.y + right.y) / 2;
    expect(result.nodes.get('src')!.y).toBeCloseTo(middle, 6);
    expect(result.nodes.get('sum')!.y).toBeCloseTo(middle, 6);
  });

  it('copes with a feedback loop: the edge that closes it runs backwards', () => {
    const result = layout(nodes('in', 'record', 'line', 'tone', 'feedback', 'out'), [
      ...chain('in', 'record', 'line', 'tone', 'feedback'),
      edge('feedback', 'record'),
      edge('tone', 'out'),
    ]);
    expect(result.edges.get('feedback>record')!.reversed).toBe(true);
    for (const key of ['in>record', 'record>line', 'line>tone', 'tone>feedback', 'tone>out']) {
      expect(result.edges.get(key)!.reversed, key).toBe(false);
    }
    const layer = (key: string) => result.nodes.get(key)!.layer;
    expect(['in', 'record', 'line', 'tone', 'feedback'].map(layer)).toEqual([0, 1, 2, 3, 4]);
    expect(overlaps(result)).toEqual([]);

    // The returning edge starts at the right of `feedback`, ends at the left of `record`, and on the
    // way runs in rows of its own, clear of every node.
    const route = result.edges.get('feedback>record')!.points;
    const feedback = result.nodes.get('feedback')!;
    const record = result.nodes.get('record')!;
    expect(route[0]).toEqual({ x: feedback.x + feedback.width, y: feedback.y + 20 });
    expect(route[route.length - 1]).toEqual({ x: record.x, y: record.y + 20 });
    for (const point of route.slice(1, -1)) {
      for (const [key, box] of result.nodes) {
        const inside =
          point.x > box.x &&
          point.x < box.x + box.width &&
          point.y > box.y &&
          point.y < box.y + box.height;
        expect(inside, `lane point inside ${key}`).toBe(false);
      }
    }
  });

  it('lays out a loop with no way in, and a node connected to itself', () => {
    const result = layout(nodes('a', 'b', 'c'), [...chain('a', 'b', 'c', 'a'), edge('b', 'b')]);
    expect(result.nodes.size).toBe(3);
    expect([...result.edges.values()].filter((route) => route.reversed)).toHaveLength(1);
    expect(result.edges.has('b>b')).toBe(false);
    expect(overlaps(result)).toEqual([]);
  });

  it('cuts a loop at an ordinary edge, not at a modulation edge into it', () => {
    // An lfo modulating a node inside a loop must not decide where the loop is opened.
    const result = layout(
      [{ ...node('lfo'), float: true }, ...nodes('in', 'a', 'b', 'c')],
      [edge('lfo', 'b', true), ...chain('in', 'a', 'b', 'c'), edge('c', 'a')],
    );
    expect(result.edges.get('c>a')!.reversed).toBe(true);
    expect(result.edges.get('lfo>b')!.reversed).toBe(false);
    // A floating source sits in the column just before what it feeds.
    expect(result.nodes.get('lfo')!.layer).toBe(result.nodes.get('b')!.layer - 1);
  });

  it('reverses a weak edge rather than an ordinary one when the two make a loop', () => {
    const result = layout(nodes('a', 'b'), [edge('a', 'b'), edge('b', 'a', true)]);
    expect(result.edges.get('a>b')!.reversed).toBe(false);
    expect(result.edges.get('b>a')!.reversed).toBe(true);
  });

  it('gives an edge that skips columns a lane clear of the nodes it passes', () => {
    const result = layout(nodes('a', 'b', 'c', 'd'), [
      ...chain('a', 'b', 'c', 'd'),
      edge('a', 'd'),
    ]);
    const route = result.edges.get('a>d')!.points;
    // Two points per column crossed, plus the two ends.
    expect(route).toHaveLength(6);
    for (const key of ['b', 'c']) {
      const box = result.nodes.get(key)!;
      const lane = route.filter((point) => point.x >= box.x && point.x <= box.x + box.width);
      expect(lane.length).toBeGreaterThan(0);
      for (const point of lane) {
        expect(point.y <= box.y || point.y >= box.y + box.height).toBe(true);
      }
    }
  });

  it('ignores edges to nodes it was not given', () => {
    const result = layout(nodes('a'), [edge('a', 'missing'), edge('missing', 'a')]);
    expect(result.nodes.size).toBe(1);
    expect(result.edges.size).toBe(0);
  });

  it('lays out nothing as an empty box', () => {
    expect(layout([], []).bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('is deterministic, and keeps 60 nodes with loops and fan-out apart', () => {
    const build = (): { nodes: LayoutNode[]; edges: LayoutEdge[] } => {
      const random = seeded(7);
      const list = Array.from({ length: 60 }, (_, i) =>
        node(`n${i}`, 80 + Math.floor(random() * 60), 30 + Math.floor(random() * 20)),
      );
      const edges: LayoutEdge[] = [];
      for (let i = 1; i < 60; i++) {
        // Mostly forward edges from a recent node, with fan-out, and a few edges back to make loops.
        edges.push(edge(`n${Math.max(0, i - 1 - Math.floor(random() * 4))}`, `n${i}`));
        if (random() < 0.3) edges.push(edge(`n${Math.floor(random() * i)}`, `n${i}`));
        if (random() < 0.1) edges.push(edge(`n${i}`, `n${Math.floor(random() * i)}`));
      }
      return { nodes: list, edges };
    };
    const first = build();
    const started = performance.now();
    const a = layout(first.nodes, first.edges);
    const took = performance.now() - started;
    const second = build();
    const b = layout(second.nodes, second.edges);
    expect([...a.nodes.entries()]).toEqual([...b.nodes.entries()]);
    expect([...a.edges.entries()]).toEqual([...b.edges.entries()]);
    expect(a.nodes.size).toBe(60);
    expect(overlaps(a)).toEqual([]);
    expect([...a.edges.values()].some((route) => route.reversed)).toBe(true);
    // Generous: it takes a few milliseconds. This only catches it going quadratic or worse.
    expect(took).toBeLessThan(500);
  });
});

describe('layout with earlier positions', () => {
  const before = (): { nodes: LayoutNode[]; edges: LayoutEdge[] } => ({
    nodes: nodes('kick', 'snare', 'gain', 'drums', 'bass', 'filter', 'main'),
    edges: [
      edge('kick', 'drums'),
      ...chain('snare', 'gain', 'drums', 'main'),
      ...chain('bass', 'filter', 'main'),
    ],
  });
  const positions = (result: LayoutResult) =>
    new Map([...result.nodes].map(([key, box]) => [key, { x: box.x, y: box.y }]));

  it('gives the same layout back when nothing changed', () => {
    const { nodes: list, edges } = before();
    const first = layout(list, edges);
    const again = layout(list, edges, { previous: positions(first) });
    expect(positions(again)).toEqual(positions(first));
  });

  it('leaves every node where it was when a new chain is added', () => {
    const { nodes: list, edges } = before();
    const first = layout(list, edges);
    const grown = layout(
      [...list, ...nodes('hat', 'highpass')],
      [...edges, ...chain('hat', 'highpass', 'drums')],
      { previous: positions(first) },
    );
    for (const [key, at] of positions(first)) {
      expect({ x: grown.nodes.get(key)!.x, y: grown.nodes.get(key)!.y }, key).toEqual(at);
    }
    expect(grown.nodes.has('hat')).toBe(true);
    expect(overlaps(grown)).toEqual([]);
  });

  it('keeps rows, and what is upstream, when a node is put into a chain', () => {
    const { nodes: list, edges } = before();
    const first = layout(list, edges);
    // bass -> filter becomes bass -> drive -> filter.
    const grown = layout(
      [...list, node('drive')],
      [
        ...edges.filter((item) => item.key !== 'bass>filter'),
        edge('bass', 'drive'),
        edge('drive', 'filter'),
      ],
      { previous: positions(first) },
    );
    for (const [key, at] of positions(first)) {
      expect(grown.nodes.get(key)!.y, `${key} row`).toBe(at.y);
    }
    for (const key of ['kick', 'snare', 'gain', 'bass']) {
      expect(grown.nodes.get(key)!.x, `${key} column`).toBe(positions(first).get(key)!.x);
    }
    expect(grown.nodes.get('drive')!.layer).toBe(1);
    expect(grown.nodes.get('drive')!.y).toBe(grown.nodes.get('bass')!.y);
    expect(overlaps(grown)).toEqual([]);
  });

  it('closes the gap of a removed node only by leaving the others alone', () => {
    const { nodes: list, edges } = before();
    const first = layout(list, edges);
    const shrunk = layout(
      list.filter((item) => item.key !== 'kick'),
      edges.filter((item) => item.from !== 'kick'),
      { previous: positions(first) },
    );
    for (const [key, box] of shrunk.nodes) {
      expect({ x: box.x, y: box.y }, key).toEqual(positions(first).get(key));
    }
  });

  it('moves a kept node only as far as a node that grew needs', () => {
    const { nodes: list, edges } = before();
    const first = layout(list, edges);
    // `gain` becomes tall, as a macro does when it is opened in place.
    const grown = layout(
      list.map((item) => (item.key === 'gain' ? node('gain', 300, 200) : item)),
      edges,
      { previous: positions(first) },
    );
    expect(overlaps(grown)).toEqual([]);
    expect(grown.nodes.get('kick')!.y).toBe(first.nodes.get('kick')!.y);
  });
});

describe('separate', () => {
  it('leaves positions that do not collide alone', () => {
    expect(separate([0, 100, 200], [40, 40, 40], 10)).toEqual([0, 100, 200]);
  });

  it('spreads collisions evenly about where they wanted to be', () => {
    expect(separate([100, 100], [40, 40], 10)).toEqual([75, 125]);
  });
});

describe('edgePath', () => {
  it('draws a curve that leaves and arrives level', () => {
    const path = edgePath({
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 50 },
      ],
      reversed: false,
    });
    expect(path).toBe('M0 0 C50 0 50 50 100 50');
  });

  it('draws a lane as a straight run', () => {
    const path = edgePath({
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 50 },
        { x: 200, y: 50 },
        { x: 300, y: 0 },
      ],
      reversed: false,
    });
    expect(path).toContain('L200 50');
  });

  it('turns a returning edge round outside its ends', () => {
    const path = edgePath({
      points: [
        { x: 300, y: 0 },
        { x: 300, y: 60 },
        { x: 0, y: 60 },
        { x: 0, y: 0 },
      ],
      reversed: true,
    });
    const numbers = path.match(/-?\d+(\.\d+)?/g)!.map(Number);
    expect(Math.max(...numbers)).toBeGreaterThan(300);
    expect(Math.min(...numbers)).toBeLessThan(0);
    expect(path).toContain('L0 60');
  });
});
