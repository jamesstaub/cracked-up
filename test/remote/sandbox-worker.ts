/**
 * The sandbox side of worker.test.ts, running in a real Worker: no DOM, no Web Audio, and every
 * message crossing a real `postMessage` boundary.
 */
import { createRemote } from '../../src/remote';
import type { HostMessage, Remote, RemoteState } from '../../src/remote';

type ToWorker = { init: RemoteState } | { host: HostMessage } | { run: string };

let remote: Remote | null = null;

const programs: Record<string, (remote: Remote) => void> = {
  build(r) {
    r.define({
      type: 'boost',
      params: {
        amount: { default: 0.5, min: 0, max: 4, drives: [{ select: '#g', param: 'gain' }] },
      },
      build(__) {
        __.bus('in').chain().gain({ id: 'g' }).to('out');
      },
      methods: {
        level(__, args) {
          __('#g').set({ gain: args['to'] as number });
        },
      },
    });
    r.build((__) => {
      const chain = __().sine({ id: 'osc', frequency: 220 }) as unknown as {
        boost(init: unknown): { to(bus: string): void };
      };
      chain.boost({ id: 'b', amount: 0.25 }).to('main');
      __.transport.sequence('s', { steps: 'x.' }, () => undefined);
    });
  },
  environment() {
    const scope = globalThis as Record<string, unknown>;
    postMessage({
      environment: {
        document: typeof scope['document'],
        AudioContext: typeof scope['AudioContext'],
        OfflineAudioContext: typeof scope['OfflineAudioContext'],
      },
    });
  },
};

addEventListener('message', (event: MessageEvent<ToWorker>) => {
  const data = event.data;
  if ('init' in data) {
    remote = createRemote({ ...data.init, send: (message) => postMessage({ remote: message }) });
    remote.on('error', (error) => postMessage({ error }));
    postMessage({ ready: true });
  } else if ('host' in data) remote?.receive(data.host);
  else if (remote) {
    programs[data.run]?.(remote);
    postMessage({ ran: data.run });
  }
});
