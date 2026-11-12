import { defineNode } from '../define';

type Color = 'white' | 'pink' | 'brown';

/**
 * One channel of looping noise. All values come from `random`, so a seeded engine makes the same noise
 * every time. Scaling follows the original library so the three colours sit at similar loudness.
 */
function noiseData(color: Color, length: number, random: () => number): Float32Array<ArrayBuffer> {
  const data = new Float32Array(length);
  if (color === 'white') {
    for (let i = 0; i < length; i++) data[i] = (random() * 2 - 1) * 0.44;
  } else if (color === 'pink') {
    // Paul Kellet's filter: white noise through a bank of one-pole filters that tilts it by 3 dB per octave.
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;
    for (let i = 0; i < length; i++) {
      const white = random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
  } else {
    // A leaky integrator: each sample is mostly the last one plus a little new noise, so it drifts slowly.
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
  }
  return data;
}

export const noise = defineNode({
  type: 'noise',
  category: 'source',
  description:
    'Hiss. White noise is bright and even, pink is softer and more natural (like rain), brown is a deep rumble. Runs from creation: trigger() opens its gate and release() closes it. Shape it with an envelope or a filter.',
  params: {
    gain: { default: 1, min: 0, max: 2, unit: 'gain', description: 'Output level.' },
  },
  options: {
    color: {
      type: "'white' | 'pink' | 'brown'",
      default: "'white'",
      description:
        'The kind of noise. White has equal energy at every frequency; pink has less at high frequencies; brown has much less, so it sounds deep.',
    },
    gate: {
      type: "'open' | 'closed'",
      default: "'open'",
      description:
        'Whether the noise is heard as soon as it is created. Closed stays silent until trigger().',
    },
  },
  triggerable: true,
  triggerOptions: {
    duration: { type: 'seconds', description: 'Closes the gate again after this long.' },
    velocity: { type: 'number', default: '1', description: 'Level while the gate is open.' },
  },
  build(context, init) {
    const audio = context.audio;
    const color: Color =
      init['color'] === 'pink' || init['color'] === 'brown' ? init['color'] : 'white';
    const length = Math.round(audio.sampleRate * 2);
    const buffer = new AudioBuffer({ length, numberOfChannels: 1, sampleRate: audio.sampleRate });
    buffer.copyToChannel(noiseData(color, length, context.random), 0);

    const source = new AudioBufferSourceNode(audio, { buffer, loop: true });
    const level = new GainNode(audio);
    const gate = new GainNode(audio, { gain: init['gate'] === 'closed' ? 0 : 1 });
    source.connect(level).connect(gate);
    source.start();

    return {
      output: gate,
      params: { gain: level.gain },
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
        source.stop();
        source.disconnect();
        level.disconnect();
        gate.disconnect();
      },
    };
  },
});
