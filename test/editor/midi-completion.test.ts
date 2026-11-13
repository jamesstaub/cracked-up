import { beforeAll, describe, expect, it } from 'vitest';
import { hoverAt, signatureAt } from '../../src/editor';
import type { ResolvedCatalog } from '../../src/editor';
import { API } from '../../src/editor/api-docs';
import { INTERACTION_DOCS } from '../../src/util';
import { labelsAt, stateAt, testCatalog } from './setup';

let catalog: ResolvedCatalog;
let bare: ResolvedCatalog;
beforeAll(async () => {
  catalog = await testCatalog({
    // What a host that offers MIDI and the interaction helpers to scripts tells the editor.
    globals: [{ name: 'midi', kind: 'midi', description: 'MIDI in and out.' }],
    midiInputs: ['IAC Driver Bus 1', 'Keystation 49'],
    midiOutputs: ['My Synth'],
    helpers: INTERACTION_DOCS.map((doc) => ({ ...doc, group: 'Interaction' })),
  });
  bare = await testCatalog();
});

const labels = (code: string): string[] => labelsAt(code, catalog) ?? [];
const names = (kind: keyof typeof API): string[] => API[kind].map((member) => member.name);

describe('completion for MIDI', () => {
  it('offers the members of a midi object the host has named', () => {
    expect(labels('midi.|')).toEqual(expect.arrayContaining(names('midi')));
    expect(labels('midi.fol|')).toContain('follow');
    // Without the host saying what `midi` is, nothing is known about it.
    expect(labelsAt('midi.|', bare)).toBe(null);
  });

  it('follows what its methods return, through variables too', () => {
    expect(labels('midi.output().|')).toEqual(expect.arrayContaining(names('midiOut')));
    expect(labels("midi.output('My Synth').note(60).|")).toContain('cc');
    expect(labels("const follow = midi.follow('IAC Driver Bus 1');\nfollow.|").sort()).toEqual(
      names('follow').sort(),
    );
    expect(
      labels("const knob = midi.bind({ controller: 74 }, () => __('#f').param('q'));\nknob.|"),
    ).toContain('remove');
  });

  it('knows the message a listener is given, and the midi object build passes in', () => {
    expect(labels("midi.on('noteon', (note) => {\n  note.|\n});")).toEqual(
      expect.arrayContaining(['note', 'velocity', 'channel', 'input', 'time']),
    );
    expect(labels('midi.build((m) => {\n  m.|\n});')).toContain('follow');
  });

  it('names the ports that are plugged in, and the kinds of message', () => {
    expect(labels("midi.follow('|')")).toEqual(
      ["'IAC Driver Bus 1'", "'Keystation 49'"].map((q) => q.slice(1, -1)),
    );
    expect(labels("midi.output('|')")).toEqual(['My Synth']);
    expect(labels("midi.sendClock('|')")).toEqual(['My Synth']);
    expect(labels("midi.on('|')")).toEqual(
      expect.arrayContaining(['noteon', 'noteoff', 'cc', 'pitchbend', 'clock', 'message']),
    );
    expect(labels("midi.on('cc', () => {}, { input: '|' })")).toEqual([
      'IAC Driver Bus 1',
      'Keystation 49',
    ]);
  });

  it('offers the keys of each options object', () => {
    expect(labels("midi.on('cc', () => {}, { | })").sort()).toEqual(['channel', 'input']);
    expect(labels("midi.play(() => __('#keys'), { | })").sort()).toEqual(['channel', 'input']);
    expect(labels('midi.bind({ | }, target)').sort()).toEqual(['channel', 'controller', 'input']);
    expect(labels("midi.follow('IAC Driver Bus 1', { | })").sort()).toEqual(['pull', 'window']);
    expect(labels('midi.output().note(60, { | })').sort()).toEqual([
      'at',
      'channel',
      'duration',
      'velocity',
    ]);
    expect(labels('midi.output().cc(1, 0.5, { | })').sort()).toEqual(['at', 'channel']);
  });

  it('documents members on hover and shows how to call them', () => {
    const hover = (code: string): string => {
      const { state, pos } = stateAt(code);
      return JSON.stringify(hoverAt(state, pos, catalog)?.doc ?? null);
    };
    expect(hover('midi.fol|low()')).toContain('follow MIDI clock');
    expect(hover('const f = midi.follow();\nf.bp|m')).toContain('tempo measured');
    const { state, pos } = stateAt("midi.follow('IAC Driver Bus 1', |)");
    expect(JSON.stringify(signatureAt(state, pos, catalog)?.doc ?? null)).toContain(
      'follow(input?',
    );
  });
});

describe('completion for the interaction helpers', () => {
  it('offers them by name, with the names Cracked used', () => {
    expect(labels('keyP|')).toContain('keyPress');
    expect(labels('mouse|')).toContain('mouseMovement');
    expect(labels('key_|')).toContain('key_press');
  });

  it('knows what the callbacks are given, and the options of keyPress', () => {
    expect(labels('keyPress((pressed) => {\n  pressed.|\n});').sort()).toEqual(
      names('keyInfo').sort(),
    );
    expect(labels('keyRelease((released) => {\n  released.|\n});')).toContain('code');
    expect(labels('mouseMovement((mouse) => {\n  mouse.|\n});').sort()).toEqual(
      names('mouseInfo').sort(),
    );
    expect(labels('keyPress(() => {}, { | })')).toEqual(['repeat']);
  });
});
