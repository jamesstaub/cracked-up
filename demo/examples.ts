import type { NodeTypeInfo } from '../src';

/**
 * A short runnable example for a node type, built from its metadata, for the docs page. It is written
 * for the live demo, where `__` builds and selects and `__.transport` is the transport.
 *
 * A test runs the example for every registered type, so a new node type cannot ship with a broken one.
 */
export function exampleFor(info: NodeTypeInfo): string {
  const type = info.type;
  const shorthand = info.params.find((param) => param.name === info.shorthand);
  const argument = shorthand ? String(shorthand.default) : '';

  if (type === 'sampler') {
    return `__().sampler({ id: 'hit', buffer: 'kick' }).to('main');\n__.transport.every('1/4', () => __('#hit').trigger());`;
  }
  if (type === 'recorder') {
    return (
      `__().sampler({ id: 'hit', buffer: 'snare' }).recorder({ id: 'rec', into: 'take' }).gain(0.5).to('main');\n` +
      `__().sampler({ id: 'again', buffer: 'take', speed: 0.5 }).to('main');\n` +
      `__.transport.every('1/4', () => __('#hit').trigger());\n` +
      `// Every two bars, record half a bar. Every bar, play the latest take at half speed.\n` +
      `__.transport.every('2 bars', () => __('#rec').trigger({ duration: __.transport.seconds('1/2') }));\n` +
      `__.transport.every('1 bar', () => __('#again').trigger());`
    );
  }
  if (type === 'looper') {
    return (
      `__().sampler({ id: 'hit', buffer: 'kick' }).looper({ id: 'loop', length: '1 bar' }).gain(0.6).to('main');\n` +
      `// The kick plays for one bar in every four. The looper records that bar and repeats it.\n` +
      `__.transport.sequence('feed', { steps: 'x..x..x.' + '.'.repeat(24), step: '1/8' }, (ev) => {\n` +
      `  if (ev.value) __('#hit').trigger();\n` +
      `});\n` +
      `__.transport.every('4 bars', () => {\n` +
      `  __('#loop').call('clear').trigger();\n` +
      `});`
    );
  }
  if (type === 'input') {
    return `// Asks for the microphone. Use headphones, or the speakers will feed back.\n__().input().delay(0.3).gain(0.5).to('main');`;
  }
  switch (info.category) {
    case 'source':
      return `__().${type}(${argument}).gain(0.2).to('main');`;
    case 'filter': {
      const settings = info.params
        .map((param) => {
          const value =
            param.name === 'frequency'
              ? 800
              : param.name === 'gain'
                ? 12
                : param.name === 'q'
                  ? 4
                  : 0;
          return `${param.name}: ${value}`;
        })
        .join(', ');
      return `__().saw(110).${type}({ ${settings} }).gain(0.2).to('main');`;
    }
    case 'modulator':
      // A modulator has no input: it drives a parameter of another node.
      return (
        `__().saw(110).lowpass({ id: 'filter', frequency: 800, q: 6 }).gain(0.2).to('main');\n` +
        `__().${type}({ depth: 500 }).modulate('#filter', 'frequency');`
      );
    case 'envelope':
      // An envelope is silent until triggered.
      return (
        `__().saw(110).${type}({ id: 'env' }).gain(0.2).to('main');\n` +
        `__.transport.every('1/4', () => __('#env').trigger({ duration: 0.1 }));`
      );
    case 'synth':
      // Plays a short arpeggio from a sequence.
      return (
        `__().${type}({ id: 'synth', shape: 'saw', cutoff: 1500, release: 0.3 }).to('main');\n` +
        `__.transport.sequence({ steps: 8, step: '1/8' }, (ev) =>\n` +
        `  __('#synth').trigger({ pitch: [48, 55, 60, 64][ev.index % 4], duration: 0.15 }));`
      );
    case 'delay':
    case 'distortion':
      // Easier to hear on a short sound than on a drone.
      return (
        `__().sampler({ id: 'hit', buffer: 'snare' }).${type}(${argument}).gain(0.5).to('main');\n` +
        `__.transport.every('1/2', () => __('#hit').trigger());`
      );
    default:
      if (type === 'panner') return `__().saw(110).gain(0.2).panner(-0.8).to('main');`;
      return `__().saw(110).${type}(${argument}).gain(0.2).to('main');`;
  }
}
