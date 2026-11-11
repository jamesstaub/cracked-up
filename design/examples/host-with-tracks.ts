/**
 * Example 2: a host application with tracks (what Euclip will do).
 * "Track" is the host's idea; the library only sees scopes.
 */

import { createEngine } from '../api';
import type { Command, Engine, GraphData, NumberParamMeta, Scope } from '../api';

declare const sliderForTrack: (
  trackId: string,
  nodeId: string,
  meta: NumberParamMeta,
  onInput: (v: number) => void,
) => void;
declare const runSandboxedScript: (
  trackId: string,
  event: { index: number; value: number; time: number },
) => Command[];

export async function main(): Promise<void> {
  const engine = await createEngine({ context: new AudioContext() });

  // A shared send effect on the root scope.
  engine.bus('reverb-send');
  engine.chain().reverb({ id: 'hall', seconds: 2.5, mix: 1 }).to('main');
  engine.bus('reverb-send').to('main');

  const kick = await addTrack(engine, 'track-a', '/samples/kick.wav');
  const snare = await addTrack(engine, 'track-b', '/samples/snare.wav');

  // Both tracks use the id `filter`. Each scope has its own namespace, so there is no collision,
  // and each track's `__` only ever sees its own nodes.
  kick.select('#filter').set({ frequency: 200 });
  snare.select('#filter').set({ frequency: 4000 });

  // --- Controls generated from metadata ---------------------------------------------------------
  for (const node of kick.select('*')) {
    for (const meta of engine.registry.describe(node.type).params) {
      if (meta.kind !== 'number') continue;
      const param = node.param(meta.name);
      sliderForTrack('track-a', node.id, meta, (position) => param.setNormalized(position));
      // The host mirrors base-value changes (from scripts, MIDI learn, or another collaborator) back to the UI.
      param.on('change', (change) => console.log(node.id, meta.name, change.value));
    }
  }

  // --- Editing a chain from the UI: the graph is data ---------------------------------------------
  // "Add a bitcrusher after the filter" is an edit to the description, then a reconcile.
  const before = kick.describe();
  const after: GraphData = {
    nodes: [...before.nodes, { id: 'crush', type: 'bitcrusher', params: { bits: 6 } }],
    edges: before.edges.flatMap((edge) =>
      edge.from === 'filter'
        ? [
            { from: 'filter', to: { node: 'crush' } },
            { from: 'crush', to: edge.to },
          ]
        : [edge],
    ),
  };
  const result = await kick.apply(after);
  // The sampler, filter and gain were never rebuilt and kept sounding.
  console.log(
    result.added.map((n) => n.id),
    result.unchanged.map((n) => n.id),
    result.errors,
  );

  // --- Sequencing per track, each at its own rate -------------------------------------------------
  const t = engine.transport;
  t.bpm = 120;

  t.sequence('track-a', { steps: [1, 0, 0, 0, 1, 0, 0, 0], step: '1/16' }, (ev) => {
    if (ev.value) kick.select('sampler').trigger({ at: ev.time });
  });

  // Triplet eighths against sixteenths: any ratio, not only 0.25x to 4x.
  t.sequence('track-b', { steps: [0, 0, 1], step: '1/8t' }, (ev) => {
    // A sandboxed play script returns commands; the host applies them. See design/README.md.
    snare.dispatch(
      runSandboxedScript('track-b', { index: ev.index, value: ev.value, time: ev.time }),
    );
  });

  // Playheads follow what is heard, not the look-ahead.
  t.onDisplay((ev) => console.log(ev.sequence.name, ev.index));

  await engine.resume();
  t.start();

  // Deleting a track removes its nodes, buses and sequences in one call.
  snare.dispose();
}

async function addTrack(engine: Engine, id: string, sample: string): Promise<Scope> {
  const track = engine.scope(id);
  const pool = engine.buffers.load(sample);

  // The setup "script". Run again after an edit, only what changed is rebuilt.
  await track.build((__) => {
    __()
      .sampler({ id: 'source', buffer: pool })
      .lowpass({ id: 'filter', frequency: 2000 })
      .gain({ id: 'level', gain: 0.8 })
      .split(
        (dry) => dry.to('main'),
        (wet) => wet.gain({ id: 'send', gain: 0.2, tags: { role: 'send' } }).to('reverb-send'),
      );
  });

  track.on('error', (error) => console.warn(id, error.code, error.message));
  return track;
}
