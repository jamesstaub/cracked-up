import { describe, expect, it } from 'vitest';
import { createMidi } from '../../src/midi';
import type { Midi } from '../../src/midi';
import { offlineEngine } from '../core/setup';
import { FakeAccess, FakeInput, FakeOutput, plainTiming } from './fake';

async function setup() {
  const engine = await offlineEngine(0.5);
  const keys = new FakeInput('in-1', 'Keys');
  const synth = new FakeOutput('out-1', 'Synth');
  const midi = createMidi(engine, new FakeAccess([keys], [synth]), { timing: plainTiming });
  const note = (time = 0) => keys.emit([0x90, 60, 100], time);
  /** A clock at `bpm`, `pulses` long, starting at `from` milliseconds. Returns where it ended. */
  const clock = (bpm: number, pulses: number, from: number): number => {
    const spacing = 60000 / bpm / 24;
    for (let pulse = 0; pulse < pulses; pulse++) keys.emit([0xf8], from + pulse * spacing);
    return from + pulses * spacing;
  };
  return { engine, keys, synth, midi, note, clock };
}

describe('midi.build', () => {
  it("replaces the last run's listeners instead of adding to them", async () => {
    const { midi, note } = await setup();
    const heard: string[] = [];
    midi.build((m) => m.on('noteon', () => heard.push('first')));
    midi.build((m) => m.on('noteon', () => heard.push('second')));
    midi.build((m) => m.on('noteon', () => heard.push('third')));
    note();
    expect(heard).toEqual(['third']);
    // A run that makes no calls leaves nothing listening.
    midi.build(() => undefined);
    note();
    expect(heard).toEqual(['third']);
  });

  it('leaves listeners added outside any build alone', async () => {
    const { midi, note } = await setup();
    const heard: string[] = [];
    midi.on('noteon', () => heard.push('page'));
    midi.build((m) => m.on('noteon', () => heard.push('script')));
    midi.build(() => undefined);
    note();
    expect(heard).toEqual(['page']);
  });

  it('keeps a follow with the same arguments running, with what it has measured', async () => {
    const { engine, midi, clock } = await setup();
    let follow = midi.build((m) => m.follow('Keys'));
    expect(follow.bpm).toBe(null);
    const end = clock(90, 48, 0);
    expect(follow.bpm).toBeCloseTo(90, 3);

    // The script is run again, unchanged as far as MIDI goes: no pulse is needed to know the tempo.
    follow = midi.build((m) => m.follow('Keys'));
    expect(follow.bpm).toBeCloseTo(90, 3);
    expect(engine.transport.clock.kind).toBe('external');
    clock(90, 24, end);
    expect(follow.bpm).toBeCloseTo(90, 3);
  });

  it('starts a follow afresh when its arguments change, and stops one no longer asked for', async () => {
    const { engine, midi, clock } = await setup();
    const first = midi.build((m) => m.follow('Keys'));
    const end = clock(90, 48, 0);
    const second = midi.build((m) => m.follow('Keys', { window: 12 }));
    expect(second.bpm).toBe(null);
    expect(engine.transport.clock.kind).toBe('external');
    clock(120, 24, end);
    expect(second.bpm).toBeCloseTo(120, 3);
    expect(first.bpm).toBeCloseTo(90, 3); // the old one heard no more

    midi.build(() => undefined);
    expect(engine.transport.clock.kind).toBe('internal');
  });

  it('keeps sending clock to the same output across runs, without a second clock', async () => {
    const { engine, midi, synth } = await setup();
    midi.build((m) => m.sendClock('Synth'));
    midi.build((m) => m.sendClock('Synth'));
    engine.transport.start();
    await engine.render();
    const pulses = synth.sent.filter((message) => message.data[0] === 0xf8).length;
    // 0.5 s at 120 bpm is one beat: 24 pulses, give or take the one on the boundary. Two clocks would be 48.
    expect(pulses).toBeGreaterThanOrEqual(24);
    expect(pulses).toBeLessThanOrEqual(25);
  });

  it('changes nothing when the run throws', async () => {
    const { midi, note } = await setup();
    const heard: string[] = [];
    midi.build((m) => m.on('noteon', () => heard.push('good')));
    expect(() =>
      midi.build((m) => {
        m.on('noteon', () => heard.push('bad'));
        throw new Error('half-typed');
      }),
    ).toThrow('half-typed');
    note();
    expect(heard).toEqual(['good']);
  });

  it('in two steps: nothing takes effect before commit, and rollback drops it', async () => {
    const { midi, note } = await setup();
    const heard: string[] = [];
    midi.build((m) => m.on('noteon', () => heard.push('old')));

    const dropped = midi.session();
    dropped.midi.on('noteon', () => heard.push('dropped'));
    note();
    dropped.rollback();
    note();
    expect(heard).toEqual(['old', 'old']);

    const next = midi.session();
    next.midi.on('noteon', () => heard.push('new'));
    next.commit();
    note();
    expect(heard).toEqual(['old', 'old', 'new']);
  });

  it('bindings and what a call returns work as on the midi object', async () => {
    const { engine, keys, midi, note } = await setup();
    engine.chain().lowpass({ id: 'filter', frequency: 1000 }).to('main');
    const param = () => engine.select('#filter').param('frequency');
    let handles!: { off: () => void; binding: ReturnType<Midi['bind']> };
    const heard: number[] = [];
    midi.build((m) => {
      handles = {
        off: m.on('noteon', (event) => heard.push(event.note)),
        binding: m.bind({ controller: 74 }, param),
      };
    });
    expect(handles.binding.controller).toBe(74);
    keys.emit([0xb0, 74, 127], 0);
    expect(param().value).toBeCloseTo(20000, 0);
    handles.binding.remove();
    keys.emit([0xb0, 74, 0], 0);
    expect(param().value).toBeCloseTo(20000, 0);
    note();
    handles.off();
    note();
    expect(heard).toEqual([60]);
    expect(midi.bindings.length).toBe(0);
  });

  it('dispose stops what the last run made', async () => {
    const { engine, midi } = await setup();
    midi.build((m) => m.follow('Keys'));
    midi.dispose();
    expect(engine.transport.clock.kind).toBe('internal');
  });
});
