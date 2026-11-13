import { describe, expect, it } from 'vitest';
import { createEngine } from '../../src';
import { ClockFollower, createMidi, encodeMidi, parseMidi } from '../../src/midi';
import type { FollowTarget, MidiMessage } from '../../src/midi';
import { rms } from '../helpers';
import { offlineEngine } from '../core/setup';
import { FakeAccess, FakeInput, FakeOutput, plainTiming } from './fake';

async function setup(seconds = 0.5) {
  const engine = await offlineEngine(seconds);
  const keys = new FakeInput('in-1', 'Keys');
  const pads = new FakeInput('in-2', 'Pads');
  const synth = new FakeOutput('out-1', 'Synth');
  const access = new FakeAccess([keys, pads], [synth]);
  const midi = createMidi(engine, access, { timing: plainTiming });
  return { engine, keys, pads, synth, access, midi };
}

describe('MIDI messages', () => {
  it('reads every kind of message', () => {
    expect(parseMidi([0x90, 60, 127])).toEqual({
      type: 'noteon',
      channel: 1,
      note: 60,
      velocity: 1,
    });
    expect(parseMidi([0x93, 60, 0])).toEqual({
      type: 'noteoff',
      channel: 4,
      note: 60,
      velocity: 0,
    });
    expect(parseMidi([0x8f, 61, 127])).toEqual({
      type: 'noteoff',
      channel: 16,
      note: 61,
      velocity: 1,
    });
    expect(parseMidi([0xb1, 74, 127])).toEqual({
      type: 'cc',
      channel: 2,
      controller: 74,
      value: 1,
    });
    expect(parseMidi([0xe0, 0, 64])).toEqual({ type: 'pitchbend', channel: 1, value: 0 });
    expect(parseMidi([0xe0, 127, 127])).toEqual({ type: 'pitchbend', channel: 1, value: 1 });
    expect(parseMidi([0xe0, 0, 0])).toEqual({ type: 'pitchbend', channel: 1, value: -1 });
    expect(parseMidi([0xc2, 5])).toEqual({ type: 'program', channel: 3, program: 5 });
    expect(parseMidi([0xd0, 127])).toEqual({ type: 'aftertouch', channel: 1, pressure: 1 });
    expect(parseMidi([0xa0, 60, 127])).toEqual({
      type: 'polyaftertouch',
      channel: 1,
      note: 60,
      pressure: 1,
    });
    expect(parseMidi([0xf8])).toEqual({ type: 'clock' });
    expect(parseMidi([0xfa])).toEqual({ type: 'start' });
    expect(parseMidi([0xfb])).toEqual({ type: 'continue' });
    expect(parseMidi([0xfc])).toEqual({ type: 'stop' });
    // 16 sixteenths is 4 quarter notes.
    expect(parseMidi([0xf2, 16, 0])).toEqual({ type: 'songposition', beats: 4 });
    expect(parseMidi([0xf0, 1, 2, 0xf7])).toEqual({ type: 'other', bytes: [0xf0, 1, 2, 0xf7] });
    expect(parseMidi([])).toEqual({ type: 'other', bytes: [] });
  });

  it('writes messages that read back the same', () => {
    const messages: MidiMessage[] = [
      { type: 'noteon', channel: 10, note: 36, velocity: 1 },
      { type: 'noteoff', channel: 10, note: 36, velocity: 0 },
      { type: 'cc', channel: 3, controller: 7, value: 1 },
      { type: 'pitchbend', channel: 1, value: -1 },
      { type: 'pitchbend', channel: 1, value: 1 },
      { type: 'program', channel: 16, program: 99 },
      { type: 'aftertouch', channel: 2, pressure: 1 },
      { type: 'polyaftertouch', channel: 2, note: 64, pressure: 0 },
      { type: 'clock' },
      { type: 'start' },
      { type: 'continue' },
      { type: 'stop' },
      { type: 'songposition', beats: 1000.25 },
    ];
    for (const message of messages) expect(parseMidi(encodeMidi(message))).toEqual(message);
    // A very quiet note-on must not turn into a note-off.
    expect(encodeMidi({ type: 'noteon', channel: 1, note: 60, velocity: 0.001 })).toEqual([
      0x90, 60, 1,
    ]);
  });
});

describe('MIDI input', () => {
  it('delivers messages to any number of listeners, by kind, channel and input', async () => {
    const { keys, pads, midi } = await setup();
    const seen: string[] = [];
    midi.on('noteon', (event) => seen.push(`a:${event.note}@${event.time}`));
    midi.on('noteon', (event) => seen.push(`b:${event.input.name}`));
    midi.on('noteon', () => seen.push('ch2'), { channel: 2 });
    midi.on('noteon', () => seen.push('pads'), { input: 'Pads' });
    midi.on('message', (event) => seen.push(`any:${event.type}`));
    const off = midi.on('cc', () => seen.push('cc'));

    keys.emit([0x90, 60, 100], 250);
    expect(seen).toEqual(['a:60@0.25', 'b:Keys', 'any:noteon']);
    seen.length = 0;
    pads.emit([0x91, 62, 100], 0);
    expect(seen).toEqual(['a:62@0', 'b:Pads', 'ch2', 'pads', 'any:noteon']);
    seen.length = 0;
    keys.emit([0xb0, 1, 64]);
    off();
    keys.emit([0xb0, 1, 65]);
    expect(seen).toEqual(['any:cc', 'cc', 'any:cc']);
  });

  it('follows devices being plugged in and removed', async () => {
    const { access, keys, midi } = await setup();
    let changes = 0;
    const notes: number[] = [];
    midi.on('devices', () => changes++);
    midi.on('noteon', (event) => notes.push(event.note));
    const late = new FakeInput('in-3', 'Late');
    access.change((a) => a.inputs.set(late.id, late));
    expect(midi.inputs.map((port) => port.name)).toEqual(['Keys', 'Pads', 'Late']);
    late.emit([0x90, 70, 100]);
    access.change((a) => a.inputs.delete(keys.id));
    expect(keys.listening).toBe(false);
    keys.emit([0x90, 71, 100]);
    expect(notes).toEqual([70]);
    expect(changes).toBe(2);
  });

  it('plays incoming notes on a synth', async () => {
    const { engine, keys, midi } = await setup(0.4);
    engine.chain().polysynth({ id: 'synth', release: 0.01 }).to('main');
    const stop = midi.play(() => engine.select('#synth'), { channel: 1 });
    keys.emit([0x91, 60, 127]); // another channel: ignored
    keys.emit([0x90, 64, 127]);
    engine.select('#synth').release({ pitch: 64, at: 0.2 });
    const audio = await engine.render();
    const first = audio.getChannelData(0).subarray(0, 4800);
    const last = audio.getChannelData(0).subarray(14400);
    expect(rms({ getChannelData: () => first } as unknown as AudioBuffer)).toBeGreaterThan(0.01);
    expect(rms({ getChannelData: () => last } as unknown as AudioBuffer)).toBeLessThan(0.001);
    stop();
  });

  it('ties a controller to a parameter across its control range', async () => {
    const { engine, keys, midi } = await setup();
    engine.chain().sine().lowpass({ id: 'filter' }).gain({ id: 'level' }).to('main');
    const cutoff = engine.select('#filter').param('frequency');
    const meta = cutoff.meta as { min: number; max: number };
    const binding = midi.bind({ controller: 74, channel: 1 }, cutoff);
    keys.emit([0xb0, 74, 0]);
    expect(cutoff.value).toBeCloseTo(meta.min, 6);
    keys.emit([0xb0, 74, 127]);
    expect(cutoff.value).toBeCloseTo(meta.max, 6);
    keys.emit([0xb1, 74, 0]); // other channel
    keys.emit([0xb0, 75, 0]); // other controller
    expect(cutoff.value).toBeCloseTo(meta.max, 6);
    expect(midi.bindings).toHaveLength(1);
    binding.remove();
    keys.emit([0xb0, 74, 0]);
    expect(cutoff.value).toBeCloseTo(meta.max, 6);
    expect(midi.bindings).toHaveLength(0);
  });

  it('learns the next controller moved, and keeps working when the node is replaced', async () => {
    const { engine, keys, midi } = await setup();
    const scope = engine.scope('track');
    const build = (type: 'sine' | 'saw') =>
      scope.build((__) => {
        __()[type]({ id: 'osc' }).gain({ id: 'level', gain: 0.5 }).to('main');
      });
    await build('sine');
    const learned = midi.learn(() => scope.select('#osc').param('detune'));
    keys.emit([0x90, 60, 100]); // not a controller: learn keeps waiting
    keys.emit([0xb2, 21, 127]);
    const binding = await learned;
    expect([binding.controller, binding.channel, binding.input]).toEqual([21, 3, 'in-1']);
    const max = (scope.select('#osc').param('detune').meta as { max: number }).max;
    expect(scope.select('#osc').param('detune').value).toBeCloseTo(max, 6);

    await build('saw'); // a different node now has the id
    keys.emit([0xb2, 21, 0]);
    const min = (scope.select('#osc').param('detune').meta as { min: number }).min;
    expect(scope.select('#osc').first()?.type).toBe('saw');
    expect(scope.select('#osc').param('detune').value).toBeCloseTo(min, 6);

    const abandoned = midi.learn(scope.select('#level').param('gain'));
    midi.cancelLearn();
    await expect(abandoned).rejects.toThrow(/cancelled/);
  });
});

describe('MIDI output', () => {
  it('sends notes and controllers with times from the audio clock', async () => {
    const { synth, midi } = await setup();
    const out = midi.output('Synth');
    out.channel = 2;
    out.note(60, { at: 0.5, duration: 0.25, velocity: 1 });
    out.cc(7, 0.5, { at: 1, channel: 10 });
    out.pitchBend(0, { at: 2 }).program(3, { at: 2 });
    out.send([0xf0, 1, 0xf7], { at: 3 });
    expect(synth.sent).toEqual([
      { data: [0x91, 60, 127], at: 500 },
      { data: [0x81, 60, 0], at: 750 },
      { data: [0xb9, 7, 64], at: 1000 },
      { data: [0xe1, 0, 64], at: 2000 },
      { data: [0xc1, 3], at: 2000 },
      { data: [0xf0, 1, 0xf7], at: 3000 },
    ]);
    expect(() => midi.output('Nope')).toThrow(/no MIDI output called "Nope". Outputs: Synth/);
  });

  it('lands on the step when called from a sequence with no time given', async () => {
    const { engine, synth, midi } = await setup(1);
    const out = midi.output();
    engine.transport.sequence('notes', { steps: [60, 0, 67, 0], step: '1/8' }, (ev) => {
      if (ev.value) out.note(ev.value, { duration: 0.1 });
    });
    engine.transport.start();
    await engine.render();
    const ons = synth.sent.filter((message) => message.data[0] === 0x90);
    expect(ons.map((message) => [message.data[1], message.at])).toEqual([
      [60, 0],
      [67, 500],
    ]);
  });

  it('sends clock that other gear can follow', async () => {
    const { engine, synth, midi } = await setup(1);
    const stop = midi.sendClock('Synth');
    engine.transport.start();
    await engine.render();
    const kinds = synth.sent.map((message) => parseMidi(message.data).type);
    expect(kinds[0]).toBe('start');
    expect(kinds.slice(1).every((kind) => kind === 'clock')).toBe(true);
    // One second at 120 bpm is two beats: 48 pulses, the first on the downbeat.
    const pulses = synth.sent.slice(1);
    expect(pulses).toHaveLength(48);
    expect(pulses[0]?.at).toBe(0);
    pulses.forEach((pulse, index) => expect(pulse.at).toBeCloseTo((index * 1000) / 48, 6));

    synth.sent = [];
    engine.transport.stop({ at: 1 });
    expect(synth.sent.map((message) => parseMidi(message.data).type)).toEqual(['stop']);
    stop();
  });

  it('says where to continue from when playback begins part-way through', async () => {
    const { engine, synth, midi } = await setup(0.1);
    midi.sendClock();
    engine.transport.start({ at: 0, from: 8 });
    expect(synth.sent.slice(0, 2).map((message) => parseMidi(message.data))).toEqual([
      { type: 'songposition', beats: 8 },
      { type: 'continue' },
    ]);
  });

  it('a rebuild of the root scope does not stop the clock', async () => {
    const { engine, synth, midi } = await setup(0.5);
    midi.sendClock();
    await engine.root.build((__) => {
      __().sine().gain(0.1).to('main');
    });
    engine.transport.start();
    await engine.render();
    expect(synth.sent.filter((message) => message.data[0] === 0xf8)).toHaveLength(24);
  });
});

// ---------------------------------------------------------------------------------------------------
// Following a clock
// ---------------------------------------------------------------------------------------------------

/**
 * A stand-in transport that behaves like the real one where it matters to a follower: a tempo change
 * only takes effect a look-ahead later, because nearer events have already been handed out.
 */
class SimTransport implements FollowTarget {
  state: 'stopped' | 'started' | 'paused' = 'stopped';
  now = 0;
  private segments: { time: number; beat: number; bpm: number }[] = [];
  private rest = 0;
  bpm = 120;
  constructor(private lookahead = 0.1) {}

  toBeats(time: number): number {
    if (this.state !== 'started') return this.rest;
    let segment = this.segments[0]!;
    for (const candidate of this.segments) if (candidate.time <= time) segment = candidate;
    return segment.beat + ((time - segment.time) * segment.bpm) / 60;
  }

  drive(bpm: number): void {
    this.bpm = bpm;
    if (this.state !== 'started') return;
    const time = this.now + this.lookahead;
    const beat = this.toBeats(time);
    this.segments = this.segments.filter((segment) => segment.time < time);
    this.segments.push({ time, beat, bpm });
    if (this.segments.length > 64) this.segments.shift();
  }

  start(at: number, from?: number): void {
    this.state = 'started';
    this.segments = [{ time: at, beat: from ?? this.rest, bpm: this.bpm }];
  }

  pause(at: number): void {
    this.rest = this.toBeats(at);
    this.state = 'paused';
  }

  seek(beats: number): void {
    if (this.state !== 'started') this.rest = beats;
    else this.segments = [{ time: this.now, beat: beats, bpm: this.bpm }];
  }
}

/** Deterministic noise from -1 to 1. */
function noise(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return (state / 0xffffffff) * 2 - 1;
  };
}

/**
 * Plays a clock at `bpm` into a follower for `beats` beats, with each pulse's reported time off by up
 * to `jitter` seconds. Returns the worst timing gap after `settle` beats, in seconds.
 */
function run(
  follower: ClockFollower,
  transport: SimTransport,
  options: {
    bpm: number;
    beats: number;
    jitter: number;
    from: number;
    settle: number;
    seed?: number;
  },
): { worst: number; end: number } {
  const random = noise(options.seed ?? 1);
  const spacing = 60 / options.bpm / 24;
  let worst = 0;
  let time = options.from;
  const origin = transport.state === 'started' ? transport.toBeats(time) : null;
  for (let pulse = 0; pulse < options.beats * 24; pulse++) {
    time = options.from + pulse * spacing;
    transport.now = time;
    follower.pulse(time + random() * options.jitter);
    if (pulse >= options.settle * 24) {
      const base = origin ?? 0;
      const gapBeats = base + pulse / 24 - transport.toBeats(time);
      worst = Math.max(worst, (Math.abs(gapBeats) * 60) / options.bpm);
    }
  }
  return { worst, end: time + spacing };
}

describe('following MIDI clock', () => {
  it('starts on the pulse after Start and measures the tempo', () => {
    const transport = new SimTransport();
    const follower = new ClockFollower(transport);
    follower.pulse(0.9); // clock running before Start: nothing plays
    expect(transport.state).toBe('stopped');
    follower.start();
    const { worst } = run(follower, transport, {
      bpm: 97.3,
      beats: 16,
      jitter: 0,
      from: 1,
      settle: 4,
    });
    expect(transport.state).toBe('started');
    expect(follower.bpm).toBeCloseTo(97.3, 3);
    expect(worst).toBeLessThan(0.0005);
  });

  it('stays within 2 ms of a clock whose pulses arrive up to 1.5 ms off', () => {
    for (const bpm of [70, 120, 174]) {
      const transport = new SimTransport();
      const follower = new ClockFollower(transport);
      follower.start();
      const { worst } = run(follower, transport, {
        bpm,
        beats: 64,
        jitter: 0.0015,
        from: 0,
        settle: 8,
        seed: bpm,
      });
      expect(worst).toBeLessThan(0.002);
      expect(Math.abs(follower.bpm! - bpm) / bpm).toBeLessThan(0.003);
    }
  });

  it('follows a tempo change and closes the gap it caused', () => {
    const transport = new SimTransport();
    const follower = new ClockFollower(transport);
    follower.start();
    const first = run(follower, transport, {
      bpm: 120,
      beats: 8,
      jitter: 0.001,
      from: 0,
      settle: 4,
    });
    // The clock jumps to 140. Measure against the new grid from where the old one ended.
    const origin = 8;
    const spacing = 60 / 140 / 24;
    let worstLate = 0;
    for (let pulse = 0; pulse < 16 * 24; pulse++) {
      const time = first.end + pulse * spacing;
      transport.now = time;
      follower.pulse(time);
      if (pulse >= 8 * 24) {
        const gap = origin + pulse / 24 - transport.toBeats(time);
        worstLate = Math.max(worstLate, (Math.abs(gap) * 60) / 140);
      }
    }
    expect(follower.bpm).toBeCloseTo(140, 1);
    expect(worstLate).toBeLessThan(0.002);
  });

  it('obeys Stop, Continue and Song Position', () => {
    const transport = new SimTransport();
    const follower = new ClockFollower(transport);
    follower.start();
    const first = run(follower, transport, { bpm: 120, beats: 4, jitter: 0, from: 0, settle: 2 });
    follower.stop(first.end);
    expect(transport.state).toBe('paused');
    expect(transport.toBeats(first.end)).toBeCloseTo(4, 3);

    follower.continue();
    transport.now = first.end + 1;
    follower.pulse(first.end + 1);
    expect(transport.state).toBe('started');
    expect(transport.toBeats(first.end + 1)).toBeCloseTo(4, 3);

    follower.stop(first.end + 2);
    follower.songPosition(16);
    follower.continue();
    follower.pulse(first.end + 3);
    expect(transport.toBeats(first.end + 3)).toBeCloseTo(16, 6);

    follower.stop(first.end + 4);
    follower.start();
    follower.pulse(first.end + 5);
    expect(transport.toBeats(first.end + 5)).toBe(0);
  });

  it('locks onto a clock that was already running when the transport was started by hand', () => {
    const transport = new SimTransport();
    const follower = new ClockFollower(transport);
    transport.bpm = 100;
    transport.start(0.013, 0); // started by hand, off the clock's grid and at the wrong tempo
    const { end } = run(follower, transport, {
      bpm: 128,
      beats: 32,
      jitter: 0.001,
      from: 0,
      settle: 12,
    });
    expect(follower.bpm).toBeCloseTo(128, 0);
    // There was no Start to say which pulse is beat 1, so "in step" means on a pulse: at the moment
    // of the last pulse, the transport's position is a whole number of pulses, to within 2 ms.
    const pulseSeconds = 60 / 128 / 24;
    const inPulses = transport.toBeats(end - pulseSeconds) * 24;
    expect(Math.abs(inPulses - Math.round(inPulses)) * pulseSeconds).toBeLessThan(0.002);
  });

  it('Start moves a transport that is already playing to the beginning', () => {
    const transport = new SimTransport();
    const follower = new ClockFollower(transport);
    transport.bpm = 100;
    transport.start(0, 0); // started by hand, well before the clock's Start
    transport.now = 3.21;
    expect(transport.toBeats(3.21)).toBeGreaterThan(5);
    follower.start();
    run(follower, transport, {
      bpm: 128,
      beats: 16,
      jitter: 0.001,
      from: 3.21,
      settle: 8,
    });
    // The pulse after Start is beat 0, wherever the transport had got to.
    const spacing = 60 / 128 / 24;
    const last = 3.21 + (16 * 24 - 1) * spacing;
    const gap = (16 * 24 - 1) / 24 - transport.toBeats(last);
    expect((Math.abs(gap) * 60) / 128).toBeLessThan(0.002);
  });

  it('stopping an earlier follow leaves a later one in charge', async () => {
    const { engine, midi } = await setup(0.1);
    const first = midi.follow('Keys');
    const second = midi.follow('Keys');
    first.stop();
    expect(engine.transport.clock.kind).toBe('external');
    engine.transport.bpm = 200; // still ignored
    expect(engine.transport.bpm).toBe(120);
    second.stop();
    expect(engine.transport.clock.kind).toBe('internal');
  });

  it('drives the real transport, and gives the tempo back when it stops following', async () => {
    const { engine, keys, midi } = await setup(0.1);
    const follow = midi.follow('Keys');
    expect(engine.transport.clock.kind).toBe('external');
    engine.transport.bpm = 200; // ignored while following
    expect(engine.transport.bpm).toBe(120);

    keys.emit([0xfa], 0);
    const spacing = 60000 / 90 / 24;
    for (let pulse = 0; pulse < 48; pulse++) keys.emit([0xf8], pulse * spacing);
    expect(engine.transport.state).toBe('started');
    expect(follow.bpm).toBeCloseTo(90, 3);
    expect(engine.transport.bpm).toBeGreaterThan(85);
    expect(engine.transport.bpm).toBeLessThan(95);
    expect(engine.transport.clock.bpm).toBeCloseTo(90, 3);

    keys.emit([0xfc], 48 * spacing);
    expect(engine.transport.state).toBe('paused');
    follow.stop();
    expect(engine.transport.clock.kind).toBe('internal');
    engine.transport.bpm = 200;
    expect(engine.transport.bpm).toBe(200);
    keys.emit([0xfa], 0);
    keys.emit([0xf8], 0);
    expect(engine.transport.state).toBe('paused');
  });

  // VITE_SKIP_LIVE_AUDIO is set where there may be no sound device at all (the release checks on GitHub).
  const isChromium =
    /Chrome\//.test(navigator.userAgent) &&
    !(import.meta as { env?: Record<string, string | undefined> }).env?.['VITE_SKIP_LIVE_AUDIO'];

  // Needs a running audio clock, which the test setup allows without a click only in Chromium.
  it.skipIf(!isChromium)('keeps a live transport on a clock sent in real time', async () => {
    const context = new AudioContext();
    try {
      await context.resume();
      const engine = await createEngine({ context });
      const input = new FakeInput('clock');
      const midi = createMidi(engine, new FakeAccess([input]));
      const follow = midi.follow();
      const bpm = 132;
      const spacing = 60000 / bpm / 24;
      const startedAt = performance.now() + 50;
      // Pulses carry exact times, as a hardware port stamps them, but are delivered whenever the
      // page's timer gets round to it, which is what makes following harder than it looks.
      let sent = 0;
      const gaps: number[] = [];
      await new Promise<void>((resolve) => {
        const timer = setInterval(() => {
          const now = performance.now();
          while (startedAt + sent * spacing <= now) {
            if (sent === 0) input.emit([0xfa], startedAt);
            input.emit([0xf8], startedAt + sent * spacing);
            sent++;
            if (sent > 4 * 24 && sent % 6 === 0) gaps.push(Math.abs(follow.error));
          }
          if (sent >= 10 * 24) {
            clearInterval(timer);
            resolve();
          }
        }, 4);
      });
      expect(engine.transport.state).toBe('started');
      expect(follow.bpm).toBeCloseTo(bpm, 0);
      const worst = Math.max(...gaps);
      console.log(
        `live clock follow: worst gap ${(worst * 1000).toFixed(2)} ms over ${gaps.length} readings`,
      );
      expect(worst).toBeLessThan(0.005);
      midi.dispose();
      engine.dispose();
    } finally {
      await context.close();
    }
  });
});
