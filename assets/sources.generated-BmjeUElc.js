var e={gain:{parts:[{file:`src/nodes/basic.ts`,line:5,endLine:24,code:`export const gain = defineNode({
  type: 'gain',
  category: 'utility',
  description:
    'Multiplies the signal by a factor: 1 leaves it unchanged, 0.5 halves it, 0 silences it. Also used to set how strongly one signal modulates a parameter.',
  params: {
    gain: {
      default: 1,
      min: 0,
      max: 2,
      unit: 'gain',
      description: 'The factor. May go beyond the control range, including negative values.',
    },
  },
  shorthand: 'gain',
  build(context) {
    const node = new GainNode(context.audio);
    return { input: node, output: node, params: { gain: node.gain } };
  },
});`}],native:[`GainNode`]},panner:{parts:[{file:`src/nodes/basic.ts`,line:26,endLine:44,code:`export const panner = defineNode({
  type: 'panner',
  category: 'utility',
  description: 'Places the signal between the left and right speakers.',
  params: {
    pan: {
      default: 0,
      min: -1,
      max: 1,
      unit: 'pan',
      description: '-1 is left, 0 centre, 1 right.',
    },
  },
  shorthand: 'pan',
  build(context) {
    const node = new StereoPannerNode(context.audio);
    return { input: node, output: node, params: { pan: node.pan } };
  },
});`}],native:[`StereoPannerNode`]},compressor:{parts:[{file:`src/nodes/basic.ts`,line:83,endLine:198,code:`export const compressor = defineNode({
  type: 'compressor',
  category: 'dynamics',
  description:
    'Turns loud passages down, evening out the level. It also turns everything up a little to make up for that, more so the lower the threshold and the higher the ratio, so quiet sounds come out louder than they went in.',
  params: {
    threshold: {
      default: -24,
      min: -100,
      max: 0,
      unit: 'db',
      description: 'Level above which the signal is turned down.',
    },
    knee: {
      default: 30,
      min: 0,
      max: 40,
      unit: 'db',
      description: 'How gradually compression sets in around the threshold.',
    },
    ratio: {
      default: 12,
      min: 1,
      max: 20,
      unit: 'ratio',
      description: 'How strongly levels above the threshold are reduced.',
    },
    attack: {
      default: 0.003,
      min: 0,
      max: 1,
      unit: 'seconds',
      curve: 'exp',
      description: 'How quickly it reacts to a loud signal.',
    },
    release: {
      default: 0.25,
      min: 0,
      max: 1,
      unit: 'seconds',
      curve: 'exp',
      description: 'How quickly it lets go afterwards. Set with set({ release }).',
    },
  },
  options: {
    makeup: {
      type: 'boolean',
      default: 'true',
      description:
        'Whether the compressor turns everything up to make up for what it takes away. With false, sound below the threshold comes out at the level it went in and only what is above is turned down. Threshold, knee and ratio then change at the time asked but cannot be ramped or modulated.',
    },
  },
  build(context, init) {
    const audio = context.audio;
    const node = new DynamicsCompressorNode(audio);
    // A compressor that has not been running lets sound in gradually: measured in Firefox, the first
    // 25 ms after a silence come out 10 to 14 dB down, because Firefox stops running the node while
    // its input is silent. That swallows the attack of every drum hit. A constant far too small to
    // hear or to move the compressor (600 dB below full scale) keeps it running.
    const awake = new ConstantSourceNode(audio, { offset: 1e-30 });
    awake.connect(node);
    awake.start();
    const dispose = (): void => {
      awake.stop();
      awake.disconnect();
    };

    if (init['makeup'] !== false) {
      return {
        input: node,
        output: node,
        params: {
          threshold: node.threshold,
          knee: node.knee,
          ratio: node.ratio,
          attack: node.attack,
          release: node.release,
        },
        dispose,
      };
    }

    // Without make-up: a gain after the compressor undoes what it adds. That gain depends on three
    // settings together, so each of them is set through a function that also resets the gain.
    const level = new GainNode(audio);
    node.connect(level);
    const settings = {
      threshold: node.threshold.value,
      knee: node.knee.value,
      ratio: node.ratio.value,
    };
    const setting =
      (name: keyof typeof settings): ParamHandler =>
      (value, at) => {
        settings[name] = value as number;
        node[name].setValueAtTime(settings[name], at);
        const makeup = compressorMakeup(settings.threshold, settings.knee, settings.ratio);
        level.gain.setValueAtTime(1 / makeup, at);
      };
    return {
      input: node,
      output: level,
      params: {
        threshold: setting('threshold'),
        knee: setting('knee'),
        ratio: setting('ratio'),
        attack: node.attack,
        release: node.release,
      },
      dispose() {
        dispose();
        node.disconnect();
      },
    };
  },
});`}],native:[`DynamicsCompressorNode`,`ConstantSourceNode`,`GainNode`]},bitcrusher:{parts:[{file:`src/nodes/bitcrusher.ts`,line:4,endLine:44,code:`export const bitcrusher = defineNode({
  type: 'bitcrusher',
  category: 'distortion',
  description:
    'Makes the sound gritty and digital in two ways: fewer loudness levels (bits) and fewer samples per second (rate).',
  params: {
    bits: {
      default: 8,
      min: 1,
      max: 16,
      step: 1,
      rate: 'audio',
      description:
        'How many bits describe each sample. 16 is clean; below about 6 is harsh and noisy.',
    },
    rate: {
      default: 1,
      min: 0.0001,
      max: 1,
      curve: 'log',
      unit: 'ratio',
      rate: 'audio',
      description:
        'What fraction of the samples are kept. 1 keeps every one; 0.1 keeps one in ten, which sounds metallic.',
    },
  },
  build(context) {
    const node = context.worklet(BITCRUSHER, { numberOfInputs: 1, numberOfOutputs: 1 });
    return {
      input: node,
      output: node,
      params: {
        bits: node.parameters.get('bits')!,
        rate: node.parameters.get('rate')!,
      },
      dispose() {
        node.disconnect();
      },
    };
  },
});`}],native:[]},delay:{parts:[{file:`src/nodes/delays.ts`,line:85,endLine:93,code:`export const delay = echo('delay', {
  description:
    'An echo: the sound repeats after a set time, and each repeat is quieter (and, with the cutoff turned down, duller) than the last.',
  time: { default: 0.25, min: 0.001, description: 'Time between echoes, in seconds.' },
  timeMax: 2,
  feedback: { default: 0.4, max: 0.95 },
  cutoff: 20000,
  mix: 0.5,
});`},{label:`echo(), which builds it`,file:`src/nodes/delays.ts`,line:14,endLine:83,code:`function echo<K extends string>(type: K, spec: EchoSpec): NodeDefinition<K> {
  const params: Record<string, ParamMetaInput> = {
    time: {
      default: spec.time.default,
      min: spec.time.min,
      max: spec.timeMax,
      unit: 'seconds',
      curve: 'exp',
      description: spec.time.description,
    },
    feedback: {
      default: spec.feedback.default,
      min: 0,
      max: spec.feedback.max,
      unit: 'gain',
      description:
        'How much of each echo is fed back into the delay to make the next one. 0 gives a single echo; closer to the maximum, the echoes last longer.',
    },
    cutoff: {
      default: spec.cutoff,
      min: 20,
      max: 20000,
      unit: 'hz',
      curve: 'log',
      description:
        'A lowpass filter on the fed-back sound: each repeat loses the frequencies above this, so the echoes get duller. The top of the range leaves them bright.',
    },
    mix: mixParam(spec.mix),
  };
  return defineNode({
    type,
    category: 'delay',
    description: spec.description,
    params,
    shorthand: 'time',
    build(context) {
      const audio = context.audio;
      const input = new GainNode(audio);
      const output = new GainNode(audio);
      const delay = new DelayNode(audio, { maxDelayTime: 5, delayTime: spec.time.default });
      // A lowpass's Q is in decibels. The default of 1 dB gives a resonant peak that can push the loop's
      // gain above 1 near the cutoff, and the echoes would grow instead of fading; -3.01 dB (a Butterworth
      // response) never amplifies, so feedback below 1 always dies away.
      const tone = new BiquadFilterNode(audio, { type: 'lowpass', Q: -3.0103 });
      const feedback = new GainNode(audio);
      const mix = createMix(audio);

      input.connect(mix.dry).connect(output);
      input.connect(delay);
      delay.connect(mix.wet).connect(output);
      delay.connect(tone).connect(feedback).connect(delay);

      return {
        input,
        output,
        params: {
          time: delay.delayTime,
          feedback: feedback.gain,
          cutoff: tone.frequency,
          mix: mix.handler,
        },
        dispose() {
          for (const node of [input, output, delay, tone, feedback, mix.dry, mix.wet]) {
            node.disconnect();
          }
        },
      };
    },
  });
}`}],native:[`GainNode`,`DelayNode`,`BiquadFilterNode`]},comb:{parts:[{file:`src/nodes/delays.ts`,line:95,endLine:108,code:`export const comb = echo('comb', {
  description:
    'A very short echo that repeats so fast it blurs into a pitched ring: the sound is coloured with a note whose pitch is 1 divided by the time. Good for metallic or plucked-string tones.',
  time: {
    default: 0.027,
    min: 0.0005,
    description:
      'Time between repeats, in seconds. The ring is at 1 divided by this many Hz. Browsers cannot loop a delay shorter than about 0.003 seconds, so shorter settings behave as 0.003.',
  },
  timeMax: 0.1,
  feedback: { default: 0.84, max: 0.98 },
  cutoff: 3000,
  mix: 1,
});`},{label:`echo(), which builds it`,file:`src/nodes/delays.ts`,line:14,endLine:83,code:`function echo<K extends string>(type: K, spec: EchoSpec): NodeDefinition<K> {
  const params: Record<string, ParamMetaInput> = {
    time: {
      default: spec.time.default,
      min: spec.time.min,
      max: spec.timeMax,
      unit: 'seconds',
      curve: 'exp',
      description: spec.time.description,
    },
    feedback: {
      default: spec.feedback.default,
      min: 0,
      max: spec.feedback.max,
      unit: 'gain',
      description:
        'How much of each echo is fed back into the delay to make the next one. 0 gives a single echo; closer to the maximum, the echoes last longer.',
    },
    cutoff: {
      default: spec.cutoff,
      min: 20,
      max: 20000,
      unit: 'hz',
      curve: 'log',
      description:
        'A lowpass filter on the fed-back sound: each repeat loses the frequencies above this, so the echoes get duller. The top of the range leaves them bright.',
    },
    mix: mixParam(spec.mix),
  };
  return defineNode({
    type,
    category: 'delay',
    description: spec.description,
    params,
    shorthand: 'time',
    build(context) {
      const audio = context.audio;
      const input = new GainNode(audio);
      const output = new GainNode(audio);
      const delay = new DelayNode(audio, { maxDelayTime: 5, delayTime: spec.time.default });
      // A lowpass's Q is in decibels. The default of 1 dB gives a resonant peak that can push the loop's
      // gain above 1 near the cutoff, and the echoes would grow instead of fading; -3.01 dB (a Butterworth
      // response) never amplifies, so feedback below 1 always dies away.
      const tone = new BiquadFilterNode(audio, { type: 'lowpass', Q: -3.0103 });
      const feedback = new GainNode(audio);
      const mix = createMix(audio);

      input.connect(mix.dry).connect(output);
      input.connect(delay);
      delay.connect(mix.wet).connect(output);
      delay.connect(tone).connect(feedback).connect(delay);

      return {
        input,
        output,
        params: {
          time: delay.delayTime,
          feedback: feedback.gain,
          cutoff: tone.frequency,
          mix: mix.handler,
        },
        dispose() {
          for (const node of [input, output, delay, tone, feedback, mix.dry, mix.wet]) {
            node.disconnect();
          }
        },
      };
    },
  });
}`}],native:[`GainNode`,`DelayNode`,`BiquadFilterNode`]},delayline:{parts:[{file:`src/nodes/delays.ts`,line:110,endLine:133,code:`export const delayline = defineNode({
  type: 'delayline',
  category: 'delay',
  description:
    'A plain delay: the sound comes out once, later, and nothing else happens to it. It is the piece to build your own echoes, choruses and flangers from: send its output back to its input through a gain for repeats, or move its time with an lfo to bend the pitch of what is inside it. For a ready-made echo use delay.',
  params: {
    time: {
      default: 0.25,
      min: 0,
      max: 5,
      unit: 'seconds',
      curve: 'exp',
      description:
        'How late the sound comes out, in seconds. While the time is moving, the pitch of the sound inside bends: down as it lengthens, up as it shortens.',
    },
  },
  shorthand: 'time',
  build(context) {
    // Nothing but the delay lies between input and output. A loop made through this node therefore
    // always has a delay in it, which browsers require: Firefox silences a loop that has a way round.
    const node = new DelayNode(context.audio, { maxDelayTime: 5 });
    return { input: node, output: node, params: { time: node.delayTime } };
  },
});`}],native:[`DelayNode`]},overdrive:{parts:[{file:`src/nodes/distortion.ts`,line:60,endLine:118,code:`export const overdrive = defineNode({
  type: 'overdrive',
  category: 'distortion',
  description:
    'Soft distortion, like a pushed guitar amp: loud parts are squashed and gain overtones, which makes the sound thicker and warmer. The sound is filtered before and after the distortion to shape its character.',
  params: {
    drive: {
      default: 0.5,
      min: 0,
      max: 1,
      unit: 'normalized',
      rate: 'control',
      description: 'How hard the signal is pushed into distortion. 0 is nearly clean; 1 is heavy.',
    },
    color: {
      default: 800,
      min: 20,
      max: 20000,
      unit: 'hz',
      curve: 'log',
      description:
        'Centre of a bandpass filter applied before the distortion. Only the sound near this frequency is distorted hard, so it sets which part of the sound the grit comes from.',
    },
    postCut: {
      default: 3000,
      min: 20,
      max: 20000,
      unit: 'hz',
      curve: 'log',
      description:
        'A lowpass filter after the distortion that removes the harsh highest overtones. Lower is darker and smoother.',
    },
  },
  shorthand: 'drive',
  build(context) {
    const audio = context.audio;
    const input = new GainNode(audio);
    const color = new BiquadFilterNode(audio, { type: 'bandpass' });
    const shaper = scheduledShaper(audio, (drive) => curveFor(drive * 100, 22050), 'none');
    const postCut = new BiquadFilterNode(audio, { type: 'lowpass' });
    const output = new GainNode(audio);
    input.connect(color).connect(shaper.input);
    shaper.output.connect(postCut).connect(output);
    return {
      input,
      output,
      params: {
        drive(value, at) {
          shaper.set(value as number, at);
        },
        color: color.frequency,
        postCut: postCut.frequency,
      },
      dispose() {
        for (const node of [input, color, postCut, output, ...shaper.nodes]) node.disconnect();
      },
    };
  },
});`}],native:[`GainNode`,`BiquadFilterNode`]},waveshaper:{parts:[{file:`src/nodes/distortion.ts`,line:120,endLine:160,code:`export const waveshaper = defineNode({
  type: 'waveshaper',
  category: 'distortion',
  description:
    'Harder distortion: the signal is bent through a curve that flattens its peaks and adds many overtones, from gentle warmth to harsh fuzz.',
  params: {
    drive: {
      default: 50,
      min: 0,
      max: 100,
      unit: 'none',
      rate: 'control',
      description: 'How sharply the curve bends. 0 is gentle; 100 is a hard, buzzy clip.',
    },
  },
  shorthand: 'drive',
  options: {
    oversample: {
      type: "'none' | '2x' | '4x'",
      default: "'4x'",
      description:
        "How finely the distortion is worked out. '4x' keeps harsh false tones out of the top end but makes the sound late, by 4 milliseconds in Chrome and Safari; 'none' is rougher and adds no lateness, which matters inside a feedback loop.",
    },
  },
  build(context, init) {
    const oversample = OVERSAMPLE.find((choice) => choice === init['oversample']) ?? '4x';
    const shaper = scheduledShaper(context.audio, (drive) => curveFor(drive, 44100), oversample);
    return {
      input: shaper.input,
      output: shaper.output,
      params: {
        drive(value, at) {
          shaper.set(value as number, at);
        },
      },
      dispose() {
        for (const node of shaper.nodes) node.disconnect();
      },
    };
  },
});`}],native:[]},ring:{parts:[{file:`src/nodes/distortion.ts`,line:162,endLine:202,code:`export const ring = defineNode({
  type: 'ring',
  category: 'distortion',
  description:
    'Ring modulator: multiplies the sound by a sine wave. Every frequency in the input is replaced by two new ones (the input plus and minus the wave), which gives metallic, bell-like tones that are not musical harmonics of the original.',
  params: {
    frequency: {
      default: 30,
      min: 0.1,
      max: 5000,
      unit: 'hz',
      curve: 'log',
      description:
        'Frequency of the sine wave. Low values make the sound tremble; high values make it clangorous and strange.',
    },
    mix: mixParam(1),
  },
  shorthand: 'frequency',
  build(context) {
    const audio = context.audio;
    const input = new GainNode(audio);
    const output = new GainNode(audio);
    // The gain is 0 on its own; the oscillator drives it, so output = input x sine.
    const multiplier = new GainNode(audio, { gain: 0 });
    const osc = new OscillatorNode(audio, { type: 'sine' });
    const mix = createMix(audio);
    osc.connect(multiplier.gain);
    osc.start();
    input.connect(mix.dry).connect(output);
    input.connect(multiplier).connect(mix.wet).connect(output);
    return {
      input,
      output,
      params: { frequency: osc.frequency, mix: mix.handler },
      dispose() {
        osc.stop();
        for (const node of [osc, input, output, multiplier, mix.dry, mix.wet]) node.disconnect();
      },
    };
  },
});`}],native:[`GainNode`,`OscillatorNode`]},adsr:{parts:[{file:`src/nodes/envelopes.ts`,line:11,endLine:160,code:`export const adsr = defineNode({
  type: 'adsr',
  category: 'envelope',
  description:
    'Shapes loudness over time. The signal passing through is silent until triggered, then rises (attack), falls to a held level (decay to sustain), and fades away when released. Put it after a sound to turn a steady tone into a note.',
  params: {
    attack: {
      default: 0.01,
      min: 0,
      max: 5,
      unit: 'seconds',
      curve: 'exp',
      rate: 'control',
      description: 'Seconds to rise from silence to full level after a trigger.',
    },
    decay: {
      default: 0.1,
      min: 0,
      max: 5,
      unit: 'seconds',
      curve: 'exp',
      rate: 'control',
      description: 'Seconds to fall from full level to the sustain level.',
    },
    sustain: {
      default: 0.5,
      min: 0,
      max: 1,
      unit: 'gain',
      rate: 'control',
      description: 'The level held while the note continues, as a fraction of full level.',
    },
    release: {
      default: 0.2,
      min: 0,
      max: 10,
      unit: 'seconds',
      curve: 'exp',
      rate: 'control',
      description:
        'Seconds to fade to silence after release. Set with set({ release }); release() itself is the action.',
    },
  },
  triggerable: true,
  triggerOptions: {
    duration: {
      type: 'seconds',
      description:
        'Releases automatically this long after the trigger. Omitted: held until release().',
    },
    velocity: {
      type: 'number',
      default: '1',
      description: 'Full level for this trigger; sustain is a fraction of it.',
    },
    attack: { type: 'seconds', description: 'Attack for this trigger only.' },
    decay: { type: 'seconds', description: 'Decay for this trigger only.' },
    sustain: { type: 'number', description: 'Sustain for this trigger only.' },
    release: {
      type: 'seconds',
      description: 'Release for this trigger only; used when \`duration\` releases it.',
    },
  },
  build(context) {
    const audio = context.audio;
    const node = new GainNode(audio, { gain: 0 });
    const gain = node.gain;

    // What has been scheduled on \`gain\`, so the level at any time is known even where the browser
    // cannot hold an automation in progress (Firefox has no cancelAndHoldAtTime).
    let segments: Segment[] = [];

    const levelAt = (time: number): number => {
      for (let i = segments.length - 1; i >= 0; i--) {
        const s = segments[i]!;
        if (s.t0 > time) continue;
        if (time >= s.t1) return s.v1;
        return s.v0 + ((s.v1 - s.v0) * (time - s.t0)) / (s.t1 - s.t0);
      }
      return 0;
    };

    /** Cancels everything from \`at\` on and holds the level reached by then. */
    const holdAt = (at: number): void => {
      const level = levelAt(at);
      segments = segments.filter((s) => s.t0 < at);
      const last = segments[segments.length - 1];
      const crossing = last !== undefined && last.t1 > at;
      if (crossing) segments[segments.length - 1] = { ...last, t1: at, v1: level };
      segments.push({ t0: at, v0: level, t1: at, v1: level });
      if (typeof gain.cancelAndHoldAtTime === 'function') {
        gain.cancelAndHoldAtTime(at);
      } else {
        gain.cancelScheduledValues(at);
        // That also removed the end of a ramp in progress; put back its first part so it still
        // reaches \`level\` at \`at\`.
        if (crossing) gain.linearRampToValueAtTime(level, at);
      }
      // An anchor for the ramps that follow. Without one, a ramp scheduled when nothing came before it
      // would start from time 0, not from here.
      gain.setValueAtTime(level, at);
    };

    /** A straight line from the end of the last scheduled piece to (time, value). */
    const lineTo = (time: number, value: number): void => {
      const from = segments[segments.length - 1]!;
      if (time <= from.t1) {
        gain.setValueAtTime(value, from.t1);
        segments.push({ t0: from.t1, v0: value, t1: from.t1, v1: value });
      } else {
        gain.linearRampToValueAtTime(value, time);
        segments.push({ t0: from.t1, v0: from.v1, t1: time, v1: value });
      }
    };

    const releaseAt = (at: number, seconds: number): void => {
      holdAt(at);
      lineTo(at + Math.max(0, seconds), 0);
      // A ramp can leave the last sample a rounding error from 0; this makes it exact.
      gain.setValueAtTime(0, at + Math.max(0, seconds));
    };

    return {
      input: node,
      output: node,
      params: { attack() {}, decay() {}, sustain() {}, release() {} },
      trigger(options, at) {
        const number = (name: string): number =>
          typeof options[name] === 'number' ? options[name] : (context.value(name, at) as number);
        const velocity = typeof options['velocity'] === 'number' ? options['velocity'] : 1;
        const attack = Math.max(0, number('attack'));
        const decay = Math.max(0, number('decay'));
        const sustain = number('sustain');
        holdAt(at);
        lineTo(at + attack, velocity);
        lineTo(at + attack + decay, sustain * velocity);
        if (typeof options['duration'] === 'number') {
          releaseAt(at + options['duration'], number('release'));
        }
      },
      release(_options, at) {
        releaseAt(at, context.value('release', at) as number);
      },
      dispose() {
        gain.cancelScheduledValues(0);
        node.disconnect();
      },
    };
  },
});`}],native:[`GainNode`]},lowpass:{parts:[{file:`src/nodes/filters.ts`,line:66,endLine:72,code:`export const lowpass = filter('lowpass', {
  description: 'Lets through what is below the cutoff and removes what is above.',
  frequency: 20000,
  frequencyIs: 'The cutoff.',
  q: resonance,
  gain: false,
});`},{label:`filter(), which builds it`,file:`src/nodes/filters.ts`,line:36,endLine:60,code:`function filter<K extends BiquadFilterType>(type: K, spec: FilterSpec): NodeDefinition<K> {
  return defineNode({
    type,
    category: 'filter',
    description: spec.description,
    params: {
      frequency: frequency(spec.frequency, spec.frequencyIs),
      ...(spec.q === null ? {} : { q: q(spec.q) }),
      ...(spec.gain ? { gain: gainDb } : {}),
    },
    shorthand: 'frequency',
    build(context) {
      const node = new BiquadFilterNode(context.audio, { type });
      return {
        input: node,
        output: node,
        params: {
          frequency: node.frequency,
          ...(spec.q === null ? {} : { q: node.Q }),
          ...(spec.gain ? { gain: node.gain } : {}),
        },
      };
    },
  });
}`}],native:[`BiquadFilterNode`]},highpass:{parts:[{file:`src/nodes/filters.ts`,line:73,endLine:79,code:`export const highpass = filter('highpass', {
  description: 'Lets through what is above the cutoff and removes what is below.',
  frequency: 20,
  frequencyIs: 'The cutoff.',
  q: resonance,
  gain: false,
});`},{label:`filter(), which builds it`,file:`src/nodes/filters.ts`,line:36,endLine:60,code:`function filter<K extends BiquadFilterType>(type: K, spec: FilterSpec): NodeDefinition<K> {
  return defineNode({
    type,
    category: 'filter',
    description: spec.description,
    params: {
      frequency: frequency(spec.frequency, spec.frequencyIs),
      ...(spec.q === null ? {} : { q: q(spec.q) }),
      ...(spec.gain ? { gain: gainDb } : {}),
    },
    shorthand: 'frequency',
    build(context) {
      const node = new BiquadFilterNode(context.audio, { type });
      return {
        input: node,
        output: node,
        params: {
          frequency: node.frequency,
          ...(spec.q === null ? {} : { q: node.Q }),
          ...(spec.gain ? { gain: node.gain } : {}),
        },
      };
    },
  });
}`}],native:[`BiquadFilterNode`]},bandpass:{parts:[{file:`src/nodes/filters.ts`,line:80,endLine:86,code:`export const bandpass = filter('bandpass', {
  description: 'Lets through a band around the frequency and removes the rest.',
  frequency: 1000,
  frequencyIs: 'The centre of the band.',
  q: width,
  gain: false,
});`},{label:`filter(), which builds it`,file:`src/nodes/filters.ts`,line:36,endLine:60,code:`function filter<K extends BiquadFilterType>(type: K, spec: FilterSpec): NodeDefinition<K> {
  return defineNode({
    type,
    category: 'filter',
    description: spec.description,
    params: {
      frequency: frequency(spec.frequency, spec.frequencyIs),
      ...(spec.q === null ? {} : { q: q(spec.q) }),
      ...(spec.gain ? { gain: gainDb } : {}),
    },
    shorthand: 'frequency',
    build(context) {
      const node = new BiquadFilterNode(context.audio, { type });
      return {
        input: node,
        output: node,
        params: {
          frequency: node.frequency,
          ...(spec.q === null ? {} : { q: node.Q }),
          ...(spec.gain ? { gain: node.gain } : {}),
        },
      };
    },
  });
}`}],native:[`BiquadFilterNode`]},notch:{parts:[{file:`src/nodes/filters.ts`,line:87,endLine:93,code:`export const notch = filter('notch', {
  description: 'Removes a band around the frequency and lets through the rest.',
  frequency: 1000,
  frequencyIs: 'The centre of the removed band.',
  q: width,
  gain: false,
});`},{label:`filter(), which builds it`,file:`src/nodes/filters.ts`,line:36,endLine:60,code:`function filter<K extends BiquadFilterType>(type: K, spec: FilterSpec): NodeDefinition<K> {
  return defineNode({
    type,
    category: 'filter',
    description: spec.description,
    params: {
      frequency: frequency(spec.frequency, spec.frequencyIs),
      ...(spec.q === null ? {} : { q: q(spec.q) }),
      ...(spec.gain ? { gain: gainDb } : {}),
    },
    shorthand: 'frequency',
    build(context) {
      const node = new BiquadFilterNode(context.audio, { type });
      return {
        input: node,
        output: node,
        params: {
          frequency: node.frequency,
          ...(spec.q === null ? {} : { q: node.Q }),
          ...(spec.gain ? { gain: node.gain } : {}),
        },
      };
    },
  });
}`}],native:[`BiquadFilterNode`]},allpass:{parts:[{file:`src/nodes/filters.ts`,line:94,endLine:101,code:`export const allpass = filter('allpass', {
  description:
    'Lets everything through but shifts phase around the frequency. Used to build phasers.',
  frequency: 1000,
  frequencyIs: 'Where the phase shift is centred.',
  q: 'How sharp the phase transition is.',
  gain: false,
});`},{label:`filter(), which builds it`,file:`src/nodes/filters.ts`,line:36,endLine:60,code:`function filter<K extends BiquadFilterType>(type: K, spec: FilterSpec): NodeDefinition<K> {
  return defineNode({
    type,
    category: 'filter',
    description: spec.description,
    params: {
      frequency: frequency(spec.frequency, spec.frequencyIs),
      ...(spec.q === null ? {} : { q: q(spec.q) }),
      ...(spec.gain ? { gain: gainDb } : {}),
    },
    shorthand: 'frequency',
    build(context) {
      const node = new BiquadFilterNode(context.audio, { type });
      return {
        input: node,
        output: node,
        params: {
          frequency: node.frequency,
          ...(spec.q === null ? {} : { q: node.Q }),
          ...(spec.gain ? { gain: node.gain } : {}),
        },
      };
    },
  });
}`}],native:[`BiquadFilterNode`]},lowshelf:{parts:[{file:`src/nodes/filters.ts`,line:102,endLine:108,code:`export const lowshelf = filter('lowshelf', {
  description: 'Boosts or cuts everything below the frequency.',
  frequency: 200,
  frequencyIs: 'The top of the shelf.',
  q: null,
  gain: true,
});`},{label:`filter(), which builds it`,file:`src/nodes/filters.ts`,line:36,endLine:60,code:`function filter<K extends BiquadFilterType>(type: K, spec: FilterSpec): NodeDefinition<K> {
  return defineNode({
    type,
    category: 'filter',
    description: spec.description,
    params: {
      frequency: frequency(spec.frequency, spec.frequencyIs),
      ...(spec.q === null ? {} : { q: q(spec.q) }),
      ...(spec.gain ? { gain: gainDb } : {}),
    },
    shorthand: 'frequency',
    build(context) {
      const node = new BiquadFilterNode(context.audio, { type });
      return {
        input: node,
        output: node,
        params: {
          frequency: node.frequency,
          ...(spec.q === null ? {} : { q: node.Q }),
          ...(spec.gain ? { gain: node.gain } : {}),
        },
      };
    },
  });
}`}],native:[`BiquadFilterNode`]},highshelf:{parts:[{file:`src/nodes/filters.ts`,line:109,endLine:115,code:`export const highshelf = filter('highshelf', {
  description: 'Boosts or cuts everything above the frequency.',
  frequency: 4000,
  frequencyIs: 'The bottom of the shelf.',
  q: null,
  gain: true,
});`},{label:`filter(), which builds it`,file:`src/nodes/filters.ts`,line:36,endLine:60,code:`function filter<K extends BiquadFilterType>(type: K, spec: FilterSpec): NodeDefinition<K> {
  return defineNode({
    type,
    category: 'filter',
    description: spec.description,
    params: {
      frequency: frequency(spec.frequency, spec.frequencyIs),
      ...(spec.q === null ? {} : { q: q(spec.q) }),
      ...(spec.gain ? { gain: gainDb } : {}),
    },
    shorthand: 'frequency',
    build(context) {
      const node = new BiquadFilterNode(context.audio, { type });
      return {
        input: node,
        output: node,
        params: {
          frequency: node.frequency,
          ...(spec.q === null ? {} : { q: node.Q }),
          ...(spec.gain ? { gain: node.gain } : {}),
        },
      };
    },
  });
}`}],native:[`BiquadFilterNode`]},peaking:{parts:[{file:`src/nodes/filters.ts`,line:116,endLine:122,code:`export const peaking = filter('peaking', {
  description: 'Boosts or cuts a band around the frequency and leaves the rest alone.',
  frequency: 1000,
  frequencyIs: 'The centre of the band.',
  q: width,
  gain: true,
});`},{label:`filter(), which builds it`,file:`src/nodes/filters.ts`,line:36,endLine:60,code:`function filter<K extends BiquadFilterType>(type: K, spec: FilterSpec): NodeDefinition<K> {
  return defineNode({
    type,
    category: 'filter',
    description: spec.description,
    params: {
      frequency: frequency(spec.frequency, spec.frequencyIs),
      ...(spec.q === null ? {} : { q: q(spec.q) }),
      ...(spec.gain ? { gain: gainDb } : {}),
    },
    shorthand: 'frequency',
    build(context) {
      const node = new BiquadFilterNode(context.audio, { type });
      return {
        input: node,
        output: node,
        params: {
          frequency: node.frequency,
          ...(spec.q === null ? {} : { q: node.Q }),
          ...(spec.gain ? { gain: node.gain } : {}),
        },
      };
    },
  });
}`}],native:[`BiquadFilterNode`]},smooth:{parts:[{file:`src/nodes/filters.ts`,line:124,endLine:156,code:`/**
 * A lowpass for control signals. The browser's own lowpass (a biquad) is inexact at very low
 * frequencies in Chromium and WebKit outside macOS: at 4 Hz a steady signal of 1 comes out as 1.22.
 * This one uses the browser's general filter, which works in double precision, and is exact.
 */
export const smooth = defineNode({
  type: 'smooth',
  category: 'filter',
  description:
    'Smooths a control signal so that it glides to a new value instead of jumping, and never overshoots. Put it between a signal and the parameter it moves, for example before modulate. It settles on exactly the value sent in, in every browser, which a lowpass at a very low frequency does not.',
  params: {},
  options: {
    frequency: {
      type: 'number',
      default: '4',
      description:
        'How quickly it follows, in Hz, from 0.1 to 1000. Higher is quicker: at 4 a jump takes about a fifth of a second to arrive. It cannot be changed after the node is made.',
    },
  },
  build(context, init) {
    const asked = init['frequency'];
    const hz = Math.min(1000, Math.max(0.1, typeof asked === 'number' && asked > 0 ? asked : 4));
    // A two-pole lowpass with Q 0.5 (critically damped): the fastest that settles without overshoot.
    const w = (2 * Math.PI * hz) / context.audio.sampleRate;
    const alpha = Math.sin(w);
    const cos = Math.cos(w);
    const node = context.audio.createIIRFilter(
      [(1 - cos) / 2, 1 - cos, (1 - cos) / 2],
      [1 + alpha, -2 * cos, 1 - alpha],
    );
    return { input: node, output: node, params: {} };
  },
});`}],native:[]},lfo:{parts:[{file:`src/nodes/modulators.ts`,line:19,endLine:60,code:`export const lfo = defineNode({
  type: 'lfo',
  category: 'modulator',
  description:
    "A slow wave for moving another node's parameter: chain it into a node, and it makes that node's frequency rise and fall (vibrato, wobble, a sweeping filter). Pass \`modulates\` to drive a different parameter. It makes no sound itself.",
  params: {
    frequency: {
      default: 2,
      min: 0.01,
      max: 50,
      unit: 'hz',
      curve: 'log',
      description: 'How many times per second the wave repeats.',
    },
    depth: depthParam,
  },
  options: {
    shape: {
      type: "'sine' | 'saw' | 'square' | 'triangle'",
      default: "'sine'",
      description:
        'The wave: sine is smooth, triangle is straight-edged and smooth, saw ramps up then jumps back, square jumps between high and low.',
    },
  },
  modulates: 'frequency',
  build(context, init) {
    const shape = typeof init['shape'] === 'string' ? SHAPES[init['shape']] : undefined;
    const osc = new OscillatorNode(context.audio, { type: shape ?? 'sine' });
    const depth = new GainNode(context.audio);
    osc.connect(depth);
    osc.start();
    return {
      output: depth,
      params: { frequency: osc.frequency, depth: depth.gain },
      dispose() {
        osc.stop();
        osc.disconnect();
        depth.disconnect();
      },
    };
  },
});`}],native:[`OscillatorNode`,`GainNode`]},stepper:{parts:[{file:`src/nodes/modulators.ts`,line:62,endLine:106,code:`export const stepper = defineNode({
  type: 'stepper',
  category: 'modulator',
  description:
    'Like an lfo, but it jumps between random levels instead of gliding: a looping series of random values, each held for an equal share of the loop. Chain it into a node to make its frequency hop around. It makes no sound itself.',
  params: { depth: depthParam },
  options: {
    steps: {
      type: 'number',
      default: '8',
      description: 'How many random values there are in one loop.',
    },
    length: {
      type: 'seconds',
      default: '1',
      description: 'How long one whole loop lasts, in seconds.',
    },
  },
  modulates: 'frequency',
  build(context, init) {
    const audio = context.audio;
    const steps = Math.max(1, Math.floor(typeof init['steps'] === 'number' ? init['steps'] : 8));
    const seconds = typeof init['length'] === 'number' && init['length'] > 0 ? init['length'] : 1;
    const length = Math.max(steps, Math.round(audio.sampleRate * seconds));
    const values = Array.from({ length: steps }, () => context.random() * 2 - 1);
    const buffer = new AudioBuffer({ length, numberOfChannels: 1, sampleRate: audio.sampleRate });
    const data = new Float32Array(length);
    for (let i = 0; i < length; i++) data[i] = values[Math.floor((i * steps) / length)]!;
    buffer.copyToChannel(data, 0);

    const source = new AudioBufferSourceNode(audio, { buffer, loop: true });
    const depth = new GainNode(audio);
    source.connect(depth);
    source.start();
    return {
      output: depth,
      params: { depth: depth.gain },
      dispose() {
        source.stop();
        source.disconnect();
        depth.disconnect();
      },
    };
  },
});`}],native:[`AudioBufferSourceNode`,`GainNode`]},multiband:{parts:[{file:`src/nodes/multiband.ts`,line:74,endLine:187,code:`export const multiband: MacroDefinition<'multiband'> = defineMacro({
  type: 'multiband',
  category: 'dynamics',
  description:
    'A three-band compressor: the sound is split into lows, mids and highs, each is evened out by its own compressor, and the three are added back together. A loud kick then no longer pulls the cymbals down with it, as it would through a single compressor. Each band only turns down what is above its threshold; what is below keeps its level, and each band has a gain to bring it back up afterwards. With every threshold at 0 and every gain at 0 the sound passes through unchanged. Good on drums or a whole mix. It makes the sound about 6 milliseconds late.',
  params: {
    lowCrossover: {
      default: 200,
      min: 40,
      max: 1000,
      unit: 'hz',
      curve: 'log',
      description: 'Where the low band ends and the middle band begins.',
      drives: [{ select: '.lowCrossover', param: 'frequency' }],
    },
    highCrossover: {
      default: 2500,
      min: 1000,
      max: 12000,
      unit: 'hz',
      curve: 'log',
      description: 'Where the middle band ends and the high band begins.',
      drives: [{ select: '.highCrossover', param: 'frequency' }],
    },
    ...bandParams('low'),
    ...bandParams('mid'),
    ...bandParams('high'),
    attack: {
      default: 0.01,
      min: 0,
      max: 1,
      unit: 'seconds',
      curve: 'exp',
      description:
        'How quickly every band reacts to a loud sound. Longer lets the snap at the start of a drum hit through before the level comes down.',
      drives: [{ select: '.band', param: 'attack' }],
    },
    release: {
      default: 0.15,
      min: 0,
      max: 1,
      unit: 'seconds',
      curve: 'exp',
      description:
        'How quickly every band lets go once the sound is quiet again. Short pumps and breathes; long is smoother. Set with set({ release }).',
      drives: [{ select: '.band', param: 'release' }],
    },
    mix: {
      default: 1,
      min: 0,
      max: 1,
      unit: 'normalized',
      description:
        'Blend between the original and the compressed sound: 0 is only the original, 1 only the compressed. In between gives parallel compression, which keeps the punch of the original with the body of the squashed sound underneath. The original is lined up with the compressed sound first, so the blend does not thin the tone.',
      drives: [
        { select: '#wet', param: 'gain' },
        { select: '#dry', param: 'gain', scale: { multiply: -1, add: 1 } },
      ],
    },
  },
  build(__, _init, macro) {
    const value = (name: string) => num(macro.value(name), 0);
    const lowCrossover = value('lowCrossover');
    const highCrossover = value('highCrossover');
    const mix = value('mix');
    const input = __.bus('in').chain();

    // The compressed bands meet here.
    __().gain({ id: 'wet', gain: mix }).to('out');

    // One band's compressor and level control, on the end of its filters. The compressor's own
    // make-up gain is off: it would turn a band up by more the lower its threshold, so setting the
    // three thresholds differently would change the balance between the bands.
    const compress = (chain: Chain, band: Band): void => {
      chain
        .compressor({
          id: band,
          class: 'band',
          makeup: false,
          threshold: value(\`\${band}Threshold\`),
          ratio: value(\`\${band}Ratio\`),
          knee: KNEE,
          attack: value('attack'),
          release: value('release'),
        })
        .gain({ id: \`\${band}Level\`, gain: dbToGain(value(\`\${band}Gain\`)) })
        .connect('#wet');
    };

    // Each crossover turns the phase of what passes through it. The low band never meets the upper
    // crossover, so an allpass gives it the same turn; without it the three bands would not add back
    // up to a flat response.
    compress(
      slope(input, 'lowpass', 'lowCrossover', lowCrossover).allpass({
        class: 'highCrossover',
        frequency: highCrossover,
        q: ALLPASS_Q,
      }),
      'low',
    );
    const upper = slope(input, 'highpass', 'lowCrossover', lowCrossover);
    compress(slope(upper, 'lowpass', 'highCrossover', highCrossover), 'mid');
    compress(slope(upper, 'highpass', 'highCrossover', highCrossover), 'high');

    // The original, for \`mix\`. It is given the phase turn of both crossovers and the few milliseconds
    // a compressor takes (through one set to do nothing), so it adds to the bands without cancelling.
    input
      .allpass({ class: 'lowCrossover', frequency: lowCrossover, q: ALLPASS_Q })
      .allpass({ class: 'highCrossover', frequency: highCrossover, q: ALLPASS_Q })
      .compressor({ id: 'align', threshold: 0, ratio: 1, knee: 0 })
      .gain({ id: 'dry', gain: 1 - mix })
      .to('out');
  },
});`}],native:[]},noise:{parts:[{file:`src/nodes/noise.ts`,line:45,endLine:107,code:`export const noise = defineNode({
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
});`}],native:[`AudioBufferSourceNode`,`GainNode`]},sine:{parts:[{file:`src/nodes/oscillators.ts`,line:75,endLine:75,code:"export const sine = oscillator('sine', 'sine', `A pure tone with no overtones. ${gateNote}`);"},{label:`oscillator(), which builds it`,file:`src/nodes/oscillators.ts`,line:4,endLine:70,code:`function oscillator<K extends string>(
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
}`}],native:[`OscillatorNode`,`GainNode`]},saw:{parts:[{file:`src/nodes/oscillators.ts`,line:76,endLine:80,code:`export const saw = oscillator(
  'saw',
  'sawtooth',
  \`A bright, buzzy wave with every overtone. \${gateNote}\`,
);`},{label:`oscillator(), which builds it`,file:`src/nodes/oscillators.ts`,line:4,endLine:70,code:`function oscillator<K extends string>(
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
}`}],native:[`OscillatorNode`,`GainNode`]},square:{parts:[{file:`src/nodes/oscillators.ts`,line:81,endLine:85,code:`export const square = oscillator(
  'square',
  'square',
  \`A hollow wave with the odd overtones. \${gateNote}\`,
);`},{label:`oscillator(), which builds it`,file:`src/nodes/oscillators.ts`,line:4,endLine:70,code:`function oscillator<K extends string>(
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
}`}],native:[`OscillatorNode`,`GainNode`]},triangle:{parts:[{file:`src/nodes/oscillators.ts`,line:86,endLine:90,code:`export const triangle = oscillator(
  'triangle',
  'triangle',
  \`A soft wave, between sine and square. \${gateNote}\`,
);`},{label:`oscillator(), which builds it`,file:`src/nodes/oscillators.ts`,line:4,endLine:70,code:`function oscillator<K extends string>(
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
}`}],native:[`OscillatorNode`,`GainNode`]},recorder:{parts:[{file:`src/nodes/recording.ts`,line:72,endLine:167,code:`export const recorder = defineNode({
  type: 'recorder',
  category: 'io',
  description:
    'Records whatever passes through it into the buffer store, exact to the sample. Start with trigger() and stop with release(), or give trigger a duration. The recording appears under the key named by \`into\`, where a sampler can play it. Recorders triggered at the same time produce recordings that line up exactly, which is how stems are made.',
  triggerable: true,
  params: { latency: LATENCY },
  options: {
    into: {
      type: 'string',
      description:
        "Buffer store key the recording is written to. Each new take replaces the last. Default: the node's id.",
    },
    channels: { type: '1 | 2', default: '2', description: 'Mono or stereo.' },
  },
  triggerOptions: {
    duration: { type: 'seconds', description: 'Stops by itself after this long.' },
    key: { type: 'string', description: 'Store key for this take, instead of \`into\`.' },
  },
  build(context, init) {
    const audio = context.audio;
    const channels = channelsOf(init);
    const node = context.worklet(RECORDER, {
      ...workletOptions(channels),
      processorOptions: isOffline(audio) ? { endFrame: audio.length } : {},
    });
    const gate = new Gate(node.parameters.get('record')!, audio.sampleRate);
    const silent = keepRunning(audio, node);
    const defaultKey = typeof init['into'] === 'string' ? init['into'] : context.id;
    // Made now, so a sampler can name the key before the first take exists.
    context.bufferSink(defaultKey);

    let latency = 0;
    /** Keys of takes that have been scheduled but not yet started, in time order. */
    const scheduled: { at: number; key: string }[] = [];
    const takes = new Map<number, { key: string; chunks: Float32Array[][] }>();

    node.port.onmessage = (event: MessageEvent) => {
      const message = event.data as { take: number; data: Float32Array[]; last: boolean };
      let take = takes.get(message.take);
      if (!take) {
        take = { key: scheduled.shift()?.key ?? defaultKey, chunks: [] };
        takes.set(message.take, take);
      }
      if (message.data.length > 0) take.chunks.push(message.data);
      if (!message.last) return;
      takes.delete(message.take);
      const length = take.chunks.reduce((sum, chunk) => sum + chunk[0]!.length, 0);
      if (length === 0) return;
      const buffer = new AudioBuffer({
        length,
        numberOfChannels: channels,
        sampleRate: audio.sampleRate,
      });
      for (let channel = 0; channel < channels; channel++) {
        const target = buffer.getChannelData(channel);
        let offset = 0;
        for (const chunk of take.chunks) {
          target.set(chunk[channel]!, offset);
          offset += chunk[channel]!.length;
        }
      }
      context.bufferSink(take.key).write(buffer);
    };

    return {
      input: node,
      output: node,
      params: {
        latency(value) {
          latency = value as number;
        },
      },
      trigger(options, at) {
        const start = gate.frame(at + latency);
        const key = typeof options['key'] === 'string' ? options['key'] : defaultKey;
        if (key !== defaultKey) context.bufferSink(key);
        gate.raise(start);
        scheduled.push({ at: start, key });
        scheduled.sort((a, b) => a.at - b.at);
        const duration = options['duration'];
        if (typeof duration === 'number' && duration > 0) {
          gate.set(0, start + Math.max(1, gate.frame(duration)));
        }
      },
      release(_options, at) {
        gate.set(0, gate.frame(at + latency));
      },
      dispose() {
        node.port.onmessage = null;
        node.disconnect();
        silent.disconnect();
      },
    };
  },
});`}],native:[]},looper:{parts:[{file:`src/nodes/recording.ts`,line:169,endLine:289,code:`export const looper = defineNode({
  type: 'looper',
  category: 'io',
  description:
    'Records a loop from its input and plays it round and round, in time. The first trigger() records one loop of the given length; each later trigger() adds a layer on top. call("undo") removes the newest layer, call("clear") empties it, and call("stop") and call("play") silence and restore playback without losing the place. Start the first layer on a bar line and the loop stays on the bar for as long as the tempo does not change.',
  triggerable: true,
  params: {
    gain: {
      default: 1,
      min: 0,
      max: 2,
      rate: 'audio',
      description: 'Level of the loop playback.',
    },
    monitor: {
      default: 1,
      min: 0,
      max: 2,
      rate: 'audio',
      description: 'Level of the input passed straight through. 0 lets only the loop out.',
    },
    overdub: {
      default: 0.7,
      min: 0,
      max: 1,
      rate: 'audio',
      description:
        'Level at which layers after the first are recorded. Below 1 so that layers stacked on each other do not add up to distortion. Read when a layer starts.',
    },
    latency: LATENCY,
  },
  options: {
    length: {
      type: 'duration',
      default: "'1 bar'",
      description:
        "How long the loop is, such as '2 bars' or '1/2'. Read when the first layer is recorded, at the tempo of that moment.",
    },
    channels: { type: '1 | 2', default: '2', description: 'Mono or stereo.' },
  },
  triggerOptions: {
    length: {
      type: 'duration',
      description: 'Loop length, when this trigger records the first layer.',
    },
    cycles: {
      type: 'number',
      default: '1',
      description: 'How many times round the loop to record. 0 records until release().',
    },
  },
  build(context, init) {
    const audio = context.audio;
    const node = context.worklet(LOOPER, workletOptions(channelsOf(init)));
    const param = (name: string): AudioParam => node.parameters.get(name)!;
    const silent = keepRunning(audio, node);
    const gate = (name: string): Gate => new Gate(param(name), audio.sampleRate);
    const record = gate('record');

    let latency = 0;
    /** The loop's length in seconds once a first layer has been asked for; null while it is empty. */
    let loopSeconds: number | null = null;
    let layers = 0;

    return {
      input: node,
      output: node,
      params: {
        gain: param('gain'),
        monitor: param('monitor'),
        overdub: param('overdub'),
        latency(value, at) {
          latency = value as number;
          param('latency').setValueAtTime(latency, at);
        },
      },
      trigger(options, at) {
        if (loopSeconds === null) {
          const length = (options['length'] ?? init['length'] ?? '1 bar') as Duration;
          loopSeconds = Math.min(120, Math.max(0.001, context.seconds(length)));
          // Set at once, not at \`at\`: the processor reads the length at the start of the block in
          // which recording begins, which is slightly before \`at\`.
          param('length').setValueAtTime(loopSeconds, 0);
        }
        layers++;
        const start = record.frame(at + latency);
        record.raise(start);
        const cycles = typeof options['cycles'] === 'number' ? options['cycles'] : 1;
        if (cycles > 0) {
          record.set(0, start + Math.round(cycles * loopSeconds * audio.sampleRate));
        }
      },
      release(_options, at) {
        record.set(0, record.frame(at + latency));
      },
      methods: {
        undo(_args, at) {
          gate('undo').pulse(record.frame(at));
          layers = Math.max(0, layers - 1);
          if (layers === 0) loopSeconds = null;
        },
        clear(_args, at) {
          gate('clear').pulse(record.frame(at));
          record.set(0, record.frame(at));
          layers = 0;
          loopSeconds = null;
        },
        stop(_args, at) {
          gate('play').set(0, record.frame(at));
        },
        play(_args, at) {
          gate('play').set(1, record.frame(at));
        },
      },
      dispose() {
        node.disconnect();
        silent.disconnect();
      },
    };
  },
});`}],native:[]},input:{parts:[{file:`src/nodes/recording.ts`,line:291,endLine:380,code:`export const input = defineNode({
  type: 'input',
  category: 'io',
  description:
    'Live audio from a microphone or audio interface. The browser asks the person for permission the first time; until they answer, and if they refuse, the node is silent. Live engines only: an offline render has no microphone.',
  shorthand: 'gain',
  params: {
    gain: { default: 1, min: 0, max: 4, rate: 'audio', description: 'Input level.' },
  },
  options: {
    deviceId: {
      type: 'string',
      description:
        'Which input device, as listed by navigator.mediaDevices.enumerateDevices(). Default: the system input.',
    },
    stream: {
      type: 'MediaStream',
      description: 'A stream the page already has, used instead of asking for the microphone.',
    },
    processing: {
      type: 'boolean',
      default: 'false',
      description:
        "Leaves the browser's echo cancellation, noise suppression and automatic gain on. They suit speech and spoil music, so they are off unless asked for.",
    },
  },
  build(context, init) {
    const audio = context.audio;
    if (isOffline(audio)) {
      throw new Error('an offline engine has no live input. Use a sampler with recorded audio.');
    }
    const live = audio as AudioContext;
    const out = new GainNode(audio);
    let source: MediaStreamAudioSourceNode | null = null;
    /** A stream this node asked for itself, which it must also stop. */
    let owned: MediaStream | null = null;
    let disposed = false;

    const attach = (stream: MediaStream): void => {
      if (disposed) return;
      source = live.createMediaStreamSource(stream);
      source.connect(out);
    };

    const given = init['stream'];
    if (typeof MediaStream !== 'undefined' && given instanceof MediaStream) {
      attach(given);
    } else if (!navigator.mediaDevices?.getUserMedia) {
      context.report('this browser or page cannot use audio input (it needs a secure https page).');
    } else {
      const processing = init['processing'] === true;
      const deviceId = init['deviceId'];
      navigator.mediaDevices
        .getUserMedia({
          audio: {
            ...(typeof deviceId === 'string' ? { deviceId: { exact: deviceId } } : {}),
            echoCancellation: processing,
            noiseSuppression: processing,
            autoGainControl: processing,
          },
        })
        .then(
          (stream) => {
            if (disposed) {
              for (const track of stream.getTracks()) track.stop();
              return;
            }
            owned = stream;
            attach(stream);
          },
          (error: unknown) =>
            context.report(
              \`could not open the audio input (\${error instanceof Error ? error.message : String(error)}).\`,
              error,
            ),
        );
    }

    return {
      output: out,
      params: { gain: out.gain },
      dispose() {
        disposed = true;
        source?.disconnect();
        out.disconnect();
        if (owned) for (const track of owned.getTracks()) track.stop();
      },
    };
  },
});`}],native:[`GainNode`]},reverb:{parts:[{file:`src/nodes/reverb.ts`,line:32,endLine:108,code:`export const reverb = defineNode({
  type: 'reverb',
  category: 'delay',
  description:
    'A simulated room: the sound is smeared into a dense tail of reflections that fades away. Uses a generated tail of random noise, or a recording of a real space if you give one.',
  params: { mix: mixParam(0.3) },
  options: {
    seconds: {
      type: 'seconds',
      default: '3',
      description: 'Length of the generated tail. Nothing is heard after this long.',
    },
    decay: {
      type: 'number',
      default: '2',
      description:
        'How quickly the generated tail fades. Higher fades faster, so the room sounds smaller.',
    },
    reverse: {
      type: 'boolean',
      default: 'false',
      description: 'Plays the generated tail backwards: it swells up and then stops.',
    },
    impulse: {
      type: 'string | AudioBuffer | BufferRef',
      description:
        'A recording of a space (an impulse response) to use instead of the generated tail. A string is looked up in engine.buffers by name; if nothing has that name it is loaded as a URL.',
    },
  },
  build(context, init) {
    const audio = context.audio;
    const input = new GainNode(audio);
    const output = new GainNode(audio);
    const convolver = new ConvolverNode(audio); // normalize stays on, so the tail has a sensible level
    const mix = createMix(audio);
    let disposed = false;

    if (init['impulse'] === undefined) {
      const seconds = typeof init['seconds'] === 'number' ? init['seconds'] : 3;
      const decay = typeof init['decay'] === 'number' ? init['decay'] : 2;
      convolver.buffer = generateImpulse(
        audio,
        context.random,
        seconds,
        decay,
        init['reverse'] === true,
      );
    } else {
      const ref = context.buffer(init['impulse'] as BufferSource);
      const use = (buffer: AudioBuffer) => {
        if (disposed) return;
        try {
          convolver.buffer = buffer;
        } catch (error) {
          // A convolver only accepts a buffer at the context's own sample rate.
          console.error('cracked-up: reverb could not use its impulse', error);
        }
      };
      // A buffer that is already loaded is used at once; one still loading is used when it arrives.
      if (ref.buffer) use(ref.buffer);
      else ref.ready.then(use, () => {}); // the buffer store reports load failures
    }

    input.connect(mix.dry).connect(output);
    input.connect(convolver).connect(mix.wet).connect(output);

    return {
      input,
      output,
      params: { mix: mix.handler },
      dispose() {
        disposed = true;
        for (const node of [input, output, convolver, mix.dry, mix.wet]) node.disconnect();
      },
    };
  },
});`}],native:[`GainNode`,`ConvolverNode`]},sampler:{parts:[{file:`src/nodes/sampler.ts`,line:40,endLine:215,code:`/**
 * Plays a buffer. Every trigger starts a new one-shot voice, so there is nothing to stop or rewind
 * between hits, and voices clean up after themselves when they end.
 */
export const sampler = defineNode({
  type: 'sampler',
  category: 'source',
  description:
    'Plays a recorded sound each time it is triggered. Every trigger starts a new voice, so nothing needs stopping or rewinding between hits. Silent until it has a buffer.',
  options: {
    buffer: {
      type: 'string | AudioBuffer | BufferRef',
      description:
        'The sound to play. A string is looked up in engine.buffers by name; if nothing has that name it is loaded as a URL.',
    },
    choke: {
      type: 'boolean',
      default: 'true',
      description:
        'A new trigger cuts off voices that are still sounding. Turn off to let hits overlap.',
    },
    voices: {
      type: 'number',
      default: '16',
      description:
        'Most voices sounding at once when choke is off. The oldest is cut to make room.',
    },
  },
  triggerOptions: {
    slice: {
      type: 'number',
      description:
        "Plays one slice of the buffer by index, using the buffer's slice boundaries. Wraps past the last slice.",
    },
    duration: { type: 'seconds', description: 'Stops the voice after this long.' },
    velocity: { type: 'number', default: '1', description: 'Level of this voice.' },
  },
  params: {
    speed: {
      default: 1,
      min: 0.0625,
      max: 8,
      unit: 'ratio',
      curve: 'log',
      rate: 'control',
      description:
        'Playback rate. 2 is twice as fast and an octave up; 0.5 is half speed, an octave down.',
    },
    start: {
      default: 0,
      min: 0,
      max: 60,
      unit: 'seconds',
      rate: 'control',
      description: 'Where in the buffer playback begins.',
    },
    end: {
      default: 0,
      min: 0,
      max: 60,
      unit: 'seconds',
      rate: 'control',
      description: 'Where playback stops. At or before start means the end of the buffer.',
    },
    loop: { default: false, description: 'Repeats the region until released.' },
    reverse: { default: false, description: 'Plays the region backwards.' },
    gain: { default: 1, min: 0, max: 2, unit: 'gain', description: 'Output level.' },
  },
  triggerable: true,
  build(context, init) {
    const out = new GainNode(context.audio);
    const voices = new Set<Voice>();
    const choke = init['choke'] !== false;
    const maxVoices =
      typeof init['voices'] === 'number' && init['voices'] >= 1 ? init['voices'] : 16;
    const ref: BufferRef | null =
      init['buffer'] === undefined ? null : context.buffer(init['buffer'] as BufferSource);

    const stopVoicesBefore = (time: number) => {
      for (const voice of voices) if (voice.startTime <= time) stopVoice(voice, time);
    };

    return {
      output: out,
      params: {
        gain: out.gain,
        // Voices already sounding follow speed changes; the rest are read when a voice starts.
        speed(value, at) {
          for (const voice of voices) voice.source.playbackRate.setValueAtTime(value as number, at);
        },
        start() {},
        end() {},
        loop() {},
        reverse() {},
      },
      trigger(options, at) {
        const buffer = ref?.buffer;
        if (!ref || !buffer) return;
        const number = (name: string) =>
          typeof options[name] === 'number' ? options[name] : (context.value(name, at) as number);
        const flag = (name: string) =>
          typeof options[name] === 'boolean' ? options[name] : (context.value(name, at) as boolean);

        let start = number('start');
        let end = number('end');
        if (typeof options['slice'] === 'number') {
          const boundaries = ref.slices;
          const count = boundaries.length - 1;
          if (count >= 1) {
            const index = ((Math.floor(options['slice']) % count) + count) % count;
            start = boundaries[index]!;
            end = boundaries[index + 1]!;
          }
        }
        const total = buffer.duration;
        start = Math.min(Math.max(start, 0), total);
        if (!(end > start)) end = total;
        end = Math.min(end, total);
        const length = end - start;
        if (length <= 0) return;

        const reverse = flag('reverse');
        const loop = flag('loop');
        const from = reverse ? total - end : start;

        if (choke) {
          stopVoicesBefore(at);
        } else if (voices.size >= maxVoices) {
          const oldest = [...voices].sort((a, b) => a.startTime - b.startTime)[0];
          if (oldest) stopVoice(oldest, at);
        }

        const source = new AudioBufferSourceNode(context.audio, {
          buffer: reverse ? reversed(buffer) : buffer,
          playbackRate: number('speed'),
        });
        const velocity = typeof options['velocity'] === 'number' ? options['velocity'] : 1;
        const level = velocity === 1 ? null : new GainNode(context.audio, { gain: velocity });
        if (level) {
          source.connect(level);
          level.connect(out);
        } else {
          source.connect(out);
        }

        if (loop) {
          source.loop = true;
          source.loopStart = from;
          source.loopEnd = from + length;
          source.start(at, from);
        } else {
          source.start(at, from, length);
        }
        const voice: Voice = { source, startTime: at, stopTime: Infinity };
        if (typeof options['duration'] === 'number') stopVoice(voice, at + options['duration']);
        voices.add(voice);
        source.onended = () => {
          voices.delete(voice);
          source.disconnect();
          level?.disconnect();
        };
      },
      release(_options, at) {
        stopVoicesBefore(at);
      },
      dispose() {
        for (const voice of voices) {
          voice.source.onended = null;
          voice.source.stop();
          voice.source.disconnect();
        }
        voices.clear();
      },
    };
  },
});`}],native:[`GainNode`,`AudioBufferSourceNode`]},monosynth:{parts:[{file:`src/nodes/synths.ts`,line:182,endLine:220,code:`export const monosynth: MacroDefinition<'monosynth'> = defineMacro({
  type: 'monosynth',
  category: 'synth',
  description:
    'A one-voice synthesiser: an oscillator through a lowpass filter and an envelope, with an optional vibrato. A new note while one is sounding moves the pitch and retriggers the envelope, like a classic monophonic keyboard. Play it with trigger({ pitch }).',
  params: synthParams((name) => \`#\${name}\`),
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
});`}],native:[]},polysynth:{parts:[{file:`src/nodes/synths.ts`,line:360,endLine:399,code:`export const polysynth: MacroDefinition<'polysynth'> = defineMacro({
  type: 'polysynth',
  category: 'synth',
  description:
    'A several-voice synthesiser: every note gets its own oscillator, lowpass filter and envelope, so chords ring together and each note fades on its own. Play notes with trigger({ pitch }) and end them with release({ pitch }), or release() for all. When all voices are busy, the oldest note is cut short to make room.',
  params: synthParams((name) => \`.\${name}\`),
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
});`}],native:[]},tapedelay:{parts:[{file:`src/nodes/tapedelay.ts`,line:68,endLine:243,code:`export const tapedelay: MacroDefinition<'tapedelay'> = defineMacro({
  type: 'tapedelay',
  category: 'delay',
  description:
    'An echo in the style of a tape machine. Each repeat comes back a little darker, thinner and softer-edged than the last, and its pitch drifts slightly, the way a worn tape does. Turn feedback up past 1 and the repeats build on themselves into a howl that the tape holds back from getting out of hand. Changing the time while sound is going round bends the pitch of the repeats, like a tape speeding up or slowing down. call("freeze") catches the repeats going round at that moment and loops them unchanged until call("unfreeze"); while it holds them, new sound gets no repeats. For a time that fits the tempo, give it one from the transport: tapedelay(__.transport.seconds(\\'1/8d\\')).',
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
    // From there the sound is heard, and \`feedback\` of it goes back onto the tape.
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

    // A change of \`time\` must not jump, which would click. The delay starts at the time it is made
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
      // \`smooth\`, not a lowpass: at 4 Hz the browser's lowpass is 22% out in Chromium off macOS.
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
});`}],native:[]}},t={euclid:{parts:[{file:`src/util/pattern.ts`,line:41,endLine:74,code:`/**
 * Euclidean rhythm (Bjorklund): \`hits\` pulses spread as evenly as possible over \`steps\`.
 * The first step is a hit for rotate 0. \`rotate\` shifts the pattern left by that many steps,
 * wrapping; negative rotates right. \`hits\` is clamped to 0..steps.
 */
export function euclid(hits: number, steps: number, rotate = 0): number[] {
  if (!Number.isInteger(steps) || steps < 1) {
    throw new RangeError(\`euclid: steps must be an integer >= 1, got \${steps}\`);
  }
  if (!Number.isInteger(hits)) throw new RangeError(\`euclid: hits must be an integer, got \${hits}\`);
  if (!Number.isInteger(rotate))
    throw new RangeError(\`euclid: rotate must be an integer, got \${rotate}\`);
  const k = Math.min(Math.max(hits, 0), steps);

  let first: number[][] = Array.from({ length: k }, () => [1]);
  let second: number[][] = Array.from({ length: steps - k }, () => [0]);
  let min = Math.min(first.length, second.length);
  let threshold = 0;
  while (min > threshold) {
    threshold = 1;
    const wasFirstSmaller = min === first.length;
    for (let i = 0; i < min; i++) first[i] = [...(first[i] ?? []), ...(second[i] ?? [])];
    if (wasFirstSmaller) {
      second = second.slice(min);
    } else {
      second = first.slice(min);
      first = first.slice(0, min);
    }
    min = Math.min(first.length, second.length);
  }
  const base = [...first, ...second].flat();
  const shift = ((rotate % steps) + steps) % steps;
  return [...base.slice(shift), ...base.slice(0, shift)];
}`}],native:[]},onOffPattern:{parts:[{file:`src/util/transforms.ts`,line:273,endLine:285,code:"/**\n * `on` hits, then `off` rests, and that group `times` times over (once unless you say).\n * `onOffPattern(3, 2, 2)` is `[1, 1, 1, 0, 0, 1, 1, 1, 0, 0]`.\n *\n * The counts are rounded down, and a negative count is 0. The result is empty when `times` is 0 or\n * both counts are 0, and it stops at `MAX_PATTERN_STEPS` steps.\n */\nexport function onOffPattern(on: number, off: number, times = 1): number[] {\n  const hits = count(on);\n  const cycle = hits + count(off);\n  const length = cycle === 0 ? 0 : Math.min(cycle * count(times), MAX_PATTERN_STEPS);\n  return Array.from({ length }, (_, i) => (i % cycle < hits ? 1 : 0));\n}"}],native:[]},binaryPattern:{parts:[{file:`src/util/transforms.ts`,line:244,endLine:259,code:"/**\n * A whole number written in binary, as steps: each 1 is a hit and each 0 a rest, biggest digit\n * first. `binaryPattern(5)` is `[1, 0, 1]`, `binaryPattern(0)` is `[0]`. Fractions are rounded\n * down, and a negative number (or anything that is not a number) counts as 0.\n *\n * Without `length` the pattern is as long as the number needs, with no rests at the front. With\n * `length` it is exactly that many steps: rests are added at the front, `binaryPattern(5, 8)` is\n * `[0, 0, 0, 0, 0, 1, 0, 1]`, and a number too big to fit loses its front digits,\n * `binaryPattern(13, 3)` is `[1, 0, 1]`.\n */\nexport function binaryPattern(value: number, length?: number): number[] {\n  if (length !== undefined) whole('binaryPattern', 'length', length, 1);\n  const digits = Math.min(Number.MAX_SAFE_INTEGER, count(value)).toString(2);\n  const sized = length === undefined ? digits : digits.padStart(length, '0').slice(-length);\n  return sized.split('').map(Number);\n}"}],native:[]},binaryToNumber:{parts:[{file:`src/util/transforms.ts`,line:261,endLine:271,code:`/**
 * The opposite of \`binaryPattern\`: reads a pattern as a binary number, a hit as 1 and a rest as 0,
 * biggest digit first. \`binaryToNumber('x.x')\` is 5. An empty pattern is 0.
 */
export function binaryToNumber(pattern: Pattern): number {
  const value = toSteps(pattern).reduce((sum, step) => sum * 2 + (step === 0 ? 0 : 1), 0);
  if (value > Number.MAX_SAFE_INTEGER) {
    throw new RangeError('binaryToNumber: the pattern is too long to be an exact number');
  }
  return value;
}`}],native:[]},sieve:{parts:[{file:`src/util/transforms.ts`,line:313,endLine:346,code:`export function sieve(...args: (number | SieveClass)[]): number[] {
  const first = args[0];
  const given = typeof first === 'number' ? first : undefined;
  const classes = (given === undefined ? args : args.slice(1)).map((entry) => {
    if (!Array.isArray(entry) || entry.length < 1 || entry.length > 2) {
      throw new RangeError(
        'sieve: each class must be [modulus, offset], for example sieve(12, [3, 0], [4, 1])',
      );
    }
    const [modulus, offset = 0] = entry as SieveClass;
    whole('sieve', 'modulus', modulus, 1);
    whole('sieve', 'offset', offset);
    return { modulus, offset: ((offset % modulus) + modulus) % modulus };
  });
  if (given !== undefined) whole('sieve', 'length', given, 1);
  if (given === undefined && classes.length === 0) {
    throw new RangeError('sieve: give a length, at least one [modulus, offset] class, or both');
  }
  let length = given ?? 1;
  if (given === undefined) {
    for (const { modulus } of classes) {
      length = lcm(length, modulus);
      if (length > MAX_PATTERN_STEPS) {
        throw new RangeError(
          \`sieve: these classes only come round together after more than \${MAX_PATTERN_STEPS} steps; give a length as the first argument\`,
        );
      }
    }
  }
  checkLength('sieve', length);
  return Array.from({ length }, (_, i) =>
    classes.some(({ modulus, offset }) => i % modulus === offset) ? 1 : 0,
  );
}`}],native:[]},indexes:{parts:[{file:`src/util/transforms.ts`,line:208,endLine:221,code:`/**
 * The positions of the hits, counting from 0. \`indexes([1, 0, 1, 1, 0])\` is \`[0, 2, 3]\`.
 *
 * This turns a rhythm into a scale: \`indexes(sieve(12, [2, 0], [5, 1]))\` is
 * \`[0, 1, 2, 4, 6, 8, 10, 11]\`, semitones above a root, so
 * \`pitchToFreq(60 + pick(indexes(...)))\` is a note of that scale.
 */
export function indexes(pattern: Pattern): number[] {
  const result: number[] = [];
  toSteps(pattern).forEach((step, index) => {
    if (step !== 0) result.push(index);
  });
  return result;
}`}],native:[]},countHits:{parts:[{file:`src/util/transforms.ts`,line:223,endLine:226,code:`/** How many hits a pattern has. \`countHits('x..x..x.')\` is 3. */
export function countHits(pattern: Pattern): number {
  return toSteps(pattern).filter((step) => step !== 0).length;
}`}],native:[]},patternToString:{parts:[{file:`src/util/transforms.ts`,line:228,endLine:237,code:"/**\n * A pattern written out as text, `x` for a hit and `.` for a rest, to print it or to compare two\n * patterns by eye. `patternToString(euclid(3, 8))` is `'x..x..x.'`. The values of the hits are not\n * shown: `[2, 0, 0.5]` is `'x.x'`.\n */\nexport function patternToString(pattern: Pattern): string {\n  return toSteps(pattern)\n    .map((step) => (step === 0 ? '.' : 'x'))\n    .join('');\n}"}],native:[]},fillArray:{parts:[{file:`src/util/pattern.ts`,line:83,endLine:86,code:`export function fillArray<T>(size: number, fn?: (index: number) => T): (T | number)[] {
  const count = Number.isFinite(size) ? Math.max(0, Math.floor(size)) : 0;
  return Array.from({ length: count }, (_, index) => (fn ? fn(index) : 0));
}`}],native:[]},arrayNext:{parts:[{file:`src/util/pattern.ts`,line:94,endLine:117,code:`/**
 * Steps through a list one item per call, and starts over after the last one. The first call gives
 * the first item. The place is remembered for each list, so keep the list in a variable and pass
 * the same one every time.
 *
 * \`offset\` and \`limit\` narrow it to part of the list: items from position \`offset\` up to (not
 * including) position \`limit\`. \`onWrap\` is called each time it starts over.
 */
export function arrayNext<T>(
  items: readonly T[],
  offset = 0,
  limit = items.length,
  onWrap?: () => void,
): T | undefined {
  if (items.length === 0) return undefined;
  const end = Math.min(Math.max(Math.floor(limit) || items.length, 1), items.length);
  const start = Math.min(Math.max(Math.floor(offset) || 0, 0), end - 1);
  const previous = positions.get(items) ?? -1;
  const wrapped = start + previous + 1 >= end;
  const index = wrapped ? 0 : previous + 1;
  positions.set(items, index);
  if (wrapped && previous >= 0 && onWrap) onWrap();
  return items[start + index];
}`}],native:[]},everyNth:{parts:[{file:`src/util/pattern.ts`,line:122,endLine:136,code:`/**
 * Makes a counter that says yes on every nth call: \`const third = everyNth(3)\` gives a function
 * that returns false, false, true, false, false, true, and so on. Call it once per step to do
 * something on every third step.
 */
export function everyNth(n: number): () => boolean {
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError(\`everyNth: n must be an integer >= 1, got \${n}\`);
  }
  let calls = 0;
  return () => {
    calls++;
    return calls % n === 0;
  };
}`}],native:[]},holdSteps:{parts:[{file:`src/util/pattern.ts`,line:141,endLine:174,code:`/**
 * Makes a function that holds each position of a list for a number of calls. \`counts\` says how
 * many calls each position lasts: with \`[4, 2]\`, calls 1 to 4 are position 0, calls 5 and 6 are
 * position 1, then it starts over. Call it once per step, for example to stay on one chord for
 * four steps and the next for two.
 *
 * Each call returns the position. If you pass \`fn\`, it is also called every time with \`changed\`
 * (true on the first call of each position) and the position.
 * Counts of zero or less are skipped.
 */
export function holdSteps(
  counts: readonly number[],
  fn?: (changed: boolean, index: number) => void,
): () => number {
  const held = counts
    .map((count, index) => ({ count: Math.floor(count), index }))
    .filter((entry) => entry.count >= 1);
  if (held.length === 0) {
    throw new RangeError('holdSteps: counts needs at least one number that is 1 or more');
  }
  let at = 0;
  let calls = 0;
  return () => {
    let current = held[at]!;
    if (calls === current.count) {
      at = (at + 1) % held.length;
      current = held[at]!;
      calls = 0;
    }
    calls++;
    fn?.(calls === 1, current.index);
    return current.index;
  };
}`}],native:[]},rotate:{parts:[{file:`src/util/transforms.ts`,line:52,endLine:65,code:"/**\n * Shifts a pattern round, wrapping. A positive number starts the pattern that many steps later, so\n * every hit comes that many steps earlier; a negative number does the opposite. This is the same\n * direction as the `rotate` argument of `euclid`: `rotate(euclid(3, 8), 1)` is `euclid(3, 8, 1)`.\n *\n * `rotate('x..x....', 1)` is `[0, 0, 1, 0, 0, 0, 0, 1]` (`'..x....x'`).\n */\nexport function rotate(pattern: Pattern, steps: number): number[] {\n  whole('rotate', 'steps', steps);\n  const list = toSteps(pattern);\n  if (list.length === 0) return list;\n  const shift = ((steps % list.length) + list.length) % list.length;\n  return [...list.slice(shift), ...list.slice(0, shift)];\n}"}],native:[]},reverse:{parts:[{file:`src/util/transforms.ts`,line:67,endLine:74,code:`/**
 * The pattern backwards. \`reverse('x.xx....')\` is \`[0, 0, 0, 0, 1, 1, 0, 1]\`.
 *
 * (Nothing to do with the \`reverse\` setting of a sampler, which plays the sound backwards.)
 */
export function reverse(pattern: Pattern): number[] {
  return toSteps(pattern).reverse();
}`}],native:[]},invert:{parts:[{file:`src/util/transforms.ts`,line:76,endLine:82,code:`/**
 * Swaps hits and rests: every hit becomes a rest, and every rest becomes a hit with \`value\`
 * (1 unless you say). \`invert('x..x')\` is \`[0, 1, 1, 0]\`.
 */
export function invert(pattern: Pattern, value = 1): number[] {
  return toSteps(pattern).map((step) => (step === 0 ? value : 0));
}`}],native:[]},stretch:{parts:[{file:`src/util/transforms.ts`,line:84,endLine:94,code:`/**
 * Slows a pattern down by holding each step: every step is repeated \`factor\` times, so a hit
 * becomes that many hits in a row with the same value. \`stretch('x.', 2)\` is \`[1, 1, 0, 0]\`.
 * To slow a pattern down and keep the same number of hits, use \`spread\`.
 */
export function stretch(pattern: Pattern, factor: number): number[] {
  whole('stretch', 'factor', factor, 1);
  const list = toSteps(pattern);
  checkLength('stretch', list.length * factor);
  return list.flatMap((step) => Array.from({ length: factor }, () => step));
}`}],native:[]},spread:{parts:[{file:`src/util/transforms.ts`,line:96,endLine:106,code:`/**
 * Slows a pattern down by putting rests after each step: every step takes \`factor\` steps, and a
 * hit is one hit followed by rests. \`spread('xx.', 2)\` is \`[1, 0, 1, 0, 0, 0]\`. Played at twice
 * the step rate it sounds the same as the original.
 */
export function spread(pattern: Pattern, factor: number): number[] {
  whole('spread', 'factor', factor, 1);
  const list = toSteps(pattern);
  checkLength('spread', list.length * factor);
  return list.flatMap((step) => Array.from({ length: factor }, (_, i) => (i === 0 ? step : 0)));
}`}],native:[]},palindrome:{parts:[{file:`src/util/transforms.ts`,line:108,endLine:117,code:"/**\n * The pattern forwards and then backwards. Normally the turning points are played once, so the\n * result loops smoothly: `palindrome([1, 2, 3])` is `[1, 2, 3, 2]`. With `repeatEnds` true the\n * last and first steps are played twice: `palindrome([1, 2, 3], true)` is `[1, 2, 3, 3, 2, 1]`.\n */\nexport function palindrome(pattern: Pattern, repeatEnds = false): number[] {\n  const list = toSteps(pattern);\n  const back = [...list].reverse();\n  return [...list, ...(repeatEnds ? back : back.slice(1, -1))];\n}"}],native:[]},repeat:{parts:[{file:`src/util/transforms.ts`,line:119,endLine:125,code:`/** The pattern played \`times\` times in a row. \`repeat('x.', 3)\` is \`[1, 0, 1, 0, 1, 0]\`. */
export function repeat(pattern: Pattern, times: number): number[] {
  whole('repeat', 'times', times, 0);
  const list = toSteps(pattern);
  checkLength('repeat', list.length * times);
  return Array.from({ length: times }, () => list).flat();
}`}],native:[]},and:{parts:[{file:`src/util/transforms.ts`,line:154,endLine:163,code:`/**
 * A hit only where both patterns have a hit. The hit keeps the first pattern's value, so the second
 * works as a mask: \`and([3, 2, 0, 5], 'x.xx')\` is \`[3, 0, 0, 5]\`.
 *
 * When the lengths differ, each pattern repeats until they line up again:
 * \`and('x.x', 'xx')\` is \`[1, 0, 1, 1, 0, 1]\`.
 */
export function and(a: Pattern, b: Pattern): number[] {
  return combine('and', a, b, (x, y) => (x !== 0 && y !== 0 ? x : 0));
}`}],native:[]},or:{parts:[{file:`src/util/transforms.ts`,line:165,endLine:174,code:`/**
 * A hit where either pattern has a hit: the two rhythms laid on top of each other. Where both hit,
 * the first pattern's value is used. \`or('x...', '..x.')\` is \`[1, 0, 1, 0]\`.
 *
 * When the lengths differ, each pattern repeats until they line up again:
 * \`or('x..', 'x.')\` is \`[1, 0, 1, 1, 1, 0]\`.
 */
export function or(a: Pattern, b: Pattern): number[] {
  return combine('or', a, b, (x, y) => (x !== 0 ? x : y));
}`}],native:[]},xor:{parts:[{file:`src/util/transforms.ts`,line:176,endLine:184,code:`/**
 * A hit where one pattern has a hit and the other has a rest; where both hit, they cancel. The hit
 * keeps the value it had. \`xor('xx..', 'x.x.')\` is \`[0, 1, 1, 0]\`.
 *
 * When the lengths differ, each pattern repeats until they line up again.
 */
export function xor(a: Pattern, b: Pattern): number[] {
  return combine('xor', a, b, (x, y) => (x !== 0 && y !== 0 ? 0 : x !== 0 ? x : y));
}`}],native:[]},interleave:{parts:[{file:`src/util/transforms.ts`,line:186,endLine:199,code:`/**
 * Takes a step from each pattern in turn: the first step of each, then the second of each, and so
 * on. \`interleave('xx', '..')\` is \`[1, 0, 1, 0]\`. A shorter pattern starts over while the longest
 * one finishes: \`interleave([1, 2, 3], [9])\` is \`[1, 9, 2, 9, 3, 9]\`. Empty patterns are left out.
 */
export function interleave(...patterns: Pattern[]): number[] {
  const lists = patterns.map(toSteps).filter((list) => list.length > 0);
  const longest = Math.max(0, ...lists.map((list) => list.length));
  const result: number[] = [];
  for (let i = 0; i < longest; i++) {
    for (const list of lists) result.push(list[i % list.length] ?? 0);
  }
  return result;
}`}],native:[]},concat:{parts:[{file:`src/util/transforms.ts`,line:201,endLine:204,code:"/** The patterns one after another. `concat('x..', [0, 2])` is `[1, 0, 0, 0, 2]`. */\nexport function concat(...patterns: Pattern[]): number[] {\n  return patterns.flatMap(toSteps);\n}"}],native:[]},pitchToFreq:{parts:[{file:`src/util/music.ts`,line:4,endLine:7,code:`/** MIDI note number to Hz. A4 = 69 = 440 Hz. Fractional pitches give fractional frequencies. */
export function pitchToFreq(pitch: number): number {
  return 440 * Math.pow(2, (pitch - 69) / 12);
}`}],native:[]},freqToPitch:{parts:[{file:`src/util/music.ts`,line:9,endLine:12,code:`/** Hz to MIDI note number, fractional (not floored). */
export function freqToPitch(freq: number): number {
  return 69 + 12 * Math.log2(freq / 440);
}`}],native:[]},scales:{parts:[{file:`src/util/music.ts`,line:122,endLine:128,code:`/** Semitone offsets of a named scale. Returns a fresh array; unknown names throw RangeError. */
export function scales(name: ScaleName): number[] {
  if (!Object.hasOwn(SCALE_TABLE, name)) {
    throw new RangeError(\`Unknown scale "\${String(name)}". Known: \${SCALE_NAMES.join(', ')}\`);
  }
  return [...SCALE_TABLE[name]];
}`}],native:[]},chords:{parts:[{file:`src/util/music.ts`,line:130,endLine:136,code:`/** Semitone offsets of a named chord. Returns a fresh array; unknown names throw RangeError. */
export function chords(name: ChordName): number[] {
  if (!Object.hasOwn(CHORD_TABLE, name)) {
    throw new RangeError(\`Unknown chord "\${String(name)}". Known: \${CHORD_NAMES.join(', ')}\`);
  }
  return [...CHORD_TABLE[name]];
}`}],native:[]},randomScale:{parts:[{file:`src/util/music.ts`,line:149,endLine:164,code:`/**
 * A random note of a scale, as a frequency in Hz. The scale starts on C. The octave is chosen at
 * random from \`octaveLow\` to \`octaveHigh\` (default 3 to 7), where octave 5 starts on middle C
 * (MIDI note 60, since the note number is the scale step plus 12 times the octave).
 *
 * Call it once per note: \`__('#synth').set({ frequency: randomScale('minor', 4, 5) })\`.
 * Pass a seeded source last for the same notes every time.
 */
export function randomScale(
  name: ScaleName,
  octaveLow = 3,
  octaveHigh = 7,
  source?: RandomSource,
): number {
  return randomNote(scales(name), octaveLow, octaveHigh, source);
}`}],native:[]},randomArpeggio:{parts:[{file:`src/util/music.ts`,line:166,endLine:177,code:`/**
 * A random note of a chord, as a frequency in Hz. Works like \`randomScale\`, with a chord name such
 * as 'minor_seventh' in place of the scale.
 */
export function randomArpeggio(
  name: ChordName,
  octaveLow = 3,
  octaveHigh = 7,
  source?: RandomSource,
): number {
  return randomNote(chords(name), octaveLow, octaveHigh, source);
}`}],native:[]},createRandom:{parts:[{file:`src/util/random.ts`,line:3,endLine:55,code:`/**
 * Seeded random source using mulberry32. Same seed, same sequence; \`seed(v)\` restarts it.
 *
 * \`chance(p)\` always consumes exactly one draw, even when p <= 0 (false) or p >= 1 (true), so the
 * stream position does not depend on the probabilities passed. \`pick([])\` consumes nothing.
 */
export function createRandom(seed: number): Random {
  let state = 0;

  const reseed = (value: number): void => {
    state = Number.isFinite(value) ? Math.floor(value) >>> 0 : 0;
  };

  const float = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  reseed(seed);

  return {
    seed: reseed,
    float,
    int(min, max) {
      const lo = Math.ceil(Math.min(min, max));
      const hi = Math.floor(Math.max(min, max));
      return lo + Math.floor(float() * (hi - lo + 1));
    },
    chance(probability) {
      const r = float();
      if (probability <= 0) return false;
      if (probability >= 1) return true;
      return r < probability;
    },
    pick(items) {
      if (items.length === 0) return undefined;
      return items[Math.floor(float() * items.length)];
    },
    shuffle(items) {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(float() * (i + 1));
        const a = out[i] as (typeof out)[number];
        out[i] = out[j] as (typeof out)[number];
        out[j] = a;
      }
      return out;
    },
  };
}`}],native:[]},randomInt:{parts:[{file:`src/util/random.ts`,line:69,endLine:81,code:"/**\n * A random whole number from `min` to `max`, both included, each equally likely.\n * `randomInt(1, 6)` is a dice roll. Pass a seeded source as the last argument to get the same\n * numbers every time: `randomInt(1, 6, createRandom(7))`.\n *\n * Cracked called this `random`. Its version rounded, which made `min` and `max` come up half as\n * often as the numbers between them; this one does not have that fault.\n */\nexport function randomInt(min: number, max: number, source?: RandomSource): number {\n  const lo = Math.ceil(Math.min(min, max));\n  const hi = Math.floor(Math.max(min, max));\n  return lo + Math.floor(draw(source) * (hi - lo + 1));\n}"}],native:[]},randomFloat:{parts:[{file:`src/util/random.ts`,line:86,endLine:89,code:"/** A random number from `min` up to (not including) `max`, fractions included. */\nexport function randomFloat(min: number, max: number, source?: RandomSource): number {\n  return min + draw(source) * (max - min);\n}"}],native:[]},chance:{parts:[{file:`src/util/random.ts`,line:91,endLine:100,code:`/**
 * True that often: \`chance(0.25)\` is true about one time in four. 0 is never, 1 is always.
 *
 * Cracked's \`chance\` took a percentage from 0 to 100. This one takes 0 to 1, like every other
 * probability in the library.
 */
export function chance(probability: number, source?: RandomSource): boolean {
  // Always one draw, so what comes next from a seeded source does not depend on the probability.
  return draw(source) < probability;
}`}],native:[]},pick:{parts:[{file:`src/util/random.ts`,line:102,endLine:106,code:`/** One item from the list, chosen at random. An empty list gives \`undefined\`. */
export function pick<T>(items: readonly T[], source?: RandomSource): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(draw(source) * items.length)];
}`}],native:[]},shuffle:{parts:[{file:`src/util/random.ts`,line:108,endLine:121,code:`/**
 * The same items in a random order, as a new list. The list you pass in is left as it was.
 * (Cracked's \`shuffle\` reordered the list it was given.)
 */
export function shuffle<T>(items: readonly T[], source?: RandomSource): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(draw(source) * (i + 1));
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
}`}],native:[]},randomEnvelope:{parts:[{file:`src/util/random.ts`,line:123,endLine:133,code:`/**
 * Four random lengths that add up to \`length\`: for example the attack, decay, sustain and release
 * times of an envelope that lasts \`length\` seconds in all.
 */
export function randomEnvelope(length: number, source?: RandomSource): number[] {
  const parts = [draw(source), draw(source), draw(source), draw(source)];
  const sum = parts.reduce((a, b) => a + b, 0);
  // Four zeros in a row is next to impossible, but dividing by it would give NaN.
  if (sum === 0) return parts.map(() => length / 4);
  return parts.map((part) => (part * length) / sum);
}`}],native:[]},scale:{parts:[{file:`src/util/music.ts`,line:27,endLine:52,code:`/**
 * Maps \`value\` from the input range to the output range.
 * - linear: ((value - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin. Not rounded.
 * - log: exponential mapping, as in Cracked:
 *   exp(ln(outMin || 1) + ((ln(outMax || 1) - ln(outMin || 1)) / (inMax - inMin)) * (value - inMin)).
 *   An out bound of 0 is treated as 1 (the original's \`|| 1\`), so the output is never 0.
 *   'logarithmic' is accepted as another spelling of 'log', as in Cracked.
 *
 * \`scale(64, 0, 127, 0, 1)\` turns a MIDI controller value into a level of about 0.5.
 */
export function scale(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
  curve: 'linear' | 'log' | 'logarithmic' = 'linear',
): number {
  if (curve === 'log' || curve === 'logarithmic') {
    const minVal = Math.log(outMin || 1);
    const maxVal = Math.log(outMax || 1);
    const factor = (maxVal - minVal) / (inMax - inMin);
    return Math.exp(minVal + factor * (value - inMin));
  }
  return ((value - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;
}`}],native:[]},clamp:{parts:[{file:`src/util/music.ts`,line:20,endLine:25,code:"/** Keeps a number inside a range: below `min` gives `min`, above `max` gives `max`. */\nexport function clamp(value: number, min: number, max: number): number {\n  const lo = Math.min(min, max);\n  const hi = Math.max(min, max);\n  return Math.min(Math.max(value, lo), hi);\n}"}],native:[]},dbToGain:{parts:[{file:`src/util/music.ts`,line:59,endLine:62,code:`/** Decibels to linear gain. */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}`}],native:[]},gainToDb:{parts:[{file:`src/util/music.ts`,line:54,endLine:57,code:`/** Linear gain to decibels. 0 gives -Infinity. */
export function gainToDb(gain: number): number {
  return 20 * Math.log10(gain);
}`}],native:[]},beatsToSeconds:{parts:[{file:`src/util/duration.ts`,line:51,endLine:54,code:`/** Seconds that a number of beats lasts at \`bpm\` (beats per minute). */
export function beatsToSeconds(beats: number, bpm: number): number {
  return (beats * 60) / bpm;
}`}],native:[]},secondsToBeats:{parts:[{file:`src/util/duration.ts`,line:56,endLine:59,code:"/** Beats that elapse in `seconds` at `bpm`. */\nexport function secondsToBeats(seconds: number, bpm: number): number {\n  return (seconds * bpm) / 60;\n}"}],native:[]},msToSec:{parts:[{file:`src/util/music.ts`,line:64,endLine:67,code:`/** Milliseconds to seconds: \`msToSec(250)\` is 0.25. */
export function msToSec(ms: number): number {
  return ms / 1000;
}`}],native:[]},secToMs:{parts:[{file:`src/util/music.ts`,line:69,endLine:72,code:`/** Seconds to milliseconds: \`secToMs(0.25)\` is 250. */
export function secToMs(seconds: number): number {
  return seconds * 1000;
}`}],native:[]},msToMin:{parts:[{file:`src/util/music.ts`,line:74,endLine:77,code:`/** Milliseconds to minutes: \`msToMin(90000)\` is 1.5. */
export function msToMin(ms: number): number {
  return ms / 60000;
}`}],native:[]},minToMs:{parts:[{file:`src/util/music.ts`,line:79,endLine:82,code:`/** Minutes to milliseconds: \`minToMs(1.5)\` is 90000. */
export function minToMs(minutes: number): number {
  return minutes * 60000;
}`}],native:[]}};export{t as HELPER_SOURCES,e as NODE_SOURCES};