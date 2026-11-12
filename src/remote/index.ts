/**
 * cracked-up/remote: run scripts away from the audio graph, in a sandboxed frame or a Worker.
 *
 * `createRemote` is for the sandbox and needs no Web Audio. `linkRemote` is for the host. Bundlers
 * drop whichever one a side does not import.
 */
export { createRemote } from './remote';
export { linkRemote } from './link';
export type {
  HostMessage,
  Link,
  LinkOptions,
  Remote,
  RemoteError,
  RemoteMessage,
  RemoteOptions,
  RemoteState,
  RemoteTransport,
  SequenceEventData,
  TransportSnapshot,
} from '../api';
