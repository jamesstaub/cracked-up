import { describe, expect, it } from 'vitest';
import { exampleFor } from '../../demo/examples';
import { offlineEngine, ones } from '../core/setup';

/**
 * The docs page shows one generated example per node type. Each must run as written, against the
 * same names the live demo provides (`__`, `t`, and the 'kick' / 'snare' / 'hat' buffers).
 */
describe('docs examples', () => {
  it('runs the generated example for every registered node type', async () => {
    const types = (await offlineEngine(0.01)).registry.list();
    expect(types.length).toBeGreaterThan(10);
    const failures: string[] = [];
    for (const info of types) {
      const engine = await offlineEngine(1);
      for (const name of ['kick', 'snare', 'hat']) engine.buffers.add(name, ones(0.05));
      const errors: string[] = [];
      engine.on('error', (error) => errors.push(error.message));
      try {
        new Function('__', 't', 'engine', exampleFor(info))(engine.$, engine.transport, engine);
        engine.transport.start();
        await engine.render();
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
      if (errors.length > 0) failures.push(`${info.type}: ${errors[0]}`);
    }
    expect(failures).toEqual([]);
  });
});
