/**
 * The MIDI reference shown in the docs: every member of the objects `cracked-up/midi` gives you.
 * A test checks each name against a live object, so the list cannot name something that is not there.
 */

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
export const MIDI_MEMBERS: readonly MemberDoc[] = [
  { name: 'inputs', description: 'The MIDI inputs connected now, each with id, name and maker.' },
  { name: 'outputs', description: 'The MIDI outputs connected now.' },
  {
    name: 'on',
    signature: 'on(type, listener, filter?)',
    description:
      "Calls back for every message of one kind ('noteon', 'noteoff', 'cc', 'pitchbend', …), for all of them with 'message', or when a device is plugged in or removed with 'devices'. The filter narrows it to an input or channel. Returns a function that stops it.",
  },
  {
    name: 'play',
    signature: 'play(target, filter?)',
    description:
      'Plays arriving notes on the selected nodes: a note-on triggers with its pitch and velocity, a note-off releases it. Returns a function that stops it.',
  },
  {
    name: 'bind',
    signature: 'bind({ controller, channel?, input? }, target)',
    description:
      "Ties a controller (a knob or fader) to a parameter. The controller's travel covers the parameter's range.",
  },
  {
    name: 'learn',
    signature: 'learn(target, filter?)',
    description:
      'Ties the next controller that is moved to the parameter. A promise that resolves once one has been.',
  },
  {
    name: 'cancelLearn',
    signature: 'cancelLearn()',
    description: 'Stops waiting for a controller.',
  },
  { name: 'bindings', description: 'The controller bindings in place. Each has remove().' },
  {
    name: 'output',
    signature: 'output(idOrName?)',
    description: 'An output to send to, by id or name; the first one when no name is given.',
  },
  {
    name: 'sendClock',
    signature: 'sendClock(output?)',
    description:
      'Sends MIDI clock so other gear follows the transport: 24 pulses per quarter note, Start, Stop and Continue. Returns a function that stops it.',
  },
  {
    name: 'follow',
    signature: 'follow(input?, options?)',
    description:
      'Makes the transport follow MIDI clock arriving on an input: its start and stop, tempo and position. Gives an object with bpm, error and stop().',
  },
  {
    name: 'dispose',
    signature: 'dispose()',
    description: 'Removes every listener and binding and stops sending and following.',
  },
];

/** Members of an output, from `midi.output()`. Each sending method returns the output, so calls chain. */
export const MIDI_OUT_MEMBERS: readonly MemberDoc[] = [
  { name: 'port', description: 'The device: its id, name and maker.' },
  { name: 'channel', description: 'The channel used when a call gives none. Starts as 1.' },
  {
    name: 'note',
    signature: 'note(note, { duration?, velocity?, channel?, at? }?)',
    description: 'A note-on now, or at a time, and its note-off duration seconds later.',
  },
  {
    name: 'noteOn',
    signature: 'noteOn(note, velocity?, { channel?, at? }?)',
    description: 'Starts a note. It sounds until its noteOff.',
  },
  { name: 'noteOff', signature: 'noteOff(note, { channel?, at? }?)', description: 'Ends a note.' },
  {
    name: 'cc',
    signature: 'cc(controller, value, { channel?, at? }?)',
    description: 'Sends a controller value, 0 to 127.',
  },
  {
    name: 'pitchBend',
    signature: 'pitchBend(value, { channel?, at? }?)',
    description: 'Bends the pitch: -1 is fully down, 0 is centre, 1 is fully up.',
  },
  {
    name: 'program',
    signature: 'program(number, { channel?, at? }?)',
    description: 'Changes the sound (program) on the receiving device.',
  },
  {
    name: 'send',
    signature: 'send(message, { at? }?)',
    description: 'Sends any message object, or raw bytes.',
  },
];
