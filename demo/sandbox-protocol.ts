import type { HostMessage, RemoteMessage, RemoteState } from '../src/remote';

/** What the page sends to the frame. */
export type ToFrame =
  | { kind: 'init'; state: RemoteState }
  | { kind: 'run'; code: string }
  | { kind: 'host'; message: HostMessage };

/** What the frame sends to the page. */
export type FromFrame =
  | { kind: 'ready' }
  | { kind: 'remote'; message: RemoteMessage }
  | { kind: 'result'; error: string | null; nodes: number };
