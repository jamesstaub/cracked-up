import { describe, expect, it } from 'vitest';
import type { HostMessage, RemoteError, RemoteMessage } from '../../src';
import { createRemote, linkRemote } from '../../src/remote';
import type { LinkOptions, Remote } from '../../src/remote';
import { SAMPLE_RATE, makeBuffer, offlineEngine, ones, valueAt } from '../core/setup';

/** One second whose level says where you are in it: 0.05 in the first tenth, 0.15 in the second... */
const stairs = () => makeBuffer(1, (i) => Math.floor((i * 10) / SAMPLE_RATE) / 10 + 0.05);

/** A host scope and a remote wired to each other through `structuredClone`, as `postMessage` would. */
async function linked(seconds: number, allow?: LinkOptions['allow']) {
  const engine = await offlineEngine(seconds);
  engine.buffers.add('stairs', stairs());
  engine.buffers.add('ones', ones(0.5));
  await Promise.resolve();
  await Promise.resolve();
  const scope = engine.scope('script');
  const sent: RemoteMessage[] = [];
  const holder: { remote?: Remote } = {};
  const link = linkRemote(scope, {
    send: (message: HostMessage) => holder.remote?.receive(structuredClone(message)),
    ...(allow ? { allow } : {}),
  });
  const remote = createRemote({
    ...structuredClone(link.state()),
    send: (message) => {
      sent.push(message);
      link.receive(structuredClone(message));
    },
  });
  holder.remote = remote;
  const errors: RemoteError[] = [];
  remote.on('error', (error) => errors.push(error));
  return { engine, scope, link, remote, __: remote.__, sent, errors };
}

describe('remote: slices', () => {
  it('sets a buffer’s slices on the host and reads them back at once', async () => {
    const { engine, remote, __ } = await linked(0.5);
    remote.buffers.setSlices('stairs', [0.5, 0, 1]);
    expect(remote.buffers.get('stairs')?.slices).toEqual([0, 0.5, 1]);
    __().sampler({ id: 's', buffer: 'stairs' }).to('main');
    __('#s').trigger({ at: 0, slice: 1 });
    remote.flush();
    expect(engine.buffers.get('stairs')?.slices).toEqual([0, 0.5, 1]);
    expect(valueAt(await engine.render(), 0.05)).toBeCloseTo(0.55, 6);
  });

  it('hears of slices the host changes', async () => {
    const { engine, remote } = await linked(0.1);
    engine.buffers.get('stairs')!.slices = [0, 0.25, 1];
    expect(remote.buffers.get('stairs')?.slices).toEqual([0, 0.25, 1]);
  });

  it('can be refused by the host, which then says what the slices are when they next change', async () => {
    const { engine, remote } = await linked(0.1, (command) => command.op !== 'slices');
    remote.buffers.setSlices('stairs', [0, 0.5, 1]);
    remote.flush();
    expect(engine.buffers.get('stairs')?.slices).toEqual([0, 1]);
    engine.buffers.get('stairs')!.slices = [0, 0.75, 1];
    expect(remote.buffers.get('stairs')?.slices).toEqual([0, 0.75, 1]);
  });
});

describe('remote: play position', () => {
  it('is host-only: a remote node answers with nothing, the host node with the position', async () => {
    const { scope, remote, __ } = await linked(0.5);
    __().sampler({ id: 's', buffer: 'stairs' }).to('main');
    __('#s').trigger({ at: 0 });
    remote.flush();
    expect(__('#s').first()!.playheads(0.25)).toEqual([]);
    expect(scope.select('#s').first()!.playheads(0.25)).toEqual([0.25]);
  });
});

describe('remote: loop points', () => {
  it('are parameters like any other', async () => {
    const { engine, remote, __ } = await linked(0.5);
    __()
      .sampler({ id: 's', buffer: 'stairs', loop: true, loopStart: 0.2, loopEnd: 0.3 })
      .to('main');
    __('#s').trigger({ at: 0 });
    __('#s').set({ loopEnd: 0.3 });
    expect(__('#s').param('loopStart').value).toBe(0.2);
    remote.flush();
    const audio = await engine.render();
    expect(valueAt(audio, 0.05)).toBeCloseTo(0.05, 6);
    expect(valueAt(audio, 0.45)).toBeCloseTo(0.25, 6);
  });
});
