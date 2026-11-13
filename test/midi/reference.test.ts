import { describe, expect, it } from 'vitest';
import * as midiModule from '../../src/midi';
import { createMidi } from '../../src/midi';
import { MIDI_FUNCTIONS, MIDI_MEMBERS, MIDI_OUT_MEMBERS } from '../../demo/midi-reference';
import { offlineEngine } from '../core/setup';
import { FakeAccess, FakeInput, FakeOutput, plainTiming } from './fake';

describe('the MIDI reference in the docs', () => {
  it('names exactly what the midi object, an output and the module have', async () => {
    const engine = await offlineEngine(0.1);
    const access = new FakeAccess([new FakeInput('in')], [new FakeOutput('out')]);
    const midi = createMidi(engine, access, { timing: plainTiming });
    const names = (list: readonly { name: string }[]) => list.map((doc) => doc.name).sort();
    expect(names(MIDI_MEMBERS)).toEqual(Object.keys(midi).sort());
    expect(names(MIDI_OUT_MEMBERS)).toEqual(Object.keys(midi.output()).sort());
    for (const doc of MIDI_FUNCTIONS) {
      expect(typeof (midiModule as Record<string, unknown>)[doc.name]).toBe('function');
    }
    midi.dispose();
  });
});
