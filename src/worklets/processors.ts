/**
 * The library's AudioWorklet processors, as source text.
 *
 * Worklet code runs in its own global scope and is loaded from a URL, so it cannot be imported like
 * the rest of the library. Keeping it as text lets the engine load it from a blob URL with no bundler
 * setup. A host whose content security policy forbids blob URLs can write this text to a file it
 * serves and pass that file's URL as `workletUrl` to `createEngine`.
 */

/** Name of the bitcrusher processor, for `BuildContext.worklet`. */
export const BITCRUSHER = 'cracked-up-bitcrusher';

export const processorSource = /* js */ `
class Bitcrusher extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'bits', defaultValue: 8, minValue: 1, maxValue: 16, automationRate: 'k-rate' },
      { name: 'rate', defaultValue: 1, minValue: 0.0001, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    // One sample-and-hold per channel.
    this.phase = [];
    this.held = [];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;
    const step = Math.pow(0.5, parameters.bits[0] - 1);
    const rate = parameters.rate[0];
    for (let channel = 0; channel < output.length; channel++) {
      const source = input[channel] || input[0];
      const target = output[channel];
      // Start one step short of a full cycle, so the very first sample is taken.
      let phase = this.phase[channel] === undefined ? 1 - rate : this.phase[channel];
      let held = this.held[channel] || 0;
      for (let i = 0; i < target.length; i++) {
        // Take a new sample only every 1 / rate samples, and round it to one of 2^bits levels.
        phase += rate;
        if (phase >= 1) {
          phase -= 1;
          held = step * Math.round(source[i] / step);
        }
        target[i] = held;
      }
      this.phase[channel] = phase;
      this.held[channel] = held;
    }
    return true;
  }
}
registerProcessor('${BITCRUSHER}', Bitcrusher);
`;
