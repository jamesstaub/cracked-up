import { describe, expect, it } from 'vitest';
import type { GraphError } from '../../src';
import { offlineEngine } from './setup';

describe('a callback that throws', () => {
  it('reports where it was scheduled, to the scope and to the engine', async () => {
    const engine = await offlineEngine(1);
    const track = engine.scope('track');
    const other = engine.scope('other');
    const onEngine: GraphError[] = [];
    const onTrack: GraphError[] = [];
    const onOther: GraphError[] = [];
    engine.on('error', (error) => onEngine.push(error));
    track.on('error', (error) => onTrack.push(error));
    other.on('error', (error) => onOther.push(error));

    const kick = track.transport.sequence('kick', { steps: 'x', step: '1/4' }, (event) => {
      if (event.cycle === 0) throw new Error('kick broke');
    });
    track.transport.sequence({ steps: 'x', step: '1 bar' }, () => {
      throw new Error('unnamed broke');
    });
    track.transport.at('1/4', () => {
      throw new Error('at broke');
    });
    engine.transport.every('1 bar', () => {
      throw new Error('every broke');
    });
    engine.transport.bpm = 240; // a bar lasts a second: each of these fires once
    engine.transport.start();
    await engine.render();

    expect(onOther).toEqual([]);
    expect(onEngine.length).toBe(4);
    expect(onTrack.length).toBe(3);
    for (const error of onEngine) expect(error.code).toBe('callback');
    const brief = (error: GraphError) => [
      error.origin?.scope.name,
      error.origin?.kind,
      error.origin?.name,
      error.message,
    ];
    expect(onEngine.map(brief).sort()).toEqual(
      [
        ['track', 'sequence', 'kick', 'The sequence "kick" in scope "track" threw: kick broke'],
        ['track', 'sequence', null, 'A sequence in scope "track" threw: unnamed broke'],
        ['track', 'at', null, 'An at() callback in scope "track" threw: at broke'],
        ['root', 'every', null, 'An every() callback in scope "root" threw: every broke'],
      ].sort(),
    );
    const fromKick = onTrack.find((error) => error.origin?.name === 'kick')!;
    expect(fromKick.origin?.sequence).toBe(kick);
    expect(fromKick.origin?.scope).toBe(track);
    expect((fromKick.cause as Error).message).toBe('kick broke');
    expect(onEngine.find((error) => error.origin?.kind === 'every')?.origin?.sequence).toBeNull();
  });

  it('is called again at its next step, until the host mutes or cancels it', async () => {
    const engine = await offlineEngine(2);
    const scope = engine.scope('track');
    const calls: Record<string, number> = { loud: 0, muted: 0, every: 0, fine: 0 };
    const reported: string[] = [];
    scope.on('error', (error) => {
      reported.push(error.origin?.name ?? error.origin?.kind ?? '?');
      // The host's choice: silence one sequence, remove a repeating callback, leave the other.
      if (error.origin?.name === 'muted') error.origin.sequence!.muted = true;
      if (error.origin?.kind === 'every') error.origin.cancel();
    });
    const build = (broken: boolean) =>
      scope.build((__) => {
        for (const name of ['loud', 'muted', 'fine']) {
          __.transport.sequence(name, { steps: 'x', step: '1/4' }, () => {
            calls[name]! += 1;
            if (broken && name !== 'fine') throw new Error(`${name} broke`);
          });
        }
        __.transport.every('1/4', () => {
          calls['every']! += 1;
          if (broken) throw new Error('every broke');
        });
      });
    await build(true);
    engine.transport.bpm = 120; // four quarter notes in the two seconds rendered
    engine.transport.start();
    await engine.render();

    // Left alone, a throwing sequence is called, and reports, on every step. The rest carry on.
    expect(calls['loud']).toBe(4);
    expect(calls['fine']).toBe(4);
    expect(reported.filter((name) => name === 'loud').length).toBe(4);
    // Muted or cancelled from the error handler, it is not called again.
    expect(calls['muted']).toBe(1);
    expect(calls['every']).toBe(1);
    expect(reported.filter((name) => name === 'muted' || name === 'every').length).toBe(2);

    // A rebuild keeps a named sequence, and with it the mute: the host lifts it when it sees fit.
    const muted = scope.transport.get('muted')!;
    await build(false);
    expect(scope.transport.get('muted')).toBe(muted);
    expect(muted.muted).toBe(true);
    muted.muted = false;
    expect(scope.transport.sequences.map((sequence) => sequence.muted)).toEqual([
      false,
      false,
      false,
    ]);
  });
});
