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
      frequency: { default: 440, min: 0.01, max: 20000, unit: 'hz', curve: 'log' },
      detune: { default: 0, min: -1200, max: 1200, unit: 'cents' },
    },
    shorthand: 'frequency',
    triggerable: true,
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

export const sine = oscillator('sine', 'sine', 'Sine wave oscillator.');
export const saw = oscillator('saw', 'sawtooth', 'Sawtooth wave oscillator.');
export const square = oscillator('square', 'square', 'Square wave oscillator.');
export const triangle = oscillator('triangle', 'triangle', 'Triangle wave oscillator.');
