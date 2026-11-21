/**
 * What a delay or a reverb uses to let go of its tail when it is silenced: gates on the way into and
 * out of what holds the sound. While they are shut nothing is heard from it and silence is written
 * into it, so once it has been shut for as long as the sound it holds, it is empty.
 */
export function closeFor(gates: readonly GainNode[], at: number, seconds: number): void {
  for (const gate of gates) {
    gate.gain.cancelScheduledValues(at);
    gate.gain.setValueAtTime(0, at);
    gate.gain.setValueAtTime(1, at + seconds);
  }
}

/** How long a delay line holds sound: its time now, with room for a time that moves, up to its most. */
export function heldBy(delay: DelayNode, most: number): number {
  return Math.min(most, delay.delayTime.value * 1.5 + 0.05);
}
