import { defineNode } from '../define';

/** One straight-line piece of the envelope, as scheduled on the gain. A jump has t0 === t1. */
interface Segment {
  t0: number;
  v0: number;
  t1: number;
  v1: number;
}

export const adsr = defineNode({
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
      description: 'Release for this trigger only; used when `duration` releases it.',
    },
  },
  build(context) {
    const audio = context.audio;
    const node = new GainNode(audio, { gain: 0 });
    const gain = node.gain;

    // What has been scheduled on `gain`, so the level at any time is known even where the browser
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

    /** Cancels everything from `at` on and holds the level reached by then. */
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
        // reaches `level` at `at`.
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
});
