import { describe, expect, it } from 'vitest';
import type { RemoteMessage } from '../../src';
import { linkRemote } from '../../src/remote';
import { offlineEngine } from '../core/setup';

type FromWorker = {
  ready?: true;
  ran?: string;
  remote?: RemoteMessage;
  error?: unknown;
  environment?: Record<string, string>;
};

/** Resolves with the next message from the worker that the test accepts. */
function next(worker: Worker, accept: (data: FromWorker) => boolean): Promise<FromWorker> {
  return new Promise((resolve) => {
    const listener = (event: MessageEvent<FromWorker>): void => {
      if (!accept(event.data)) return;
      worker.removeEventListener('message', listener);
      resolve(event.data);
    };
    worker.addEventListener('message', listener);
  });
}

describe('a remote in a real Worker', () => {
  it('builds a graph, defines a macro and answers a call across postMessage', async () => {
    const engine = await offlineEngine(0.1);
    const scope = engine.scope('guest');
    const worker = new Worker(new URL('./sandbox-worker.ts', import.meta.url), { type: 'module' });
    const errors: unknown[] = [];
    try {
      const link = linkRemote(scope, { send: (host) => worker.postMessage({ host }) });
      worker.addEventListener('message', (event: MessageEvent<FromWorker>) => {
        if (event.data.remote) link.receive(event.data.remote);
        if (event.data.error) errors.push(event.data.error);
      });

      const ready = next(worker, (data) => data.ready === true);
      worker.postMessage({ init: link.state() });
      await ready;

      const environment = next(worker, (data) => data.environment !== undefined);
      worker.postMessage({ run: 'environment' });
      expect((await environment).environment).toEqual({
        document: 'undefined',
        AudioContext: 'undefined',
        OfflineAudioContext: 'undefined',
      });

      const ran = next(worker, (data) => data.ran === 'build');
      worker.postMessage({ run: 'build' });
      await ran;
      expect(scope.select('*').nodes.map((node) => node.id)).toEqual(['osc', 'b']);
      expect(scope.select('#b > #g').param('gain').value).toBe(0.25);
      expect(scope.transport.get('s')).toBeDefined();

      // The host calls the macro's method; the worker runs it and its command comes back.
      const answered = next(worker, (data) => data.remote?.type === 'commands');
      scope.select('#b').call('level', { to: 0.9 });
      await answered;
      expect(scope.select('#b > #g').param('gain').value).toBe(0.9);
      expect(errors).toEqual([]);
    } finally {
      worker.terminate();
    }
  });
});
