import type { NodeTypeInfo } from '../src';

/**
 * A short runnable example for a node type, built from its metadata, for the docs page. It is written
 * for the live demo, where `__` builds and selects and `t` is the transport.
 *
 * A test runs the example for every registered type, so a new node type cannot ship with a broken one.
 */
export function exampleFor(info: NodeTypeInfo): string {
  const type = info.type;
  const shorthand = info.params.find((param) => param.name === info.shorthand);
  const argument = shorthand ? String(shorthand.default) : '';

  if (type === 'sampler') {
    return `__().sampler({ id: 'hit', buffer: 'kick' }).to('main');\nt.every('1/4', () => __('#hit').trigger());`;
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
        `t.every('1/4', () => __('#env').trigger({ duration: 0.1 }));`
      );
    case 'delay':
    case 'distortion':
      // Easier to hear on a short sound than on a drone.
      return (
        `__().sampler({ id: 'hit', buffer: 'snare' }).${type}(${argument}).gain(0.5).to('main');\n` +
        `t.every('1/2', () => __('#hit').trigger());`
      );
    default:
      if (type === 'panner') return `__().saw(110).gain(0.2).panner(-0.8).to('main');`;
      return `__().saw(110).${type}(${argument}).gain(0.2).to('main');`;
  }
}
