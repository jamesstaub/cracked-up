/** What `encodeWav` needs: an AudioBuffer has this shape. */
export interface PcmAudio {
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  readonly length: number;
  getChannelData(channel: number): Float32Array;
}

export interface WavOptions {
  /** 16 or 24 for whole-number samples, 32 for floating point. Default 16. */
  bitDepth?: 16 | 24 | 32;
}

/**
 * Encodes audio as a WAV file. Whole-number formats clip anything beyond full scale; 32-bit floating
 * point keeps the samples exactly as they are.
 */
export function encodeWav(audio: PcmAudio, options: WavOptions = {}): ArrayBuffer {
  const bitDepth = options.bitDepth ?? 16;
  if (bitDepth !== 16 && bitDepth !== 24 && bitDepth !== 32) {
    throw new RangeError('A WAV bit depth must be 16, 24 or 32.');
  }
  const channels = audio.numberOfChannels;
  const frames = audio.length;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = channels * bytesPerSample;
  const dataBytes = frames * blockAlign;
  const out = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(out);
  const text = (offset: number, value: string): void => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };

  text(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  // Format 1 is whole-number PCM, 3 is floating point.
  view.setUint16(20, bitDepth === 32 ? 3 : 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, audio.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  text(36, 'data');
  view.setUint32(40, dataBytes, true);

  const data: Float32Array[] = [];
  for (let channel = 0; channel < channels; channel++) data.push(audio.getChannelData(channel));
  let offset = 44;
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      const sample = data[channel]![frame]!;
      if (bitDepth === 32) {
        view.setFloat32(offset, sample, true);
      } else {
        const clipped = Math.max(-1, Math.min(1, sample));
        if (bitDepth === 16) {
          view.setInt16(offset, Math.round(clipped * 32767), true);
        } else {
          const value = Math.round(clipped * 8388607);
          view.setUint8(offset, value & 0xff);
          view.setUint8(offset + 1, (value >> 8) & 0xff);
          view.setUint8(offset + 2, (value >> 16) & 0xff);
        }
      }
      offset += bytesPerSample;
    }
  }
  return out;
}
