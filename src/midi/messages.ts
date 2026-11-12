/**
 * MIDI messages as plain objects, and back to bytes. Channels count from 1 to 16, as on instruments.
 * Velocities, controller values and pressures are 0 to 1; pitch bend is -1 to 1.
 */
export type MidiMessage =
  | { type: 'noteon'; channel: number; note: number; velocity: number }
  | { type: 'noteoff'; channel: number; note: number; velocity: number }
  | { type: 'cc'; channel: number; controller: number; value: number }
  | { type: 'pitchbend'; channel: number; value: number }
  | { type: 'program'; channel: number; program: number }
  | { type: 'aftertouch'; channel: number; pressure: number }
  | { type: 'polyaftertouch'; channel: number; note: number; pressure: number }
  /** One of the 24 timing pulses per quarter note. */
  | { type: 'clock' }
  | { type: 'start' }
  | { type: 'continue' }
  | { type: 'stop' }
  /** Where a following `continue` resumes, in quarter notes from the start. */
  | { type: 'songposition'; beats: number }
  /** Anything else (system exclusive, tune request, ...), as received. */
  | { type: 'other'; bytes: readonly number[] };

export type MidiMessageType = MidiMessage['type'];

const unit = (value: number): number => Math.min(127, Math.max(0, Math.round(value * 127)));
const seven = (value: number): number => Math.min(127, Math.max(0, Math.round(value)));

/** Reads one MIDI message. A note-on with velocity 0 is a note-off, as the MIDI standard says. */
export function parseMidi(bytes: ArrayLike<number>): MidiMessage {
  const status = bytes[0] ?? 0;
  const a = bytes[1] ?? 0;
  const b = bytes[2] ?? 0;
  if (status >= 0xf0) {
    switch (status) {
      case 0xf8:
        return { type: 'clock' };
      case 0xfa:
        return { type: 'start' };
      case 0xfb:
        return { type: 'continue' };
      case 0xfc:
        return { type: 'stop' };
      case 0xf2:
        // Counted in sixteenth notes, 14 bits, low byte first.
        return { type: 'songposition', beats: (a | (b << 7)) / 4 };
      default:
        return { type: 'other', bytes: Array.from(bytes) };
    }
  }
  const channel = (status & 0x0f) + 1;
  switch (status & 0xf0) {
    case 0x90:
      return b === 0
        ? { type: 'noteoff', channel, note: a, velocity: 0 }
        : { type: 'noteon', channel, note: a, velocity: b / 127 };
    case 0x80:
      return { type: 'noteoff', channel, note: a, velocity: b / 127 };
    case 0xb0:
      return { type: 'cc', channel, controller: a, value: b / 127 };
    case 0xe0:
      // 14 bits, low byte first, centred on 8192.
      return { type: 'pitchbend', channel, value: Math.max(-1, ((a | (b << 7)) - 8192) / 8191) };
    case 0xc0:
      return { type: 'program', channel, program: a };
    case 0xd0:
      return { type: 'aftertouch', channel, pressure: a / 127 };
    case 0xa0:
      return { type: 'polyaftertouch', channel, note: a, pressure: b / 127 };
    default:
      return { type: 'other', bytes: Array.from(bytes) };
  }
}

/** Turns a message back into the bytes an output expects. */
export function encodeMidi(message: MidiMessage): number[] {
  const status = (base: number, channel: number): number =>
    base | (Math.min(16, Math.max(1, Math.round(channel))) - 1);
  switch (message.type) {
    case 'noteon':
      // Velocity 0 would mean note-off, so a note-on is never quieter than 1.
      return [
        status(0x90, message.channel),
        seven(message.note),
        Math.max(1, unit(message.velocity)),
      ];
    case 'noteoff':
      return [status(0x80, message.channel), seven(message.note), unit(message.velocity)];
    case 'cc':
      return [status(0xb0, message.channel), seven(message.controller), unit(message.value)];
    case 'pitchbend': {
      const value = Math.min(16383, Math.max(0, Math.round(8192 + message.value * 8191)));
      return [status(0xe0, message.channel), value & 0x7f, value >> 7];
    }
    case 'program':
      return [status(0xc0, message.channel), seven(message.program)];
    case 'aftertouch':
      return [status(0xd0, message.channel), unit(message.pressure)];
    case 'polyaftertouch':
      return [status(0xa0, message.channel), seven(message.note), unit(message.pressure)];
    case 'clock':
      return [0xf8];
    case 'start':
      return [0xfa];
    case 'continue':
      return [0xfb];
    case 'stop':
      return [0xfc];
    case 'songposition': {
      const sixteenths = Math.min(16383, Math.max(0, Math.round(message.beats * 4)));
      return [0xf2, sixteenths & 0x7f, sixteenths >> 7];
    }
    case 'other':
      return [...message.bytes];
  }
}
