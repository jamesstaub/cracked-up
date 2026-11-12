import type {
  Chain,
  MacroContext,
  MacroDefinition,
  MacroParam,
  OptionInfo,
  ReleaseOptions,
  ScopeApi,
} from '../api';
import { defineMacro } from '../define';
import { pitchToFreq } from '../util/music';

type Shape = 'sine' | 'saw' | 'square' | 'triangle';
const SHAPES: readonly Shape[] = ['sine', 'saw', 'square', 'triangle'];

/** Shared parameter set. `target(name)` says which inner nodes (by selector) a parameter drives. */
function synthParams(
  target: (name: 'osc' | 'filter' | 'env') => string,
): Record<string, MacroParam> {
  return {
    cutoff: {
      default: 2000,
      min: 20,
      max: 20000,
      unit: 'hz',
      curve: 'log',
      description:
        'Brightness. Frequencies above this are filtered out, so lower is darker and duller.',
      drives: [{ select: target('filter'), param: 'frequency' }],
    },
    resonance: {
      default: 1,
      min: 0.0001,
      max: 30,
      unit: 'q',
      description:
        'Emphasis of the frequencies right at the cutoff. High values give a sharp, whistling edge.',
      drives: [{ select: target('filter'), param: 'q' }],
    },
    attack: {
      default: 0.01,
      min: 0,
      max: 5,
      unit: 'seconds',
      curve: 'exp',
      rate: 'control',
      description: 'Seconds for a note to rise from silence to full level.',
      drives: [{ select: target('env'), param: 'attack' }],
    },
    decay: {
      default: 0.1,
      min: 0,
      max: 5,
      unit: 'seconds',
      curve: 'exp',
      rate: 'control',
      description: 'Seconds for a note to fall from full level to the sustain level.',
      drives: [{ select: target('env'), param: 'decay' }],
    },
    sustain: {
      default: 0.5,
      min: 0,
      max: 1,
      unit: 'gain',
      rate: 'control',
      description: 'The level a held note stays at, as a fraction of full level.',
      drives: [{ select: target('env'), param: 'sustain' }],
    },
    release: {
      default: 0.2,
      min: 0,
      max: 10,
      unit: 'seconds',
      curve: 'exp',
      rate: 'control',
      description:
        'Seconds for a note to fade to silence after it is released. Set with set({ release }); release() itself is the action.',
      drives: [{ select: target('env'), param: 'release' }],
    },
    detune: {
      default: 0,
      min: -1200,
      max: 1200,
      unit: 'cents',
      description: 'Fine pitch offset for every note. 100 cents is one semitone.',
      drives: [{ select: target('osc'), param: 'detune' }],
    },
    lfoRate: {
      default: 5,
      min: 0.01,
      max: 50,
      unit: 'hz',
      curve: 'log',
      description: 'How many times per second the pitch wobble (vibrato) repeats.',
      drives: [{ select: '#lfo', param: 'frequency' }],
    },
    lfoDepth: {
      default: 0,
      min: 0,
      max: 100,
      unit: 'hz',
      description: 'How far the pitch wobble moves the pitch each side, in Hz. 0 is no wobble.',
      drives: [{ select: '#lfo', param: 'depth' }],
    },
    gain: {
      default: 0.5,
      min: 0,
      max: 2,
      unit: 'gain',
      description: 'Overall output level.',
      drives: [{ select: '#level', param: 'gain' }],
    },
  };
}

const shapeOption: OptionInfo = {
  type: "'sine' | 'saw' | 'square' | 'triangle'",
  default: "'saw'",
  description:
    'The oscillator wave: sine is pure, triangle is soft, square is hollow, saw is bright and buzzy.',
};

const triggerOptions: Record<string, OptionInfo> = {
  pitch: {
    type: 'number',
    description: 'MIDI note number (60 is middle C, 69 is A 440). Fractions are allowed. Required.',
  },
  velocity: {
    type: 'number',
    default: '1',
    description: 'How hard the note is played, 0 to 1. Scales its level.',
  },
  duration: {
    type: 'seconds',
    description:
      'Releases the note automatically this long after it starts. Omitted: held until release().',
  },
};

// --- helpers ---------------------------------------------------------------------------------------

const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

function shapeOf(init: Readonly<Record<string, unknown>>): Shape {
  const shape = init['shape'];
  return SHAPES.find((name) => name === shape) ?? 'saw';
}

/** A chain's oscillator method for a shape: `__().sine(...)`, `__().saw(...)`. */
function oscillator(chain: Chain, shape: Shape, init: Parameters<Chain['sine']>[0]): Chain {
  return chain[shape](init);
}

interface Note {
  pitch: number;
  velocity: number;
  duration: number | undefined;
}

function readNote(args: Readonly<Record<string, unknown>>): Note {
  const pitch = args['pitch'];
  if (typeof pitch !== 'number' || !Number.isFinite(pitch)) {
    throw new Error('A synth note needs a numeric `pitch` (a MIDI note number).');
  }
  const duration = args['duration'];
  return {
    pitch,
    velocity: Math.min(1, Math.max(0, num(args['velocity'], 1))),
    duration: typeof duration === 'number' && Number.isFinite(duration) ? duration : undefined,
  };
}

/** The pitch lfo both synths share. It is connected to each oscillator's frequency as that is made. */
function buildLfo(__: ScopeApi, macro: MacroContext): void {
  const value = (name: string) => num(macro.value(name), 0);
  __().lfo({ id: 'lfo', frequency: value('lfoRate'), depth: value('lfoDepth') });
}

// --- monosynth -------------------------------------------------------------------------------------

export const monosynth: MacroDefinition<'monosynth'> = defineMacro({
  type: 'monosynth',
  category: 'synth',
  description:
    'A one-voice synthesiser: an oscillator through a lowpass filter and an envelope, with an optional vibrato. A new note while one is sounding moves the pitch and retriggers the envelope, like a classic monophonic keyboard. Play it with trigger({ pitch }).',
  params: synthParams((name) => `#${name}`),
  options: { shape: shapeOption },
  triggerOptions,
  build(__, init, macro) {
    const value = (name: string) => num(macro.value(name), 0);
    buildLfo(__, macro);
    oscillator(__(), shapeOf(init), { id: 'osc', detune: value('detune') })
      .lowpass({ id: 'filter', frequency: value('cutoff'), q: value('resonance') })
      .adsr({
        id: 'env',
        attack: value('attack'),
        decay: value('decay'),
        sustain: value('sustain'),
        release: value('release'),
      })
      .gain({ id: 'level', gain: value('gain') })
      .to('out');
    __('#lfo').chain().modulate('#osc', 'frequency');
  },
  trigger(__, options) {
    playMono(__, options);
  },
  release(__, options) {
    __('#env').release({ at: options.at as number });
  },
  methods: {
    noteOn(__, args, at) {
      playMono(__, { ...args, at });
    },
    noteOff(__, _args, at) {
      __('#env').release({ at });
    },
  },
});

function playMono(__: ScopeApi, options: Readonly<Record<string, unknown>>): void {
  const note = readNote(options);
  const at = options['at'] as number;
  __('#osc').set({ frequency: pitchToFreq(note.pitch) }, { at });
  __('#env').trigger({
    at,
    velocity: note.velocity,
    ...(note.duration === undefined ? {} : { duration: note.duration }),
  });
}

// --- polysynth -------------------------------------------------------------------------------------

/** One sounding (or fading) note. */
interface Voice {
  /** Unique within the instance; the voice's nodes carry the class `v<n>`. */
  readonly n: number;
  pitch: number;
  /** Audio time the release starts; Infinity while the note is held with no duration. */
  releaseAt: number;
  /** Audio time the sound has fully faded; Infinity while held. */
  end: number;
}

interface PolyState {
  /** In order of last trigger, oldest first. */
  voices: Voice[];
  counter: number;
  /** The instance's creation options, for `shape` and `voices` when a note arrives. */
  init: Readonly<Record<string, unknown>>;
}

/**
 * Per-instance state. The scope handed to build, trigger, release and methods is the same object for
 * one instance and a different one for each other instance, so it identifies the instance.
 */
const states = new WeakMap<ScopeApi, PolyState>();

function stateOf(__: ScopeApi): PolyState {
  let state = states.get(__);
  if (!state) {
    state = { voices: [], counter: 0, init: {} };
    states.set(__, state);
  }
  return state;
}

function releaseVoice(__: ScopeApi, voice: Voice, at: number, macro: MacroContext): void {
  if (at >= voice.releaseAt) return; // already releasing by then
  __(`.env.v${voice.n}`).release({ at });
  voice.releaseAt = at;
  voice.end = at + num(macro.value('release', at), 0);
}

/**
 * Which voice plays a note starting at `at`, and whether it is new. A voice is free once its release
 * has finished by `at`. Finished voices are reused rather than disposed: offline, every callback runs
 * before rendering starts, so a voice disposed at call time would take its already scheduled sound
 * with it. Reuse also keeps the node count at most `voices`, with no clock to consult.
 */
function pickVoice(state: PolyState, pitch: number, at: number, max: number): Voice | null {
  // The same note again retriggers its own voice, even while that is still fading.
  const same = state.voices.find((voice) => voice.pitch === pitch && voice.end > at);
  if (same) return same;
  const free = state.voices.find((voice) => voice.end <= at);
  if (free) return free;
  if (state.voices.length < max) return null;
  // All in use: take the voice nearest to silence, else the oldest held note.
  const fading = state.voices
    .filter((voice) => voice.releaseAt <= at)
    .sort((a, b) => a.end - b.end)[0];
  return fading ?? state.voices[0] ?? null;
}

function playPoly(
  __: ScopeApi,
  args: Readonly<Record<string, unknown>>,
  at: number,
  macro: MacroContext,
): void {
  const note = readNote(args);
  const state = stateOf(__);
  const init = state.init;
  const max = Math.max(1, Math.floor(num(init['voices'], 8)));
  const picked = pickVoice(state, note.pitch, at, max);

  let voice: Voice;
  if (picked) {
    voice = picked;
    // Most recently played goes last, so the oldest held note is first in line to be taken over.
    state.voices = [...state.voices.filter((other) => other !== voice), voice];
    if (voice.pitch !== note.pitch) {
      __(`.osc.v${voice.n}`).set({ frequency: pitchToFreq(note.pitch) }, { at });
      voice.pitch = note.pitch;
    }
  } else {
    const value = (name: string) => num(macro.value(name, at), 0);
    const n = ++state.counter;
    const classes = ['voice', `v${n}`];
    oscillator(__(), shapeOf(init), {
      class: [...classes, 'osc'],
      frequency: pitchToFreq(note.pitch),
      detune: value('detune'),
    })
      .lowpass({ class: [...classes, 'filter'], frequency: value('cutoff'), q: value('resonance') })
      .adsr({
        class: [...classes, 'env'],
        attack: value('attack'),
        decay: value('decay'),
        sustain: value('sustain'),
        release: value('release'),
      })
      .connect('#level');
    __('#lfo').chain().modulate(`.osc.v${n}`, 'frequency');
    voice = { n, pitch: note.pitch, releaseAt: Infinity, end: Infinity };
    state.voices.push(voice);
  }

  __(`.env.v${voice.n}`).trigger({
    at,
    velocity: note.velocity,
    ...(note.duration === undefined ? {} : { duration: note.duration }),
  });
  voice.releaseAt = note.duration === undefined ? Infinity : at + note.duration;
  voice.end =
    note.duration === undefined
      ? Infinity
      : at + note.duration + num(macro.value('release', at + note.duration), 0);
}

function releasePoly(__: ScopeApi, options: ReleaseOptions, at: number, macro: MacroContext): void {
  for (const voice of stateOf(__).voices) {
    if (options.pitch === undefined || voice.pitch === options.pitch) {
      releaseVoice(__, voice, at, macro);
    }
  }
}

export const polysynth: MacroDefinition<'polysynth'> = defineMacro({
  type: 'polysynth',
  category: 'synth',
  description:
    'A several-voice synthesiser: every note gets its own oscillator, lowpass filter and envelope, so chords ring together and each note fades on its own. Play notes with trigger({ pitch }) and end them with release({ pitch }), or release() for all. When all voices are busy, the oldest note is cut short to make room.',
  params: synthParams((name) => `.${name}`),
  options: {
    shape: shapeOption,
    voices: {
      type: 'number',
      default: '8',
      description: 'The most notes that can sound at once. A further note takes over the oldest.',
    },
  },
  triggerOptions,
  build(__, init, macro) {
    const value = (name: string) => num(macro.value(name), 0);
    stateOf(__).init = init;
    buildLfo(__, macro);
    // Every voice ends here, and the level control sits on it.
    __()
      .gain({ id: 'level', gain: value('gain') })
      .to('out');
  },
  trigger(__, options, macro) {
    playPoly(__, options, options.at as number, macro);
  },
  release(__, options, macro) {
    releasePoly(__, options, options.at as number, macro);
  },
  methods: {
    noteOn(__, args, at, macro) {
      playPoly(__, args, at, macro);
    },
    noteOff(__, args, at, macro) {
      const pitch = args['pitch'];
      releasePoly(__, typeof pitch === 'number' ? { pitch, at } : { at }, at, macro);
    },
  },
});
