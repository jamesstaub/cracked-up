import type { NodeDefinition } from '../api';
import { defineNode } from '../define';

function oscillator<K extends string>(
  type: K,
  wave: OscillatorType,
  description: string,
): NodeDefinition<K> {
  return defineNode({
    type,
    category: 'source',
    description,
    params: {
      frequency: {
        default: 440,
        min: 0.01,
        max: 20000,
        unit: 'hz',
        curve: 'log',
        description: 'Pitch. Below about 20 Hz it is a slow wave for modulating other parameters.',
      },
      detune: {
        default: 0,
        min: -1200,
        max: 1200,
        unit: 'cents',
        description: 'Fine pitch offset. 100 cents is one semitone.',
      },
    },
    shorthand: 'frequency',
    triggerable: true,
    options: {
      gate: {
        type: "'open' | 'closed'",
        default: "'open'",
        description:
          'Whether the oscillator is heard as soon as it is created. Closed stays silent until trigger().',
      },
    },
    triggerOptions: {
      duration: { type: 'seconds', description: 'Closes the gate again after this long.' },
      velocity: { type: 'number', default: '1', description: 'Level while the gate is open.' },
    },
    build(context, init) {
      // The oscillator runs from creation; a gate after it decides whether it is heard.
      const osc = new OscillatorNode(context.audio, { type: wave });
      const gate = new GainNode(context.audio, { gain: init['gate'] === 'closed' ? 0 : 1 });
      osc.connect(gate);
      osc.start();
      return {
        output: gate,
        params: { frequency: osc.frequency, detune: osc.detune },
        trigger(options, at) {
          const velocity = typeof options['velocity'] === 'number' ? options['velocity'] : 1;
          gate.gain.setValueAtTime(velocity, at);
          if (typeof options['duration'] === 'number') {
            gate.gain.setValueAtTime(0, at + options['duration']);
          }
        },
        release(_options, at) {
          gate.gain.setValueAtTime(0, at);
        },
        dispose() {
          osc.stop();
          osc.disconnect();
        },
      };
    },
  });
}

const gateNote =
  'Runs from creation: trigger() opens its gate and release() closes it. Shape it with an envelope or a gain.';

export const sine = oscillator('sine', 'sine', `A pure tone with no overtones. ${gateNote}`);
export const saw = oscillator(
  'saw',
  'sawtooth',
  `A bright, buzzy wave with every overtone. ${gateNote}`,
);
export const square = oscillator(
  'square',
  'square',
  `A hollow wave with the odd overtones. ${gateNote}`,
);
export const triangle = oscillator(
  'triangle',
  'triangle',
  `A soft wave, between sine and square. ${gateNote}`,
);
