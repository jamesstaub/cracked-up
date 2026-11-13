/**
 * The composing helpers with their documentation, defined once. A host that runs scripts offers these
 * names to them (`helpers`), the editor (`cracked-up/editor`) completes and documents them, and the
 * demo's side column and the docs page's helper reference are built from the same list.
 *
 * Each entry carries a small example and its result. A test runs every example and compares, so the
 * docs cannot show a result the library does not give.
 */

import * as util from './all';

export interface HelperDoc {
  /** The name a script calls it by. */
  name: string;
  /** How to call it, with optional arguments marked `?`. */
  signature: string;
  /** One line saying what it does. */
  description: string;
  /** An expression using it. It must run with only the helpers in scope. */
  example: string;
  /** Statements the example needs first, shown above it. */
  setup?: string;
  /** What the example gives, written as JavaScript. */
  result: string;
  /** The name the original Cracked library used, when it differs. It works here too. */
  alias?: string;
  fn: unknown;
}

export interface HelperGroup {
  title: string;
  helpers: readonly HelperDoc[];
}

export const HELPER_GROUPS: readonly HelperGroup[] = [
  {
    title: 'Rhythm and lists',
    helpers: [
      {
        name: 'euclid',
        signature: 'euclid(hits, steps, rotate?)',
        description:
          'A rhythm of hits spread as evenly as possible over a number of steps, as 1s and 0s. rotate starts the pattern that many steps later, so the hits come earlier.',
        example: 'euclid(3, 8)',
        result: '[1, 0, 0, 1, 0, 0, 1, 0]',
        fn: util.euclid,
      },
      {
        name: 'onOffPattern',
        signature: 'onOffPattern(on, off, times?)',
        description:
          'That many hits, then that many rests, and the whole group times over (once unless you say).',
        example: 'onOffPattern(3, 2, 2)',
        result: '[1, 1, 1, 0, 0, 1, 1, 1, 0, 0]',
        fn: util.onOffPattern,
      },
      {
        name: 'binaryPattern',
        signature: 'binaryPattern(number, length?)',
        description:
          'A whole number written in binary as steps, biggest digit first: 1 is a hit, 0 a rest. With a length it is exactly that many steps, with rests added at the front.',
        example: 'binaryPattern(13)',
        result: '[1, 1, 0, 1]',
        fn: util.binaryPattern,
      },
      {
        name: 'binaryToNumber',
        signature: 'binaryToNumber(pattern)',
        description:
          'The opposite of binaryPattern: a pattern read as a binary number, biggest digit first.',
        example: "binaryToNumber('xx.x')",
        result: '13',
        fn: util.binaryToNumber,
      },
      {
        name: 'sieve',
        signature: 'sieve(length?, [modulus, offset], ...)',
        description:
          'A hit on every step that is in one of the classes. [3, 0] is every 3rd step starting at step 0, [4, 1] every 4th starting at step 1. Without a length it is as long as it takes for the classes to come round together.',
        example: 'sieve(12, [3, 0], [4, 1])',
        result: '[1, 1, 0, 1, 0, 1, 1, 0, 0, 1, 0, 0]',
        fn: util.sieve,
      },
      {
        name: 'indexes',
        signature: 'indexes(pattern)',
        description:
          'The positions of the hits, counting from 0. It turns a rhythm into a scale: add the numbers to a note and give them to pitchToFreq.',
        example: 'indexes(sieve(12, [2, 0], [5, 1]))',
        result: '[0, 1, 2, 4, 6, 8, 10, 11]',
        fn: util.indexes,
      },
      {
        name: 'countHits',
        signature: 'countHits(pattern)',
        description: 'How many hits a pattern has.',
        example: "countHits('x..x..x.')",
        result: '3',
        fn: util.countHits,
      },
      {
        name: 'patternToString',
        signature: 'patternToString(pattern)',
        description:
          'A pattern as text, x for a hit and . for a rest, to print it or compare two by eye.',
        example: 'patternToString(euclid(3, 8))',
        result: "'x..x..x.'",
        fn: util.patternToString,
      },
      {
        name: 'fillArray',
        signature: 'fillArray(size, fn?)',
        description:
          'A list of that many values. The function is given each position, counting from 0, and returns the value. Without a function the list is all zeros.',
        example: 'fillArray(4, (i) => i * 2)',
        result: '[0, 2, 4, 6]',
        alias: 'fill_array',
        fn: util.fillArray,
      },
      {
        name: 'arrayNext',
        signature: 'arrayNext(list, offset?, limit?, onWrap?)',
        description:
          'The next item of a list on every call, starting over after the last. Keep the list in a variable and pass the same one each time.',
        setup: 'const notes = [60, 64, 67];',
        example: '[arrayNext(notes), arrayNext(notes), arrayNext(notes), arrayNext(notes)]',
        result: '[60, 64, 67, 60]',
        alias: 'array_next',
        fn: util.arrayNext,
      },
      {
        name: 'everyNth',
        signature: 'everyNth(n)',
        description:
          'Makes a function that returns true on every nth call and false on the others.',
        example: '[1, 2, 3, 4, 5, 6].map(everyNth(3))',
        result: '[false, false, true, false, false, true]',
        alias: 'throttle_factory',
        fn: util.everyNth,
      },
      {
        name: 'holdSteps',
        signature: 'holdSteps(counts, fn?)',
        description:
          'Makes a function that stays on each position for a number of calls: [3, 1] is three calls on position 0, then one on position 1, then over again. Each call returns the position, and calls fn(changed, position) if you gave one.',
        example: '[1, 2, 3, 4, 5].map(holdSteps([3, 1]))',
        result: '[0, 0, 0, 1, 0]',
        alias: 'sequence_factory',
        fn: util.holdSteps,
      },
    ],
  },
  {
    title: 'Changing patterns',
    helpers: [
      {
        name: 'rotate',
        signature: 'rotate(pattern, steps)',
        description:
          'Shifts a pattern round. It starts that many steps later, so the hits come earlier, the same way as the rotate of euclid. A negative number goes the other way.',
        example: "rotate('x..x....', 1)",
        result: '[0, 0, 1, 0, 0, 0, 0, 1]',
        fn: util.rotate,
      },
      {
        name: 'reverse',
        signature: 'reverse(pattern)',
        description:
          'The pattern backwards. (To play a sample backwards, use the reverse setting of the sampler.)',
        example: "reverse('x.xx....')",
        result: '[0, 0, 0, 0, 1, 1, 0, 1]',
        fn: util.reverse,
      },
      {
        name: 'invert',
        signature: 'invert(pattern, value?)',
        description: 'Hits become rests, and rests become hits with that value (1 unless you say).',
        example: "invert('x..x')",
        result: '[0, 1, 1, 0]',
        fn: util.invert,
      },
      {
        name: 'stretch',
        signature: 'stretch(pattern, factor)',
        description:
          'Slower, with held steps: every step is repeated factor times, so one hit becomes several in a row.',
        example: "stretch('x.', 2)",
        result: '[1, 1, 0, 0]',
        fn: util.stretch,
      },
      {
        name: 'spread',
        signature: 'spread(pattern, factor)',
        description:
          'Slower, with the same hits: every step is followed by rests so that it takes factor steps.',
        example: "spread('xx.', 2)",
        result: '[1, 0, 1, 0, 0, 0]',
        fn: util.spread,
      },
      {
        name: 'palindrome',
        signature: 'palindrome(pattern, repeatEnds?)',
        description:
          'Forwards, then backwards. The turning points are played once, or twice if repeatEnds is true.',
        example: 'palindrome([1, 2, 3])',
        result: '[1, 2, 3, 2]',
        fn: util.palindrome,
      },
      {
        name: 'repeat',
        signature: 'repeat(pattern, times)',
        description: 'The pattern that many times in a row.',
        example: "repeat('x.', 3)",
        result: '[1, 0, 1, 0, 1, 0]',
        fn: util.repeat,
      },
    ],
  },
  {
    title: 'Combining patterns',
    helpers: [
      {
        name: 'and',
        signature: 'and(a, b)',
        description:
          'A hit only where both patterns have one, with the value from the first, so the second works as a mask. Patterns of different lengths repeat until they line up.',
        example: "and([3, 2, 0, 5], 'x.xx')",
        result: '[3, 0, 0, 5]',
        fn: util.and,
      },
      {
        name: 'or',
        signature: 'or(a, b)',
        description:
          'A hit where either pattern has one: two rhythms on top of each other. Patterns of different lengths repeat until they line up.',
        example: "or('x..', 'x.')",
        result: '[1, 0, 1, 1, 1, 0]',
        fn: util.or,
      },
      {
        name: 'xor',
        signature: 'xor(a, b)',
        description:
          'A hit where one pattern has a hit and the other a rest. Where both hit, they cancel.',
        example: "xor('xx..', 'x.x.')",
        result: '[0, 1, 1, 0]',
        fn: util.xor,
      },
      {
        name: 'interleave',
        signature: 'interleave(...patterns)',
        description:
          'A step from each pattern in turn. Shorter patterns start over until the longest has finished.',
        example: "interleave('xx', '..')",
        result: '[1, 0, 1, 0]',
        fn: util.interleave,
      },
      {
        name: 'concat',
        signature: 'concat(...patterns)',
        description: 'The patterns one after another.',
        example: "concat('x..', [0, 2])",
        result: '[1, 0, 0, 0, 2]',
        fn: util.concat,
      },
    ],
  },
  {
    title: 'Pitch',
    helpers: [
      {
        name: 'pitchToFreq',
        signature: 'pitchToFreq(note)',
        description:
          'A MIDI note number as a frequency in Hz. 69 is the A above middle C, 60 is middle C.',
        example: 'pitchToFreq(69)',
        result: '440',
        alias: 'pitch2freq',
        fn: util.pitchToFreq,
      },
      {
        name: 'freqToPitch',
        signature: 'freqToPitch(hz)',
        description:
          'A frequency in Hz as a MIDI note number. Notes between the keys give fractions.',
        example: 'freqToPitch(880)',
        result: '81',
        alias: 'freq2pitch',
        fn: util.freqToPitch,
      },
      {
        name: 'scales',
        signature: 'scales(name)',
        description:
          'The notes of a scale as semitones above its first note. Names: major, minor, wholetone, overtone, lydian, mixolydian, ionian.',
        example: "scales('minor')",
        result: '[0, 2, 3, 5, 7, 8, 10]',
        fn: util.scales,
      },
      {
        name: 'chords',
        signature: 'chords(name)',
        description:
          'The notes of a chord as semitones above its root. Names: major, minor, seventh, ninth, major_seventh, minor_seventh, suspended, diminished, eleventh, thirteenth.',
        example: "chords('minor_seventh')",
        result: '[0, 3, 7, 10]',
        fn: util.chords,
      },
      {
        name: 'randomScale',
        signature: 'randomScale(name, octaveLow?, octaveHigh?, random?)',
        description:
          'A random note of a scale as a frequency in Hz. The scale starts on C. The octave is picked from octaveLow to octaveHigh (3 to 7 unless you say); octave 5 starts on middle C.',
        example: "randomScale('minor', 5, 5, createRandom(1))",
        result: '391.995',
        alias: 'random_scale',
        fn: util.randomScale,
      },
      {
        name: 'randomArpeggio',
        signature: 'randomArpeggio(name, octaveLow?, octaveHigh?, random?)',
        description: 'The same as randomScale, with the notes of a chord.',
        example: "randomArpeggio('major', 5, 5, createRandom(1))",
        result: '329.628',
        alias: 'random_arpeggio',
        fn: util.randomArpeggio,
      },
    ],
  },
  {
    title: 'Chance',
    helpers: [
      {
        name: 'createRandom',
        signature: 'createRandom(seed)',
        description:
          'A source of random numbers that gives the same numbers every time for the same seed. It has float(), int(min, max), chance(p), pick(list) and shuffle(list), and can be passed as the last argument of the helpers below.',
        example: 'createRandom(1).int(1, 6)',
        result: '4',
        fn: util.createRandom,
      },
      {
        name: 'randomInt',
        signature: 'randomInt(min, max, random?)',
        description: 'A random whole number from min to max, both included.',
        example: 'randomInt(1, 6, createRandom(1))',
        result: '4',
        alias: 'random',
        fn: util.randomInt,
      },
      {
        name: 'randomFloat',
        signature: 'randomFloat(min, max, random?)',
        description: 'A random number from min up to max, fractions included.',
        example: 'randomFloat(200, 800, createRandom(1))',
        result: '576.244',
        fn: util.randomFloat,
      },
      {
        name: 'chance',
        signature: 'chance(probability, random?)',
        description:
          'True that often: 0.25 is one time in four, 0 is never, 1 is always. (Cracked took a percentage; this takes 0 to 1.)',
        example: 'chance(1)',
        result: 'true',
        fn: util.chance,
      },
      {
        name: 'pick',
        signature: 'pick(list, random?)',
        description: 'One item of the list, chosen at random.',
        example: 'pick([60, 64, 67], createRandom(1))',
        result: '64',
        fn: util.pick,
      },
      {
        name: 'shuffle',
        signature: 'shuffle(list, random?)',
        description:
          'The same items in a random order, as a new list. The original is not changed.',
        example: 'shuffle([1, 2, 3, 4], createRandom(1))',
        result: '[4, 2, 1, 3]',
        fn: util.shuffle,
      },
      {
        name: 'randomEnvelope',
        signature: 'randomEnvelope(length, random?)',
        description:
          'Four random lengths that add up to length, for example the four stages of an envelope.',
        example: 'randomEnvelope(1, createRandom(1))',
        result: '[0.293, 0.001, 0.247, 0.459]',
        alias: 'random_envelope',
        fn: util.randomEnvelope,
      },
    ],
  },
  {
    title: 'Numbers and time',
    helpers: [
      {
        name: 'scale',
        signature: "scale(value, inMin, inMax, outMin, outMax, 'linear' | 'log'?)",
        description:
          "Moves a value from one range to another. 'log' spreads it the way pitch and loudness are heard, which suits frequencies.",
        example: "scale(0.5, 0, 1, 100, 1600, 'log')",
        result: '400',
        fn: util.scale,
      },
      {
        name: 'clamp',
        signature: 'clamp(value, min, max)',
        description: 'Keeps a number inside a range.',
        example: 'clamp(1.4, 0, 1)',
        result: '1',
        fn: util.clamp,
      },
      {
        name: 'dbToGain',
        signature: 'dbToGain(db)',
        description: 'Decibels as a gain factor. 0 dB is 1, and every 6 dB down is about half.',
        example: 'dbToGain(-6)',
        result: '0.501',
        fn: util.dbToGain,
      },
      {
        name: 'gainToDb',
        signature: 'gainToDb(gain)',
        description: 'A gain factor as decibels.',
        example: 'gainToDb(0.5)',
        result: '-6.021',
        fn: util.gainToDb,
      },
      {
        name: 'beatsToSeconds',
        signature: 'beatsToSeconds(beats, bpm)',
        description: 'How long a number of beats lasts at a tempo, in seconds.',
        example: 'beatsToSeconds(1, 120)',
        result: '0.5',
        fn: util.beatsToSeconds,
      },
      {
        name: 'secondsToBeats',
        signature: 'secondsToBeats(seconds, bpm)',
        description: 'How many beats fit in a number of seconds at a tempo.',
        example: 'secondsToBeats(2, 90)',
        result: '3',
        fn: util.secondsToBeats,
      },
      {
        name: 'msToSec',
        signature: 'msToSec(ms)',
        description: 'Milliseconds as seconds.',
        example: 'msToSec(250)',
        result: '0.25',
        alias: 'ms2sec',
        fn: util.msToSec,
      },
      {
        name: 'secToMs',
        signature: 'secToMs(seconds)',
        description: 'Seconds as milliseconds.',
        example: 'secToMs(0.25)',
        result: '250',
        alias: 'sec2ms',
        fn: util.secToMs,
      },
      {
        name: 'msToMin',
        signature: 'msToMin(ms)',
        description: 'Milliseconds as minutes.',
        example: 'msToMin(90000)',
        result: '1.5',
        alias: 'ms2min',
        fn: util.msToMin,
      },
      {
        name: 'minToMs',
        signature: 'minToMs(minutes)',
        description: 'Minutes as milliseconds.',
        example: 'minToMs(1.5)',
        result: '90000',
        alias: 'min2ms',
        fn: util.minToMs,
      },
    ],
  },
];

/** Every helper in one list. */
export const HELPER_DOCS: readonly HelperDoc[] = /* @__PURE__ */ HELPER_GROUPS.flatMap(
  (group) => group.helpers,
);

/**
 * Every helper by the name a script calls it by, for a host to put in scope of the scripts it runs.
 * The names the original Cracked library used are included, so both spellings work.
 */
export const helpers: Readonly<Record<string, unknown>> = /* @__PURE__ */ Object.fromEntries(
  HELPER_DOCS.flatMap((doc) =>
    doc.alias
      ? [[doc.name, doc.fn] as const, [doc.alias, doc.fn] as const]
      : [[doc.name, doc.fn] as const],
  ),
);

/**
 * The body of the function a script is compiled into, for `new Function(...Object.keys(helpers), body)`. The helpers are that function's arguments.
 * The code goes in a block of its own so that it may declare a name a helper already has
 * (`const scale = 2`, `const random = createRandom(4)`): inside the block, the code's own name wins.
 * Without the block that would be a syntax error.
 */
export function wrapUserCode(code: string): string {
  return `"use strict"; {\n${code}\n}`;
}
