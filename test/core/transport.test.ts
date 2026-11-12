import { describe, expect, it } from 'vitest';
import type { Engine, GraphError, SequenceEvent } from '../../src';
import { euclid } from '../../src/util';
import { findOnsets } from '../helpers';
import { click, offlineEngine } from './setup';

/** An engine whose `#hit` sampler plays a one-sample click, so each trigger shows up as one onset. */
async function clicker(seconds: number): Promise<Engine> {
  const engine = await offlineEngine(seconds);
  engine.chain().sampler({ id: 'hit', buffer: click() }).to('main');
  return engine;
}

async function onsets(engine: Engine): Promise<number[]> {
  return findOnsets(await engine.render(), { threshold: 0.5, minGapSamples: 2 });
}

// At 120 bpm and 48 kHz: a beat is 24000 samples, a sixteenth 6000, a bar 96000.
describe('transport', () => {
  it('steps() fires on the default sixteenth grid, landing triggers on exact samples', async () => {
    const engine = await clicker(1);
    engine.transport.steps('x.x...x.', (_index, value) => {
      // No `at`: inside a callback, operations happen at the event's time.
      if (value) engine.select('#hit').trigger();
    });
    engine.transport.start();
    expect(await onsets(engine)).toEqual([0, 12000, 36000]);
  });

  it('accepts a pattern as an array or a string, with the same result', async () => {
    const fromArray = await clicker(1);
    fromArray.transport.sequence({ steps: [1, 0, 0, 1], step: '1/8' }, (ev) => {
      if (ev.value) fromArray.select('#hit').trigger();
    });
    fromArray.transport.start();

    const fromString = await clicker(1);
    fromString.transport.sequence({ steps: 'x..x', step: '1/8' }, (ev) => {
      if (ev.value) fromString.select('#hit').trigger();
    });
    fromString.transport.start();

    const expected = [0, 36000];
    expect(await onsets(fromArray)).toEqual(expected);
    expect(await onsets(fromString)).toEqual(expected);
  });

  it('plays polyrhythms: three and four evenly across the same bar', async () => {
    const three = await clicker(2);
    three.transport.sequence({ steps: 3, span: '1 bar' }, () => three.select('#hit').trigger());
    three.transport.start();
    expect(await onsets(three)).toEqual([0, 32000, 64000]);

    const four = await clicker(2);
    four.transport.sequence({ steps: 4, span: '1 bar' }, () => four.select('#hit').trigger());
    four.transport.start();
    expect(await onsets(four)).toEqual([0, 24000, 48000, 72000]);
  });

  it('plays triplets and dotted steps', async () => {
    const triplets = await clicker(0.5);
    triplets.transport.sequence({ steps: 1, step: '1/8t' }, () =>
      triplets.select('#hit').trigger(),
    );
    triplets.transport.start();
    expect(await onsets(triplets)).toEqual([0, 8000, 16000]);

    const dotted = await clicker(1);
    dotted.transport.sequence({ steps: 1, step: '1/8d' }, () => dotted.select('#hit').trigger());
    dotted.transport.start();
    expect(await onsets(dotted)).toEqual([0, 18000, 36000]);
  });

  it('swing delays every second step', async () => {
    const engine = await clicker(1);
    engine.transport.sequence({ steps: 1, step: '1/8', swing: 0.6 }, () => {
      engine.select('#hit').trigger();
    });
    engine.transport.start();
    // Pairs of eighths last 24000 samples; the second of each pair sits 60% of the way through.
    expect(await onsets(engine)).toEqual([0, 14400, 24000, 38400]);
  });

  it('offset shifts a sequence later', async () => {
    const engine = await clicker(1);
    engine.transport.sequence({ steps: 1, step: '1/4', offset: '1/16' }, () => {
      engine.select('#hit').trigger();
    });
    engine.transport.start();
    expect(await onsets(engine)).toEqual([6000, 30000]);
  });

  it('describes each event: index, value, cycle, position, duration and sub-step times', async () => {
    const engine = await clicker(2);
    const seen: SequenceEvent[] = [];
    engine.transport.sequence({ steps: [1, 0, 2], step: '1/4' }, (ev) => seen.push(ev));
    engine.transport.start();
    await engine.render();
    expect(seen.map((ev) => [ev.index, ev.value, ev.cycle, ev.beat, ev.bar, ev.time])).toEqual([
      [0, 1, 0, 0, 0, 0],
      [1, 0, 0, 1, 0, 0.5],
      [2, 2, 0, 2, 0, 1],
      [0, 1, 1, 3, 0, 1.5],
    ]);
    expect(seen[1]?.duration).toBeCloseTo(0.5, 12);
    expect(seen[1]?.at(0.5)).toBeCloseTo(0.75, 12);
    expect(seen[0]?.steps).toEqual([1, 0, 2]);
  });

  it('skips rests on request, honours probability, and can be muted', async () => {
    const engine = await clicker(1);
    const calls = { all: 0, hitsOnly: 0, never: 0, muted: 0 };
    engine.transport.sequence({ steps: 'x.x.' }, () => calls.all++);
    engine.transport.sequence({ steps: 'x.x.', rests: false }, () => calls.hitsOnly++);
    engine.transport.sequence({ steps: 'xxxx', probability: 0 }, () => calls.never++);
    engine.transport.sequence({ steps: 'xxxx' }, () => calls.muted++).muted = true;
    engine.transport.start();
    await engine.render();
    expect(calls).toEqual({ all: 8, hitsOnly: 4, never: 0, muted: 0 });
  });

  it('draws probability from the seeded source, so a render repeats exactly', async () => {
    const run = async () => {
      const engine = await clicker(2);
      engine.transport.sequence({ steps: 1, probability: 0.5 }, () =>
        engine.select('#hit').trigger(),
      );
      engine.transport.start();
      return onsets(engine);
    };
    const first = await run();
    expect(first.length).toBeGreaterThan(2);
    expect(first.length).toBeLessThan(16);
    expect(await run()).toEqual(first);
  });

  it('works with euclid()', async () => {
    const engine = await clicker(1);
    engine.transport.sequence({ steps: euclid(3, 8) }, (ev) => {
      if (ev.value) engine.select('#hit').trigger();
    });
    engine.transport.start();
    expect(await onsets(engine)).toEqual([0, 18000, 36000]);
  });

  it('a named sequence evaluated again replaces the first, in place and in phase', async () => {
    const engine = await clicker(2);
    const t = engine.transport;
    const first = t.sequence('part', { steps: 1, step: '1/4' }, () =>
      engine.select('#hit').trigger(),
    );
    // One bar in (beat 2 of the render at 120 bpm is 1 second), re-evaluate with a different pattern.
    t.at('1/2', () => {
      const second = t.sequence('part', { steps: [0, 1], step: '1/8' }, (ev) => {
        if (ev.value) engine.select('#hit').trigger();
      });
      expect(second).toBe(first);
    });
    t.start();
    // Quarter notes up to and including beat 2 (the sequence was made before the at(), so at beat 2 it
    // plays first and is then replaced), then the off-beat eighths of the new pattern.
    expect(await onsets(engine)).toEqual([0, 24000, 48000, 60000, 84000]);
    expect(t.get('part')).toBe(first);
  });

  it('a tempo change applies from the event that makes it', async () => {
    const engine = await clicker(2);
    const t = engine.transport;
    t.sequence({ steps: 1, step: '1/4' }, () => engine.select('#hit').trigger());
    t.at('1/2', () => {
      t.bpm = 240;
    });
    t.start();
    // Beats 0 and 1 at 120 bpm; from beat 2 (1 second) a beat lasts 12000 samples.
    expect(await onsets(engine)).toEqual([0, 24000, 48000, 60000, 72000, 84000]);
    expect(t.bpm).toBe(240);
  });

  it('loops a region, returning to its start at the exact sample', async () => {
    const engine = await clicker(2);
    const t = engine.transport;
    // Hits on beats 0 and 3; the loop covers beats 0 to 2, so only the first is ever reached.
    t.sequence({ steps: [1, 0, 0, 1], step: '1/4' }, (ev) => {
      if (ev.value) engine.select('#hit').trigger();
    });
    t.loop = { start: 0, end: '1/2' };
    t.start();
    expect(await onsets(engine)).toEqual([0, 48000]);
  });

  it('at() fires once and every() repeats, in ascending order when they coincide', async () => {
    const engine = await clicker(1);
    const t = engine.transport;
    const log: string[] = [];
    t.every('1/4', (ev) => log.push(`late@${ev.beat}`), { order: 5 });
    t.every('1/4', (ev) => log.push(`early@${ev.beat}`), { order: -5 });
    t.at('1/4', (ev) => log.push(`once@${ev.beat}`));
    const cancel = t.at('1/8', () => log.push('cancelled'));
    cancel();
    t.start();
    await engine.render();
    expect(log).toEqual(['early@0', 'late@0', 'early@1', 'once@1', 'late@1']);
  });

  it('setStep, update, restart and stop change a running sequence', async () => {
    const engine = await clicker(2);
    const t = engine.transport;
    const sequence = t.sequence({ steps: [1, 0, 0, 0], step: '1/4' }, (ev) => {
      if (ev.value) engine.select('#hit').trigger();
    });
    t.at(1, () => sequence.setStep(2, 1)); // adds a hit on beat 2
    t.at(2.5, () => sequence.restart()); // the next step (beat 3) becomes the pattern's first
    t.start();
    expect(await onsets(engine)).toEqual([0, 48000, 72000]);
    expect(sequence.steps).toEqual([1, 0, 1, 0]);

    const stopping = await clicker(1);
    const s = stopping.transport.sequence({ steps: 1, step: '1/8' }, () =>
      stopping.select('#hit').trigger(),
    );
    stopping.transport.at('1/4', () => s.stop());
    stopping.transport.start();
    // The step on beat 1 plays, then the at() made after the sequence stops it.
    expect(await onsets(stopping)).toEqual([0, 12000, 24000]);

    const updating = await clicker(1);
    let calls = 0;
    const u = updating.transport.sequence({ steps: 1, step: '1/4' }, () => {
      calls++;
      updating.select('#hit').trigger();
    });
    updating.transport.at('1/4', () => u.update({ step: '1/8' }));
    updating.transport.start();
    // The quarter-note hit at beat 1 has just played; eighths follow from there, still on the grid.
    expect(await onsets(updating)).toEqual([0, 24000, 36000]);
    // The step at beat 1 was delivered once, not again after the update.
    expect(calls).toBe(3);
  });

  it('clear removes one named sequence or everything', async () => {
    const engine = await clicker(1);
    const t = engine.transport;
    let kept = 0;
    t.sequence('a', { steps: 1 }, () => engine.select('#hit').trigger());
    t.sequence('b', { steps: 1, step: '1/4' }, () => kept++);
    t.clear('a');
    expect(t.get('a')).toBeUndefined();
    t.start();
    expect(await onsets(engine)).toEqual([]);
    expect(kept).toBe(2);

    const all = await clicker(1);
    all.transport.sequence({ steps: 1 }, () => all.select('#hit').trigger());
    all.transport.clear();
    all.transport.start();
    expect(await onsets(all)).toEqual([]);
  });

  it('starts at a time and position, and pause keeps the position for the next start', async () => {
    const engine = await clicker(2);
    const t = engine.transport;
    t.sequence({ steps: 1, step: '1/4' }, () => engine.select('#hit').trigger());
    t.start({ at: 0.25, from: 1 });
    t.pause({ at: 0.75 }); // one beat later: position 2
    expect(t.state).toBe('paused');
    expect(t.position.beats).toBeCloseTo(2, 9);
    t.start({ at: 1.5 });
    expect(await onsets(engine)).toEqual([12000, 72000]);

    t.stop();
    expect(t.state).toBe('stopped');
    expect(t.position.beats).toBe(0);
  });

  it('a callback that throws is reported, and the rest carry on', async () => {
    const engine = await clicker(1);
    const errors: GraphError[] = [];
    engine.on('error', (error) => errors.push(error));
    engine.transport.sequence({ steps: 1, step: '1/4' }, () => {
      throw new Error('boom');
    });
    engine.transport.sequence({ steps: 1, step: '1/4' }, () => engine.select('#hit').trigger());
    engine.transport.start();
    expect(await onsets(engine)).toEqual([0, 24000]);
    expect(errors.map((error) => error.code)).toEqual(['callback', 'callback']);
    expect(errors[0]?.message).toContain('boom');
  });

  it('converts between positions, durations and audio time', async () => {
    const engine = await offlineEngine(1);
    const t = engine.transport;
    expect(t.seconds('1/4')).toBeCloseTo(0.5, 12);
    expect(t.seconds('1 bar')).toBeCloseTo(2, 12);
    t.timeSignature = [3, 4];
    expect(t.seconds('1 bar')).toBeCloseTo(1.5, 12);
    t.bpm = 60;
    expect(t.seconds(1)).toBe(1);
    t.start({ at: 0.5 });
    expect(t.toAudioTime(2)).toBeCloseTo(2.5, 12);
    expect(t.toBeats(1.5)).toBeCloseTo(1, 12);
  });

  it('rejects settings that make no sense', async () => {
    const t = (await offlineEngine(0.1)).transport;
    expect(() => (t.bpm = 0)).toThrowError(RangeError);
    expect(() => (t.swing = 1)).toThrowError(RangeError);
    expect(() => (t.loop = { start: 1, end: 1 })).toThrowError(RangeError);
    expect(() => t.sequence({ steps: 0 }, () => {})).toThrowError(RangeError);
    expect(() => t.sequence({ steps: 4, step: '1/8', span: '1 bar' }, () => {})).toThrowError(
      RangeError,
    );
    expect(() => t.sequence({ steps: 'x.y' }, () => {})).toThrowError(RangeError);
  });

  it('transport and sequence commands work through dispatch', async () => {
    const engine = await clicker(1);
    const t = engine.transport;
    t.sequence('part', { steps: [1, 0, 0, 0], step: '1/8' }, (ev) => {
      if (ev.value) engine.select('#hit').trigger();
    });
    engine.root.dispatch([
      { op: 'setStep', name: 'part', index: 1, value: 1 },
      { op: 'transport', set: { bpm: 60 } },
    ]);
    t.start();
    // At 60 bpm an eighth is 24000 samples: steps 0 and 1 fall inside the one-second render.
    expect(await onsets(engine)).toEqual([0, 24000]);
    engine.root.dispatch([{ op: 'clearSequence', name: 'part' }]);
    expect(t.get('part')).toBeUndefined();
  });
});
