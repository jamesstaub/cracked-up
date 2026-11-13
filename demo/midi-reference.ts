/**
 * The MIDI reference shown in the docs: every member of the objects `cracked-up/midi` gives you.
 * The members come from the same descriptions the editor's completion shows. A test checks each name
 * against a live object, so the list cannot name something that is not there.
 */

import { API } from '../src/editor/api-docs';

export interface MemberDoc {
  name: string;
  /** How to call it. A property has none. */
  signature?: string;
  description: string;
}

/** Functions exported by `cracked-up/midi`. */
export const MIDI_FUNCTIONS: readonly MemberDoc[] = [
  {
    name: 'requestMidi',
    signature: 'requestMidi(engine, options?)',
    description:
      "Asks the browser for MIDI access and gives a midi object. The browser asks the user's permission the first time. It fails where there is no Web MIDI, which includes Safari.",
  },
  {
    name: 'createMidi',
    signature: 'createMidi(engine, access, options?)',
    description:
      'The same from a MIDI access object you already have, or a stand-in for one in tests.',
  },
  {
    name: 'parseMidi',
    signature: 'parseMidi(bytes)',
    description: 'Raw MIDI bytes as a message object such as { type, channel, note, velocity }.',
  },
  {
    name: 'encodeMidi',
    signature: 'encodeMidi(message)',
    description: 'A message object as raw MIDI bytes.',
  },
];

/** Members of the object `requestMidi` and `createMidi` give. */
export const MIDI_MEMBERS: readonly MemberDoc[] = API.midi;
/** Members of an output, from `midi.output()`. Each sending method returns the output, so calls chain. */
export const MIDI_OUT_MEMBERS: readonly MemberDoc[] = API.midiOut;
/** Members of what `midi.follow()` gives. */
export const MIDI_FOLLOW_MEMBERS: readonly MemberDoc[] = API.follow;
/** Members of the message a `midi.on` listener is given. */
export const MIDI_EVENT_MEMBERS: readonly MemberDoc[] = API.midiEvent;
