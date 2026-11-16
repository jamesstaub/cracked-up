import { describe, expect, it } from 'vitest';
import type { Engine, GraphError, Sequence, SequenceEvent } from '../../src';
import { click, makeBuffer, offlineEngine, valueAt } from './setup';

/** A buffer whose every sample is its own time in seconds, so a voice shows where it started from. */
const ramp = (): AudioBuffer => makeBuffer(1, (_index, time) => time);

/** An engine with a `#hit` sampler to trigger from callbacks whose sound does not matter. */
async function clicker(seconds: number): Promise<Engine> {
  const engine = await offlineEngine(seconds);
  engine.chain().sampler({ id: 'hit', buffer: click() }).to('main');
  return engine;
}

const nothing = (): void => undefined;

// At 120 bpm: a beat lasts 0.5 s, an eighth 0.25 s, a sixteenth 0.125 s.

describe("sequence.on('step')", () => {
  it('runs before the callback, so a value a listener sets is the one the voice of that step reads', async () => {
    const starts = [0.1, 0.5, 0.3, 0.8];
    const render = async (follow: boolean) => {
      const engine = await offlineEngine(1);
      engine.chain().sampler({ id: 's', buffer: ramp() }).to('main');
      const sampler = engine.select('#s');
      // The script: it triggers, and knows nothing of per-step values.
      const sequence = engine.transport.sequence('steps', { steps: 4, step: '1/8' }, () => {
        sampler.trigger();
      });
      // The host: it did not make the sequence, and gives each step its own start.
      if (follow) {
        engine.transport.get('steps')!.on('step', (ev) => {
          sampler.set({ start: starts[ev.index]! }, { at: ev.time });
        });
      }
      expect(engine.transport.get('steps')).toBe(sequence);
      engine.transport.start();
      return engine.render();
    };

    const audio = await render(true);
    // A voice started at `start` plays the sample holding that time first.
    starts.forEach((start, index) => {
      expect(valueAt(audio, index * 0.25)).toBeCloseTo(start, 4);
      expect(valueAt(audio, index * 0.25 + 0.1)).toBeCloseTo(start + 0.1, 4);
    });
    // Without the listener every voice starts from 0.
    const plain = await render(false);
    starts.forEach((_start, index) => expect(valueAt(plain, index * 0.25)).toBeCloseTo(0, 6));
  });

  it('gives every listener the event the callback gets, in the order added, in one pass', async () => {
    const engine = await clicker(0.5);
    const log: string[] = [];
    const events: SequenceEvent[][] = [];
    const defaults: number[] = [];
    engine
      .select('#hit')
      .param('speed')
      .on('change', (change) => defaults.push(change.at));
    const note = (who: string) => (ev: SequenceEvent) => {
      log.push(`${who}${ev.index}`);
      (events[ev.index] ??= []).push(ev);
    };
    const sequence = engine.transport.sequence({ steps: [3, 0], step: '1/8' }, note('callback'));
    sequence.on('step', note('a'));
    sequence.on('step', (ev) => {
      // What a listener does lands on the step by default, as in the callback.
      engine.select('#hit').set({ speed: 2 + ev.index });
      note('b')(ev);
    });
    sequence.on('step', note('c'));
    engine.transport.start();
    await engine.render();

    expect(log).toEqual(['a0', 'b0', 'c0', 'callback0', 'a1', 'b1', 'c1', 'callback1']);
    for (const seen of events) {
      expect(seen).toHaveLength(4);
      for (const ev of seen) expect(ev).toBe(seen[0]);
    }
    const first = events[0]![0]!;
    expect([first.time, first.index, first.value, first.cycle, first.bar, first.beat]).toEqual([
      0, 0, 3, 0, 0, 0,
    ]);
    expect(first.steps).toEqual([3, 0]);
    expect(first.sequence).toBe(sequence);
    expect(events[1]![0]!.time).toBe(0.25);
    expect(events[1]![0]!.duration).toBeCloseTo(0.25, 12);
    expect(events[1]![0]!.at(0.5)).toBeCloseTo(0.375, 12);
    expect(defaults.slice(0, 2)).toEqual([0, 0.25]);
  });

  it('hears every step: rests the callback is not called for, and steps probability drops', async () => {
    const engine = await clicker(1);
    const t = engine.transport;
    const heard: Record<string, number[]> = { rests: [], silent: [], dropped: [] };
    const called: Record<string, number> = { rests: 0, silent: 0, dropped: 0 };
    const options = {
      rests: { steps: 'x.x.' },
      silent: { steps: 'x.x.', rests: false },
      dropped: { steps: [1, 2, 0, 4], probability: 0 },
    };
    for (const name of ['rests', 'silent', 'dropped'] as const) {
      t.sequence(name, options[name], () => called[name]!++).on('step', (ev) =>
        heard[name]!.push(ev.value),
      );
    }
    t.start();
    await engine.render();
    // Eight sixteenths in the second rendered.
    expect(heard['rests']).toEqual([1, 0, 1, 0, 1, 0, 1, 0]);
    expect(heard['silent']).toEqual([1, 0, 1, 0, 1, 0, 1, 0]);
    expect(heard['dropped']).toEqual([1, 2, 0, 4, 1, 2, 0, 4]);
    // The callback also runs on rests unless `rests` is false, but never for a dropped hit.
    expect(called).toEqual({ rests: 8, silent: 4, dropped: 2 });
  });

  it('hears a muted sequence, which does not call its callback', async () => {
    const engine = await clicker(1);
    let called = 0;
    const heard: [number, boolean][] = [];
    const sequence = engine.transport.sequence({ steps: 4, step: '1/8' }, () => called++);
    sequence.on('step', (ev) => heard.push([ev.index, ev.sequence.muted]));
    sequence.muted = true;
    engine.transport.at('1/4', () => (sequence.muted = false));
    engine.transport.start();
    await engine.render();
    // The at() runs after the sequence at beat 1 (it was made later), so step 2 is still muted.
    expect(heard).toEqual([
      [0, true],
      [1, true],
      [2, true],
      [3, false],
    ]);
    expect(called).toBe(1);
  });

  it('stops hearing when unsubscribed, and takes the same function once', async () => {
    const engine = await clicker(1);
    const t = engine.transport;
    const heard: string[] = [];
    const sequence = t.sequence({ steps: 4, step: '1/8' }, nothing);
    const a = (ev: SequenceEvent): void => void heard.push(`a${ev.index}`);
    const offA = sequence.on('step', a);
    const offAgain = sequence.on('step', a);
    const offB = sequence.on('step', (ev) => heard.push(`b${ev.index}`));
    t.at('1/8', () => {
      offA();
      offA();
    });
    t.at('1/4', () => {
      offB();
      offAgain();
    });
    t.start();
    await engine.render();
    expect(heard).toEqual(['a0', 'b0', 'a1', 'b1', 'b2']);
    expect(() => sequence.on('tick' as 'step', nothing)).toThrow(/"step"/);
    expect(() => sequence.on('step', null as unknown as () => void)).toThrow(TypeError);
  });

  it('gives the times swing and span give the callback', async () => {
    const engine = await clicker(2);
    const t = engine.transport;
    const times: Record<string, number[]> = { swung: [], spanned: [] };
    const fromCallback: Record<string, number[]> = { swung: [], spanned: [] };
    t.sequence('swung', { steps: '....', step: '1/8', swing: 0.75, rests: false }, (ev) =>
      fromCallback['swung']!.push(ev.time),
    ).on('step', (ev) => times['swung']!.push(ev.time, ev.duration));
    t.sequence('spanned', { steps: 5, span: '1 bar', offset: '1/16' }, (ev) =>
      fromCallback['spanned']!.push(ev.time),
    ).on('step', (ev) => times['spanned']!.push(ev.time));
    t.start();
    await engine.render();

    // Swing 0.75 on eighths: the second of each pair comes three quarters of the way through the pair.
    const swung = [0, 0.375, 0.375, 0.125, 0.5, 0.375, 0.875, 0.125];
    swung.forEach((value, index) => expect(times['swung']![index]).toBeCloseTo(value, 9));
    expect(fromCallback['swung']).toEqual([]);
    // Five across a two-second bar, a sixteenth late: every 0.4 s from 0.125 s.
    expect(times['spanned']!.length).toBe(5);
    times['spanned']!.forEach((time, index) => expect(time).toBeCloseTo(0.125 + index * 0.4, 9));
    expect(times['spanned']).toEqual(fromCallback['spanned']);
  });

  it('stays through setStep, update, restart and the same name declared again', async () => {
    const engine = await clicker(2);
    const t = engine.transport;
    const heard: [number, number][] = [];
    const calls: string[] = [];
    const sequence = t.sequence('part', { steps: [1, 2, 3, 4], step: '1/4' }, () =>
      calls.push('first'),
    );
    sequence.on('step', (ev) => heard.push([ev.index, ev.value]));
    t.at(0, () => sequence.setStep(1, 9));
    t.at(1, () => sequence.update({ steps: [5, 6, 7, 8] }));
    t.at(2, () => {
      const again = t.sequence('part', { steps: [1, 1, 1, 1], step: '1/4' }, () =>
        calls.push('second'),
      );
      expect(again).toBe(sequence);
      again.restart();
    });
    t.start();
    await engine.render();
    // Each change was made at a step this sequence had already delivered: none is heard twice.
    expect(heard).toEqual([
      [0, 1],
      [1, 9],
      [2, 7],
      [0, 1],
    ]);
    expect(calls).toEqual(['first', 'first', 'first', 'second']);
  });

  it('stays through a rebuild that declares the sequence again, and goes with one that does not', async () => {
    const engine = await clicker(2);
    const scope = engine.scope('track');
    const heard: string[] = [];
    const build = (names: string[]) =>
      scope.build((__) => {
        for (const name of names) __.transport.sequence(name, { steps: 1, step: '1/4' }, nothing);
      });
    await build(['a', 'b']);
    const a = scope.transport.get('a')!;
    const b = scope.transport.get('b')!;
    a.on('step', () => heard.push('a'));
    b.on('step', () => heard.push('b'));

    await build(['a']);
    expect(scope.transport.get('a')).toBe(a);
    await build(['a', 'b']);
    // The same name, but a new sequence: the one that was listened to left with the second build.
    expect(scope.transport.get('b')).not.toBe(b);

    engine.transport.start();
    await engine.render();
    expect(heard).toEqual(['a', 'a', 'a', 'a']);
  });

  it('is neither lost nor doubled by a build that fails', async () => {
    const engine = await clicker(2);
    const scope = engine.scope('track');
    const heard: string[] = [];
    const host = (): void => void heard.push('host');
    await scope.build((__) => {
      __.transport.sequence('kept', { steps: 1, step: '1/4' }, nothing);
      __.transport.sequence('stopped', { steps: 1, step: '1/4' }, nothing);
      __.transport.sequence('cleared', { steps: 1, step: '1/4' }, nothing);
    });
    const names = ['kept', 'stopped', 'cleared'];
    const before = names.map((name) => scope.transport.get(name)!);
    before.forEach((sequence, index) =>
      sequence.on('step', () => heard.push(`${names[index]}:host`)),
    );
    scope.transport.get('kept')!.on('step', host);

    await expect(
      scope.build((__) => {
        const kept = __.transport.sequence('kept', { steps: 'xx', step: '1/8' }, nothing);
        // Listeners the failed builder added go with it, also on a sequence that was there before.
        kept.on('step', () => heard.push('kept:builder'));
        kept.on('step', host);
        __.transport.get('stopped')!.stop();
        __.transport.clear('cleared');
        __.transport
          .sequence('new', { steps: 1, step: '1/4' }, nothing)
          .on('step', () => heard.push('new:builder'));
        throw new Error('half-typed');
      }),
    ).rejects.toThrow('half-typed');

    expect(names.map((name) => scope.transport.get(name))).toEqual(before);
    engine.transport.bpm = 240; // two quarter notes in the half second below
    engine.transport.start({ at: 1.5 });
    await engine.render();
    expect(heard.sort()).toEqual(
      [
        ...['kept:host', 'host', 'stopped:host', 'cleared:host'],
        ...['kept:host', 'host', 'stopped:host', 'cleared:host'],
      ].sort(),
    );
  });

  it('is released when the sequence is stopped or cleared, or its scope disposed', async () => {
    const engine = await clicker(1);
    const scope = engine.scope('track');
    const other = engine.scope('other');
    const heard: string[] = [];
    const follow = (sequence: Sequence, name: string) =>
      sequence.on('step', () => heard.push(name));
    const stopped = scope.transport.sequence('stopped', { steps: 1, step: '1/8' }, nothing);
    follow(stopped, 'stopped');
    follow(scope.transport.sequence('cleared', { steps: 1, step: '1/8' }, nothing), 'cleared');
    follow(scope.transport.sequence({ steps: 1, step: '1/8' }, nothing), 'unnamed');
    const disposed = other.transport.sequence('gone', { steps: 1, step: '1/8' }, nothing);
    follow(disposed, 'disposed');
    follow(engine.transport.sequence('root', { steps: 1, step: '1/8' }, nothing), 'root');

    engine.transport.at('1/8', () => {
      stopped.stop();
      scope.transport.clear('cleared');
      other.dispose();
    });
    engine.transport.at('1/4', () => {
      scope.transport.clear();
      // The same name again is a new sequence, which nobody listens to.
      expect(scope.transport.sequence('stopped', { steps: 1, step: '1/8' }, nothing)).not.toBe(
        stopped,
      );
      // Listening to a sequence that has gone adds nothing.
      follow(stopped, 'late')();
      follow(disposed, 'late');
    });
    engine.transport.at('3/8', () => engine.transport.clear());
    engine.transport.start();
    await engine.render();

    const count = (name: string) => heard.filter((each) => each === name).length;
    // Steps at 0 and 0.25 s were heard before the at() made at the same position ran.
    expect(count('stopped')).toBe(2);
    expect(count('cleared')).toBe(2);
    expect(count('disposed')).toBe(2);
    expect(count('unnamed')).toBe(3);
    expect(count('root')).toBe(4);
    expect(count('late')).toBe(0);
  });

  it('hears nothing while the transport is stopped, and carries on when it starts again', async () => {
    const engine = await clicker(2);
    const t = engine.transport;
    const heard: number[] = [];
    t.sequence({ steps: 1, step: '1/4' }, nothing).on('step', (ev) => heard.push(ev.time));
    t.at(1, () => t.pause());
    t.start();
    await engine.render();
    expect(heard).toEqual([0, 0.5]);
  });

  it('a listener that stops the sequence or the transport keeps the callback from that step', async () => {
    const engine = await clicker(1);
    const t = engine.transport;
    const calls: string[] = [];
    const ending = t.sequence({ steps: 1, step: '1/8' }, (ev) => calls.push(`ending${ev.index}`));
    ending.on('step', (ev) => {
      if (ev.time >= 0.25) ending.stop();
    });
    t.sequence({ steps: 1, step: '1/8' }, () => calls.push('halting')).on('step', (ev) => {
      if (ev.time >= 0.5) t.stop();
    });
    t.start();
    await engine.render();
    expect(calls).toEqual(['ending0', 'halting', 'halting']);
    expect(t.state).toBe('stopped');
  });

  it('reports a listener that throws, and calls the other listeners and the callback all the same', async () => {
    const engine = await clicker(1);
    const scope = engine.scope('track');
    const log: string[] = [];
    const onScope: GraphError[] = [];
    const onEngine: GraphError[] = [];
    scope.on('error', (error) => onScope.push(error));
    engine.on('error', (error) => onEngine.push(error));

    const sequence = scope.transport.sequence('kick', { steps: 1, step: '1/8' }, () =>
      log.push('callback'),
    );
    sequence.on('step', () => log.push('before'));
    sequence.on('step', () => {
      log.push('broken');
      throw new Error('listener broke');
    });
    sequence.on('step', () => log.push('after'));
    scope.transport.sequence({ steps: 1, step: '1/2' }, nothing).on('step', () => {
      throw new Error('unnamed broke');
    });
    engine.transport.at('1/8', () => {
      // The host's choice: remove the listener, which leaves the sequence and the others.
      onScope.find((error) => error.origin?.name === 'kick')!.origin!.cancel();
    });
    engine.transport.start();
    await engine.render();

    const step = ['before', 'broken', 'after', 'callback'];
    expect(log).toEqual([
      ...step,
      ...step,
      'before',
      'after',
      'callback',
      ...step.slice(0, 1),
      'after',
      'callback',
    ]);
    expect(engine.transport.state).toBe('started');
    expect(scope.transport.get('kick')).toBe(sequence);
    expect(onEngine).toEqual(onScope);
    expect(onScope.map((error) => [error.code, error.origin?.kind, error.message])).toEqual([
      [
        'callback',
        'listener',
        'A step listener of the sequence "kick" in scope "track" threw: listener broke',
      ],
      [
        'callback',
        'listener',
        'A step listener of a sequence in scope "track" threw: unnamed broke',
      ],
      [
        'callback',
        'listener',
        'A step listener of the sequence "kick" in scope "track" threw: listener broke',
      ],
    ]);
    expect(onScope[0]!.origin?.sequence).toBe(sequence);
    expect(onScope[0]!.origin?.scope).toBe(scope);
    expect((onScope[0]!.cause as Error).message).toBe('listener broke');
    expect(onScope[1]!.origin?.name).toBeNull();
  });

  it('changes nothing about a sequence nobody listens to, nor about one that is listened to', async () => {
    const run = async (follow: boolean) => {
      const engine = await clicker(2);
      const events: (number | boolean)[][] = [];
      const hit = engine.select('#hit');
      const record = (ev: SequenceEvent): void => {
        events.push([ev.time, ev.duration, ev.index, ev.value, ev.cycle, ev.beat, ev.bar]);
        if (ev.value) hit.trigger({ velocity: ev.value / 2 });
      };
      const t = engine.transport;
      const sequences = [
        t.sequence('a', { steps: [1, 0, 2, 0], swing: 0.6 }, record),
        t.sequence('b', { steps: 'xxxx', probability: 0.5, rests: false }, record),
        t.sequence({ steps: 3, span: '1 bar', probability: 0.3 }, record),
        t.sequence('muted', { steps: 'xx' }, record),
      ];
      sequences[3]!.muted = true;
      t.at(2, () => sequences[0]!.update({ steps: [2, 2, 0, 0] }));
      if (follow) {
        for (const sequence of sequences) sequence.on('step', nothing);
        t.on('step', nothing);
      }
      t.start();
      const audio = await engine.render();
      return { events, samples: [...audio.getChannelData(0)] };
    };
    const plain = await run(false);
    const followed = await run(true);
    expect(plain.events.length).toBeGreaterThan(20);
    expect(followed.events).toEqual(plain.events);
    expect(followed.samples).toEqual(plain.samples);
  });
});

describe("transport.on('step')", () => {
  it("hears the sequences of its scope, and from the engine's transport those of every scope", async () => {
    const engine = await clicker(0.5);
    const a = engine.scope('a');
    const b = engine.scope('b');
    const heard: Record<string, string[]> = { a: [], b: [], engine: [] };
    const name = (ev: SequenceEvent) => `${ev.sequence.name ?? 'unnamed'}${ev.index}`;
    a.transport.on('step', (ev) => heard['a']!.push(name(ev)));
    b.$.transport.on('step', (ev) => heard['b']!.push(name(ev)));
    engine.transport.on('step', (ev) => heard['engine']!.push(name(ev)));

    // Made after the listeners were added, with and without a name.
    a.transport.sequence('kick', { steps: 'x.', step: '1/8', rests: false }, nothing);
    a.transport.sequence({ steps: 1, step: '1/4' }, nothing);
    b.transport.sequence('hat', { steps: 2, step: '1/8' }, nothing).muted = true;
    engine.transport.sequence('root', { steps: 1, step: '1/4' }, nothing);
    engine.transport.every('1/8', nothing);
    engine.transport.start();
    await engine.render();

    expect(heard['a']).toEqual(['kick0', 'unnamed0', 'kick1']);
    expect(heard['b']).toEqual(['hat0', 'hat1']);
    expect(heard['engine']).toEqual(['kick0', 'unnamed0', 'hat0', 'root0', 'kick1', 'hat1']);
  });

  it("runs after the sequence's own listeners and before its callback, and can be removed", async () => {
    const engine = await offlineEngine(0.5);
    engine.chain().sampler({ id: 's', buffer: ramp() }).to('main');
    const t = engine.transport;
    const log: string[] = [];
    const offFirst = t.on('step', (ev) => {
      log.push(`transport${ev.index}`);
      engine.select('#s').set({ start: 0.2 + ev.index * 0.5 }, { at: ev.time });
    });
    t.on('step', (ev) => {
      log.push(`second${ev.index}`);
      if (ev.index === 1) offFirst();
    });
    const sequence = t.sequence('steps', { steps: 3, step: '1/16' }, (ev) => {
      log.push(`callback${ev.index}`);
      engine.select('#s').trigger();
    });
    sequence.on('step', (ev) => log.push(`own${ev.index}`));
    t.start();
    const audio = await engine.render();
    expect(log.slice(0, 11)).toEqual([
      ...['own0', 'transport0', 'second0', 'callback0'],
      ...['own1', 'transport1', 'second1', 'callback1'],
      ...['own2', 'second2', 'callback2'],
    ]);
    expect(valueAt(audio, 0)).toBeCloseTo(0.2, 4);
    expect(valueAt(audio, 0.125)).toBeCloseTo(0.7, 4);
  });

  it('outlasts a sequence that is stopped and declared again, and failed builds', async () => {
    const engine = await clicker(1);
    const scope = engine.scope('track');
    const heard: string[] = [];
    scope.transport.on('step', (ev) => heard.push(`${ev.sequence.name}:${ev.value}`));
    await scope.build((__) => __.transport.sequence('a', { steps: [1], step: '1/4' }, nothing));
    await scope.build((__) => __.transport.sequence('b', { steps: [2], step: '1/4' }, nothing));
    await expect(
      scope.build((__) => {
        __.transport.sequence('c', { steps: [3], step: '1/4' }, nothing);
        throw new Error('no');
      }),
    ).rejects.toThrow('no');
    scope.transport.get('b')!.stop();
    scope.transport.clear();
    scope.transport.sequence('b', { steps: [4], step: '1/4' }, nothing);
    engine.transport.start();
    await engine.render();
    expect(heard).toEqual(['b:4', 'b:4']);
  });

  it("goes with the scope it was added through, and reports what it throws to the sequence's scope", async () => {
    const engine = await clicker(1);
    const scope = engine.scope('track');
    const other = engine.scope('other');
    const heard: string[] = [];
    const errors: GraphError[] = [];
    scope.on('error', (error) => errors.push(error));
    other.transport.on('step', () => heard.push('other'));
    engine.transport.on('step', (ev) => {
      heard.push('engine');
      if (ev.time === 0) throw new Error('follower broke');
    });
    const sequence = scope.transport.sequence('kick', { steps: 1, step: '1/4' }, () =>
      heard.push('callback'),
    );
    other.dispose();
    // A scope of the same name later is another scope: the listener went with the first.
    engine.scope('other').transport.sequence('late', { steps: 1, step: '1/2' }, nothing);
    engine.transport.start();
    await engine.render();
    expect(heard).toEqual(['engine', 'callback', 'engine', 'engine', 'callback']);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toBe(
      'A step listener of the sequence "kick" in scope "track" threw: follower broke',
    );
    expect(errors[0]!.origin?.kind).toBe('listener');
    expect(errors[0]!.origin?.sequence).toBe(sequence);
  });
});
