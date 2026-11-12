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

/** Name of the recorder processor. */
export const RECORDER = 'cracked-up-recorder';

/** Name of the looper processor. */
export const LOOPER = 'cracked-up-looper';

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

// Both processors below are controlled through audio-rate parameters used as gates, not through
// messages. A scheduled parameter change takes effect on an exact sample and works the same in an
// offline render, where messages sent to a processor are not guaranteed to arrive in time.

/**
 * Passes its input through and, while the "record" gate is high, copies it out to the main thread in
 * chunks. Each time the gate rises a new take begins.
 */
class Recorder extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'record', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'a-rate' }];
  }

  constructor(options) {
    super();
    const given = (options && options.processorOptions) || {};
    // Offline, the frame at which the render ends, so a take still open then is finished.
    this.endFrame = typeof given.endFrame === 'number' ? given.endFrame : Infinity;
    this.chunkFrames = given.chunkFrames || 8192;
    this.take = 0;
    this.recording = false;
    this.chunk = null;
    this.filled = 0;
  }

  flush(last) {
    const data = this.chunk ? this.chunk.map((channel) => channel.subarray(0, this.filled)) : [];
    this.port.postMessage({ take: this.take, data, last });
    this.chunk = null;
    this.filled = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0] || [];
    const output = outputs[0];
    const frames = output[0].length;
    const gate = parameters.record;
    for (let channel = 0; channel < output.length; channel++) {
      if (input[channel]) output[channel].set(input[channel]);
    }
    for (let i = 0; i < frames; i++) {
      const high = (gate.length > 1 ? gate[i] : gate[0]) >= 0.5 && currentFrame + i < this.endFrame;
      if (high && !this.recording) {
        this.recording = true;
        this.take++;
      } else if (!high && this.recording) {
        this.recording = false;
        this.flush(true);
      }
      if (!this.recording) continue;
      if (!this.chunk) {
        this.chunk = [];
        for (let channel = 0; channel < output.length; channel++) {
          this.chunk.push(new Float32Array(this.chunkFrames));
        }
      }
      for (let channel = 0; channel < output.length; channel++) {
        this.chunk[channel][this.filled] = input[channel] ? input[channel][i] : 0;
      }
      if (++this.filled === this.chunkFrames) this.flush(false);
    }
    // The render may end exactly on a block boundary, so the frame after the last is never seen.
    if (this.recording && currentFrame + frames >= this.endFrame) {
      this.recording = false;
      this.flush(true);
    }
    return true;
  }
}
registerProcessor('${RECORDER}', Recorder);

/**
 * A loop of fixed length made of layers. While the "record" gate is high the input is added to the
 * newest layer at the loop's current position; every layer plays back all the time. The first time
 * the gate rises sets where the loop starts and, from the "length" parameter, how long it is.
 *
 * The length need not be a whole number of samples: each cycle starts at the nearest sample to its
 * exact time, so the loop never drifts from the clock it was started against.
 */
class Looper extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const gate = (name, defaultValue) => ({
      name, defaultValue, minValue: 0, maxValue: 1, automationRate: 'a-rate',
    });
    return [
      gate('record', 0),
      gate('play', 1),
      gate('undo', 0),
      gate('clear', 0),
      { name: 'gain', defaultValue: 1, minValue: 0, maxValue: 4, automationRate: 'a-rate' },
      { name: 'monitor', defaultValue: 1, minValue: 0, maxValue: 4, automationRate: 'k-rate' },
      { name: 'overdub', defaultValue: 0.7, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'length', defaultValue: 2, minValue: 0.001, maxValue: 120, automationRate: 'k-rate' },
      { name: 'latency', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.layers = [];
    this.anchor = null;
    this.exact = 0;
    this.cycle = 0;
    this.cycleStart = 0;
    this.nextStart = 0;
    this.previousLength = 0;
    this.recording = false;
    this.writeGain = 1;
    this.wasRecord = false;
    this.wasUndo = false;
    this.wasClear = false;
  }

  reset() {
    this.layers = [];
    this.anchor = null;
    this.recording = false;
  }

  newLayer(channels) {
    const size = Math.ceil(this.exact) + 2;
    const layer = [];
    for (let channel = 0; channel < channels; channel++) layer.push(new Float32Array(size));
    this.layers.push(layer);
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0] || [];
    const output = outputs[0];
    const frames = output[0].length;
    const channels = output.length;
    const at = (param, i) => (param.length > 1 ? param[i] : param[0]);
    const monitor = parameters.monitor[0];
    const latency = Math.round(parameters.latency[0] * sampleRate);

    for (let i = 0; i < frames; i++) {
      const frame = currentFrame + i;
      const record = at(parameters.record, i) >= 0.5;
      const undo = at(parameters.undo, i) >= 0.5;
      const clear = at(parameters.clear, i) >= 0.5;

      if (clear && !this.wasClear) this.reset();
      if (undo && !this.wasUndo) {
        this.layers.pop();
        this.recording = false;
        if (this.layers.length === 0) this.anchor = null;
      }
      if (record && !this.wasRecord) {
        if (this.anchor === null) {
          // The gate is scheduled "latency" late, so the loop itself starts that much earlier.
          this.anchor = frame - latency;
          this.exact = Math.max(1, parameters.length[0] * sampleRate);
          this.cycle = 0;
          this.cycleStart = this.anchor;
          this.nextStart = this.anchor + Math.round(this.exact);
          this.previousLength = this.nextStart - this.cycleStart;
        }
        // The first layer is recorded as it is; layers on top of it are recorded quieter, so that
        // stacking them does not push the sum past full scale.
        this.writeGain = this.layers.length === 0 ? 1 : parameters.overdub[0];
        this.newLayer(channels);
        this.recording = true;
      } else if (!record && this.wasRecord) {
        this.recording = false;
      }
      this.wasRecord = record;
      this.wasUndo = undo;
      this.wasClear = clear;

      let position = -1;
      if (this.anchor !== null) {
        while (frame >= this.nextStart) {
          this.previousLength = this.nextStart - this.cycleStart;
          this.cycle++;
          this.cycleStart = this.nextStart;
          this.nextStart = this.anchor + Math.round((this.cycle + 1) * this.exact);
        }
        position = frame - this.cycleStart;
      }

      const playing = position >= 0 && at(parameters.play, i) >= 0.5;
      const gain = at(parameters.gain, i);
      for (let channel = 0; channel < channels; channel++) {
        const dry = input[channel] ? input[channel][i] : 0;
        let sum = 0;
        if (playing) {
          for (let layer = 0; layer < this.layers.length; layer++) {
            sum += this.layers[layer][channel][position];
          }
        }
        output[channel][i] = sum * gain + dry * monitor;
        if (this.recording && position >= 0) {
          // What arrives now was played "latency" ago: write it where the loop was then.
          let write = position - latency;
          if (write < 0) write += this.previousLength;
          if (write >= 0) {
            this.layers[this.layers.length - 1][channel][write] += dry * this.writeGain;
          }
        }
      }
    }
    return true;
  }
}
registerProcessor('${LOOPER}', Looper);
`;
