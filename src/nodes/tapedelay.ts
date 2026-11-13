import type { MacroDefinition, ScopeApi } from '../api';
import { defineMacro } from '../define';

/** A lowpass or highpass `q` is in decibels; -3.01 dB (Butterworth) never boosts, so the loop stays tame. */
const BUTTERWORTH_DB = 20 * Math.log10(Math.SQRT1_2);

/** Speed of the slow pitch drift, in Hz, and how far `wow` at 1 moves the delay time each side, in seconds. */
const WOW_HZ = 0.6;
const WOW_SECONDS = 0.004;
/** The same for the fast shimmer. */
const FLUTTER_HZ = 6.7;
const FLUTTER_SECONDS = 0.0003;
/** How quickly the delay time follows a change of `time`, as the cutoff of a smoothing filter in Hz. */
const GLIDE_HZ = 4;
/** Seconds over which the live repeats and the frozen loop are faded in and out. */
const FADE = 0.01;

/**
 * The tape's saturation is the library's waveshaper with a gain before and after it. With the curve
 * fixed at this `drive`, the three together compute x / (1 + hardness * |x|): quiet sound passes at
 * exactly its own level, and the louder it is the more it is held back. That is what keeps the loop
 * from growing without limit when `feedback` is above 1.
 */
const SHAPER_DRIVE = 20;
/** The waveshaper's gain for quiet sound at that setting. */
const SHAPER_GAIN = (3 + SHAPER_DRIVE) / 9;
/**
 * `drive` 0..1 as hardness: 0.25 takes 2 dB off a full-scale peak and almost nothing off quiet sound,
 * 4 is thick and squashed. It never reaches 0, or nothing would hold a runaway loop back.
 */
const hardness = (drive: number): number => 0.25 * 16 ** Math.min(1, Math.max(0, drive));
const intoTape = (drive: number): number => (hardness(drive) * Math.PI) / SHAPER_DRIVE;
const offTape = (drive: number): number => 1 / (SHAPER_GAIN * intoTape(drive));

const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** A constant signal of 1 for each sample rate in use, shared by every instance at that rate. */
const units = new Map<number, AudioBuffer>();
function unitBuffer(sampleRate: number): AudioBuffer {
  let unit = units.get(sampleRate);
  if (!unit) {
    unit = new AudioBuffer({ length: 128, numberOfChannels: 1, sampleRate });
    unit.getChannelData(0).fill(1);
    units.set(sampleRate, unit);
  }
  return unit;
}

interface FreezeState {
  frozen: boolean;
  /** Audio time at which the loop has been captured and takes over from the live repeats. */
  heldFrom: number;
}

/** Per-instance state, keyed by the instance's private scope (see the synths). */
const states = new WeakMap<ScopeApi, FreezeState>();

function stateOf(__: ScopeApi): FreezeState {
  let state = states.get(__);
  if (!state) {
    state = { frozen: false, heldFrom: 0 };
    states.set(__, state);
  }
  return state;
}

export const tapedelay: MacroDefinition<'tapedelay'> = defineMacro({
  type: 'tapedelay',
  category: 'delay',
  description:
    'An echo in the style of a tape machine. Each repeat comes back a little darker, thinner and softer-edged than the last, and its pitch drifts slightly, the way a worn tape does. Turn feedback up past 1 and the repeats build on themselves into a howl that the tape holds back from getting out of hand. Changing the time while sound is going round bends the pitch of the repeats, like a tape speeding up or slowing down. call("freeze") catches the repeats going round at that moment and loops them unchanged until call("unfreeze"); while it holds them, new sound gets no repeats. For a time that fits the tempo, give it one from the transport: tapedelay(__.transport.seconds(\'1/8d\')).',
  params: {
    time: {
      default: 0.3,
      min: 0.02,
      max: 2,
      unit: 'seconds',
      curve: 'exp',
      description:
        'Time between repeats, in seconds. A change glides there over about a fifth of a second, and the repeats swoop in pitch while it does.',
      drives: [{ select: '#timeTarget', param: 'gain' }],
    },
    feedback: {
      default: 0.45,
      min: 0,
      max: 1.1,
      unit: 'gain',
      description:
        'How much of each repeat goes back onto the tape to make the next. 0 gives one repeat; towards 1 they last a long time; above 1 they grow instead of fading, up to a steady howl.',
      drives: [{ select: '#feedback', param: 'gain' }],
    },
    wow: {
      default: 0.25,
      min: 0,
      max: 1,
      unit: 'normalized',
      description:
        'Slow pitch drift, like a tape running unevenly. 0 is steady; 1 is seasick, about a quarter of a semitone each way on the first repeat and more on each one after.',
      drives: [{ select: '#wow', param: 'depth', scale: { multiply: WOW_SECONDS } }],
    },
    flutter: {
      default: 0.2,
      min: 0,
      max: 1,
      unit: 'normalized',
      description:
        'Fast pitch shimmer, like a worn tape path. 0 is steady; higher gives the repeats a nervous, slightly out-of-tune edge.',
      drives: [{ select: '#flutter', param: 'depth', scale: { multiply: FLUTTER_SECONDS } }],
    },
    tone: {
      default: 3500,
      min: 200,
      max: 20000,
      unit: 'hz',
      curve: 'log',
      description:
        'Brightness of the repeats. Each time round, what is above this is filtered away, so repeats get duller as they fade. Lower is darker.',
      drives: [{ select: '#tone', param: 'frequency' }],
    },
    lowCut: {
      default: 120,
      min: 20,
      max: 2000,
      unit: 'hz',
      curve: 'log',
      description:
        'Each time round, what is below this is filtered away, so repeats get thinner as they fade and bass does not pile up. Higher is thinner.',
      drives: [{ select: '#lowCut', param: 'frequency' }],
    },
    drive: {
      default: 0.3,
      min: 0,
      max: 1,
      unit: 'normalized',
      description:
        'How hard the sound is pushed onto the tape. Low is clean; higher squashes the loud parts of each repeat and makes them thicker and grittier.',
      drives: [
        { select: '#record', param: 'gain', scale: intoTape },
        { select: '#playback', param: 'gain', scale: offTape },
      ],
    },
    mix: {
      default: 0.5,
      min: 0,
      max: 1,
      unit: 'normalized',
      description:
        'Blend between the original and the repeats: 0 is only the original sound, 1 is only the repeats, 0.5 is half of each.',
      drives: [
        { select: '#wet', param: 'gain' },
        { select: '#dry', param: 'gain', scale: { multiply: -1, add: 1 } },
      ],
    },
  },
  shorthand: 'time',
  build(__, _init, macro) {
    const value = (name: string) => num(macro.value(name), 0);
    const time = value('time');
    const drive = value('drive');
    const mix = value('mix');
    const input = __.bus('in').chain();

    __().gain({ id: 'wet', gain: mix }).to('out');
    input.gain({ id: 'dry', gain: 1 - mix }).to('out');

    // The tape loop: onto the tape (saturation), along it (the delay), and off it again (filters).
    // From there the sound is heard, and `feedback` of it goes back onto the tape.
    const heard = input
      .gain({ id: 'record', gain: intoTape(drive) })
      // Oversampling would make every trip round the loop 4 ms late in Chromium and WebKit.
      .waveshaper({ id: 'tape', drive: SHAPER_DRIVE, oversample: 'none' })
      .gain({ id: 'playback', gain: offTape(drive) })
      .delayline({ id: 'line', time })
      .highpass({ id: 'lowCut', frequency: value('lowCut'), q: BUTTERWORTH_DB })
      .lowpass({ id: 'tone', frequency: value('tone'), q: BUTTERWORTH_DB });
    heard.gain({ id: 'feedback', gain: value('feedback') }).connect('#record');

    // What is heard is either the live repeats or, while frozen, the looper's copy of them.
    heard.gain({ id: 'live' }).connect('#wet');
    heard.looper({ id: 'hold', monitor: 0 }).connect('#wet');

    // Wow and flutter: two slow waves that lengthen and shorten the delay, which bends the pitch.
    __()
      .lfo({ id: 'wow', frequency: WOW_HZ, depth: value('wow') * WOW_SECONDS })
      .modulate('#line', 'time');
    __()
      .lfo({ id: 'flutter', frequency: FLUTTER_HZ, depth: value('flutter') * FLUTTER_SECONDS })
      .modulate('#line', 'time');

    // A change of `time` must not jump, which would click. The delay starts at the time it is made
    // with, and what is added to that is the difference between the time asked for and the starting
    // time, as a signal through a very low lowpass: it moves smoothly, as a tape motor changes speed.
    __()
      .sampler({
        id: 'unit',
        buffer: unitBuffer(__.scope.engine.context.sampleRate),
        loop: true,
      })
      .split(
        (one) => one.gain({ id: 'timeTarget', gain: time }),
        (one) => one.gain({ id: 'timeStart', gain: -time }),
      )
      // `smooth`, not a lowpass: at 4 Hz the browser's lowpass is 22% out in Chromium off macOS.
      .smooth({ id: 'glide', frequency: GLIDE_HZ })
      .modulate('#line', 'time');
    __('#unit').trigger();
  },
  methods: {
    freeze(__, _args, at, macro) {
      const state = stateOf(__);
      if (state.frozen) return;
      // One trip round the tape holds everything that is repeating, so that is the loop's length.
      // The looper counts in beats; the transport says how long a beat is.
      const beats = num(macro.value('time', at), 0.3) / __.transport.seconds(1);
      const seconds = __.transport.seconds(beats);
      __('#hold').trigger({ at, length: beats });
      // When the loop is full it starts to play, and the live repeats make way for it.
      __('#live')
        .param('gain')
        .ramp(0, { at: at + seconds, duration: FADE });
      state.frozen = true;
      state.heldFrom = at + seconds;
    },
    unfreeze(__, _args, at) {
      const state = stateOf(__);
      if (!state.frozen) return;
      state.frozen = false;
      const live = __('#live').param('gain');
      if (at < state.heldFrom) {
        // Still capturing: the live repeats never left.
        live.cancel({ at });
        live.set(1, { at });
      } else {
        live.ramp(1, { at, duration: FADE, from: 0 });
      }
      const hold = __('#hold');
      hold.param('gain').ramp(0, { at, duration: FADE });
      hold.call('clear', {}, { at: at + FADE });
      hold.set({ gain: 1 }, { at: at + 2 * FADE });
    },
  },
});
