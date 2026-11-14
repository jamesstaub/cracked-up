import { describe, expect, it } from 'vitest';
import type { ScopeApi } from '../../src';
import { offlineEngine, ones, SAMPLE_RATE } from './setup';

/**
 * Pins what a host that keeps its own control values relies on: a script makes a node with one
 * value and then, at top level of the same build, sets the parameter to another (the value of the
 * host's control). Re-running the unchanged script while the node already holds that value must
 * not move the parameter at any point.
 */
describe('build: a top-level set after the node, re-run unchanged', () => {
  const script = (__: ScopeApi): void => {
    __().sampler({ id: 'dc', buffer: 'ones' }).gain({ id: 'level', gain: 0.8 }).to('main');
    __().sine({ id: 'osc' }).lowpass({ id: 'filter', frequency: 2000 }).gain(0).to('main');
    __('#level').set({ gain: 0.3 });
    __('#filter').set({ frequency: 900 });
  };

  /** Renders 0.3 s. With `rerunAt`, the script is run again that many seconds in. */
  async function render(rerunAt: number | null) {
    const engine = await offlineEngine(0.3);
    engine.buffers.add('ones', ones(0.3));
    const scope = engine.scope('live');
    await scope.build(script);
    scope.select('#dc').trigger({ at: 0 });
    const changes: string[] = [];
    let result: Awaited<ReturnType<typeof scope.build>> | null = null;
    const rerun = async (): Promise<void> => {
      scope.on('param:changed', (change) =>
        changes.push(`${change.param.node.id}.${change.param.name}=${String(change.value)}`),
      );
      result = await scope.build(script);
    };
    if (rerunAt !== null) {
      const context = engine.context as OfflineAudioContext;
      if (typeof context.suspend === 'function') {
        // Stop the render part-way, as a live edit would arrive, and run the script again there.
        void context.suspend(rerunAt).then(async () => {
          await rerun();
          void context.resume();
        });
      } else {
        // Firefox cannot pause an offline render: there the script is run again before it starts.
        await rerun();
      }
    }
    const audio = (await engine.render()).getChannelData(0).slice();
    return {
      audio,
      changes,
      result: result as Awaited<ReturnType<typeof scope.build>> | null,
      scope,
    };
  }

  it('does not move the parameter: same samples, no param:changed, node unchanged', async () => {
    const once = await render(null);
    const rerun = await render(0.1);

    expect(rerun.scope.select('#level').param('gain').value).toBe(0.3);
    expect(rerun.scope.select('#filter').param('frequency').value).toBe(900);
    // No change event of any kind during the re-run.
    expect(rerun.changes).toEqual([]);
    expect(rerun.result?.added.length).toBe(0);
    expect(rerun.result?.removed.length).toBe(0);
    expect(rerun.result?.updated.map((node) => node.id)).toEqual([]);

    // The constant through the gain reads 0.3 on every sample, before, at and after the re-run.
    const at = Math.round(0.1 * SAMPLE_RATE);
    let worst = 0;
    for (let i = 0; i < rerun.audio.length; i++) {
      worst = Math.max(worst, Math.abs(rerun.audio[i]! - once.audio[i]!));
    }
    expect(worst).toBe(0);
    // The first run too: the node is made with 0.8 and set to 0.3 in the same turn, and 0.8 is never heard.
    expect(once.audio[0]).toBeCloseTo(0.3, 6);
    expect(Math.max(...once.audio)).toBeCloseTo(0.3, 6);
    for (const index of [at - 1, at, at + 1, at + 128, at + 1024]) {
      expect(rerun.audio[index]).toBeCloseTo(0.3, 6);
    }
  });
});
