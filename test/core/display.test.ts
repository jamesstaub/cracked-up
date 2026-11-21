import { describe, expect, it } from 'vitest';
import type { SequenceEvent } from '../../src';
import { liveEngine, wait } from '../inspect/util';
import { offlineEngine } from './setup';

/**
 * `transport.onDisplay`: a call on an animation frame once a sequence's step is heard, for moving a
 * playhead. It needs a live context (an offline render has no "now" to be heard at), so these tests
 * stop early where the browser will not start audio without a click.
 */
describe('transport.onDisplay', () => {
  it('calls back with each step whose function ran, once it is heard, in order', async (ctx) => {
    const { engine, context, running } = await liveEngine();
    if (!running) ctx.skip();
    try {
      engine.transport.bpm = 240;
      const given: SequenceEvent[] = [];
      engine.transport.sequence('beat', { steps: [1, 2, 3, 4], step: '1/16' }, (ev) => {
        given.push(ev);
      });
      const shown: { event: SequenceEvent; at: number }[] = [];
      engine.transport.onDisplay((event) => {
        // what the page hears now: the context's clock less the output's own delay
        shown.push({ event, at: context.currentTime - (context.outputLatency ?? 0) });
      });
      engine.transport.start();
      await wait(700);
      engine.transport.stop();

      expect(shown.length).toBeGreaterThanOrEqual(4);
      // The same events the sequence's function was given, none of them before its time.
      for (const { event, at } of shown) {
        expect(given).toContain(event);
        expect(at).toBeGreaterThanOrEqual(event.time - 1e-6);
      }
      const times = shown.map(({ event }) => event.time);
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(shown.slice(0, 4).map(({ event }) => event.value)).toEqual([1, 2, 3, 4]);
    } finally {
      engine.dispose();
      await context.close();
    }
  });

  it('shows only steps whose function runs: no rests left out, no muted sequence, no every() or at()', async (ctx) => {
    const { engine, context, running } = await liveEngine();
    if (!running) ctx.skip();
    try {
      engine.transport.bpm = 240;
      engine.transport.sequence(
        'sparse',
        { steps: [1, 0, 0, 0], step: '1/16', rests: false },
        () => undefined,
      );
      const muted = engine.transport.sequence('muted', { steps: 4, step: '1/16' }, () => undefined);
      muted.muted = true;
      engine.transport.every('1/16', () => undefined);
      engine.transport.at(0.25, () => undefined);
      const shown: SequenceEvent[] = [];
      engine.transport.onDisplay((event) => shown.push(event));
      engine.transport.start();
      await wait(700);
      engine.transport.stop();

      expect(shown.length).toBeGreaterThan(0);
      for (const event of shown) {
        expect(event.sequence.name).toBe('sparse');
        expect(event.value).toBe(1);
      }
    } finally {
      engine.dispose();
      await context.close();
    }
  });

  it('stops calling once unsubscribed; a listener that throws does not stop the others', async (ctx) => {
    const { engine, context, running } = await liveEngine();
    if (!running) ctx.skip();
    const logged = console.error;
    const errors: unknown[] = [];
    console.error = (...args: unknown[]) => void errors.push(args);
    try {
      engine.transport.bpm = 240;
      engine.transport.sequence('beat', { steps: 4, step: '1/16' }, () => undefined);
      let gone = 0;
      let kept = 0;
      engine.transport.onDisplay(() => {
        throw new Error('drawing failed');
      });
      const stop = engine.transport.onDisplay(() => gone++);
      engine.transport.onDisplay(() => kept++);
      stop();
      engine.transport.start();
      await wait(500);
      engine.transport.stop();

      expect(gone).toBe(0);
      expect(kept).toBeGreaterThan(0);
      expect(errors.length).toBeGreaterThan(0);
    } finally {
      console.error = logged;
      engine.dispose();
      await context.close();
    }
  });

  it('never calls back while rendering offline', async () => {
    const engine = await offlineEngine(0.5);
    engine.transport.bpm = 240;
    engine.transport.sequence('beat', { steps: 4, step: '1/16' }, () => undefined);
    let shown = 0;
    engine.transport.onDisplay(() => shown++);
    engine.transport.start();
    await engine.render();
    await wait(50);
    expect(shown).toBe(0);
  });
});
