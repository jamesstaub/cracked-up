import { describe, expect, it } from 'vitest';
import { offlineEngine } from './setup';

describe('build: parameters the code sets itself', () => {
  it('a set or ramp after the node has the last word, the first time and on every re-run', async () => {
    const engine = await offlineEngine(0.1);
    const scope = engine.scope('live');
    const frequency = () => scope.select('#filter').param('frequency').value;
    const q = () => scope.select('#filter').param('q').value;
    const withSet = (api: Parameters<Parameters<typeof scope.build>[0]>[0]) => {
      api().lowpass({ id: 'filter', frequency: 500, q: 2 }).to('main');
      api('#filter').set({ frequency: 900 });
      api('#filter').param('q').ramp(8, { duration: 0.01 });
    };
    await scope.build(withSet);
    expect([frequency(), q()]).toEqual([900, 8]);
    // Run again unchanged: the node is kept, and the values are still the ones set last.
    const again = await scope.build(withSet);
    expect(again.added.length).toBe(0);
    expect([frequency(), q()]).toEqual([900, 8]);

    // Take the set and the ramp out, and the node goes to what it is made with.
    await scope.build((api) => {
      api().lowpass({ id: 'filter', frequency: 500, q: 2 }).to('main');
    });
    expect([frequency(), q()]).toEqual([500, 2]);
  });
});
