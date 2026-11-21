import { describe, expect, it } from 'vitest';
import type { Engine } from '../../src';
import { SAMPLE_RATE, click, ones, offlineEngine } from './setup';

/** The loudest sample between two times. */
function peak(buffer: AudioBuffer, from: number, to: number): number {
  const data = buffer.getChannelData(0);
  let most = 0;
  for (let i = Math.floor(from * SAMPLE_RATE); i < Math.min(data.length, to * SAMPLE_RATE); i++) {
    most = Math.max(most, Math.abs(data[i]!));
  }
  return most;
}

/** Calls stopAll at 0.5 s of the render (from a transport callback, at the event's time). */
function stopAt(engine: Engine, seconds: number, fade = 0.03): void {
  engine.transport.bpm = 120; // a beat is 0.5 s
  engine.transport.at(seconds / 0.5, () => void engine.stopAll({ fade }));
  engine.transport.start();
}

describe('engine.stopAll', () => {
  it('stops the transport: no step after it is played', async () => {
    const engine = await offlineEngine(1.5);
    engine.chain().sampler({ id: 'hit', buffer: click() }).to('main');
    const steps: number[] = [];
    engine.transport.sequence('beat', { steps: 4, step: '1/16' }, (ev) => {
      steps.push(ev.time);
      engine.select('#hit').trigger();
    });
    stopAt(engine, 0.5);
    const rendered = await engine.render();
    expect(steps.every((time) => time <= 0.5 + 1e-9)).toBe(true);
    expect(peak(rendered, 0.6, 1.5)).toBe(0);
    expect(engine.transport.state).toBe('stopped');
  });

  it('cuts a looping sample, and fades rather than clicks', async () => {
    const engine = await offlineEngine(1.5);
    engine
      .chain()
      .sampler({ id: 'loop', buffer: ones(0.1), loop: true })
      .to('main');
    engine.select('#loop').trigger({ at: 0 });
    stopAt(engine, 0.5, 0.05);
    const rendered = await engine.render();
    expect(peak(rendered, 0.3, 0.49)).toBeCloseTo(1, 3);
    // part-way through the fade: below full, above nothing
    const middle = peak(rendered, 0.524, 0.526);
    expect(middle).toBeGreaterThan(0.2);
    expect(middle).toBeLessThan(0.8);
    expect(peak(rendered, 0.56, 1.5)).toBe(0);
  });

  it('empties a delay and a reverb: no tail after the cut, and new sound is heard again', async () => {
    const engine = await offlineEngine(3.5);
    engine
      .chain()
      .sampler({ id: 'hit', buffer: click() })
      .delay({ time: 0.2, feedback: 0.9, mix: 1 })
      .reverb({ seconds: 2, mix: 1 })
      .to('main');
    engine.select('#hit').trigger({ at: 0.1 });
    engine.transport.bpm = 120;
    engine.transport.at(1, () => {
      engine.stopAll();
      // Played after the cut, once the reverb's old tail (2 s) has run out: heard, and with mix 1
      // only through the delay and the reverb, so their gates have opened again. (Asked for after
      // stopAll: a voice already scheduled for later is cut with the rest.)
      engine.select('#hit').trigger({ at: 2.7 });
    });
    engine.transport.start();
    const rendered = await engine.render();
    expect(peak(rendered, 0.2, 0.5)).toBeGreaterThan(0.001);
    expect(peak(rendered, 0.6, 2.6)).toBeLessThan(1e-6); // (a convolver leaves rounding dust)
    expect(peak(rendered, 2.7, 3.5)).toBeGreaterThan(0.001);
  });

  it('drops an envelope a scheduled note would open, and keeps a drone (an open gate) running', async () => {
    const engine = await offlineEngine(1.5);
    engine.chain().sine({ id: 'tone', frequency: 220 }).adsr({ id: 'env', sustain: 1 }).to('main');
    engine.select('#env').trigger({ at: 0 });
    engine.select('#env').trigger({ at: 0.8 }); // scheduled before, falls after the cut
    stopAt(engine, 0.5);
    const rendered = await engine.render();
    expect(peak(rendered, 0.3, 0.49)).toBeGreaterThan(0.5);
    expect(peak(rendered, 0.6, 1.5)).toBe(0);

    const drone = await offlineEngine(1.5);
    drone.chain().sine({ id: 'tone', frequency: 220 }).gain(0.5).to('main');
    stopAt(drone, 0.5);
    const kept = await drone.render();
    // out at the cut (0.53 s), and back once the output has faded in again
    expect(peak(kept, 0.529, 0.531)).toBeLessThan(0.02);
    expect(peak(kept, 0.6, 1.5)).toBeGreaterThan(0.4);
  });

  it('reaches inside macros and leaves settings as they were', async () => {
    const engine = await offlineEngine(1.5);
    engine.chain().polysynth({ id: 'keys', cutoff: 3000 }).to('main');
    engine.select('#keys').trigger({ pitch: 60, at: 0 });
    const level = engine.bus('main').gain.value;
    stopAt(engine, 0.5);
    const rendered = await engine.render();
    expect(peak(rendered, 0.2, 0.49)).toBeGreaterThan(0.01);
    expect(peak(rendered, 0.6, 1.5)).toBe(0);
    expect(engine.bus('main').gain.value).toBe(level);
    expect(engine.select('#keys').first()?.param('cutoff').value).toBe(3000);
  });
});
