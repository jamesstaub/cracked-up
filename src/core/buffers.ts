import type { BufferRef, BufferSource, BufferStore, Unsubscribe } from '../api';
import { CrackedUpError, Emitter } from './errors';

type BufferEvents = {
  ready: (ref: BufferRef) => void;
  error: (ref: BufferRef) => void;
};

class BufferRefImpl implements BufferRef {
  state: 'loading' | 'ready' | 'error' = 'loading';
  buffer: AudioBuffer | null = null;
  error: Error | null = null;
  readonly ready: Promise<AudioBuffer>;
  private customSlices: readonly number[] | null = null;

  constructor(
    readonly key: string,
    source: Promise<AudioBuffer>,
    events: Emitter<BufferEvents>,
  ) {
    this.ready = source.then(
      (buffer) => {
        this.buffer = buffer;
        this.state = 'ready';
        events.emit('ready', this);
        return buffer;
      },
      (thrown: unknown) => {
        const cause = thrown instanceof Error ? thrown : new Error(String(thrown));
        this.error = new CrackedUpError('buffer', `Could not load "${key}": ${cause.message}`, {
          cause,
        });
        this.state = 'error';
        events.emit('error', this);
        throw this.error;
      },
    );
    // A failed load is reported through the store's `error` event; nobody has to await `ready`.
    this.ready.catch(() => {});
  }

  get duration(): number | null {
    return this.buffer?.duration ?? null;
  }

  get slices(): readonly number[] {
    if (this.customSlices) return this.customSlices;
    return this.buffer ? [0, this.buffer.duration] : [];
  }

  set slices(boundaries: readonly number[]) {
    const sorted = [...boundaries].filter(Number.isFinite).sort((a, b) => a - b);
    this.customSlices = sorted.length >= 2 ? Object.freeze(sorted) : null;
  }
}

export class BufferStoreImpl implements BufferStore {
  private refs = new Map<string, BufferRefImpl>();
  private byBuffer = new WeakMap<AudioBuffer, BufferRefImpl>();
  private events = new Emitter<BufferEvents>();
  private anonymous = 0;

  constructor(private context: BaseAudioContext) {}

  load(url: string, options: { key?: string; signal?: AbortSignal } = {}): BufferRef {
    const key = options.key ?? url;
    const existing = this.refs.get(key);
    if (existing) return existing;
    const request = fetch(url, options.signal ? { signal: options.signal } : {}).then(
      async (response) => {
        if (!response.ok) throw new Error(`the server answered ${response.status}`);
        return this.context.decodeAudioData(await response.arrayBuffer());
      },
    );
    return this.store(key, request);
  }

  add(key: string, data: AudioBuffer | ArrayBuffer): BufferRef {
    const decoded =
      data instanceof ArrayBuffer ? this.context.decodeAudioData(data) : Promise.resolve(data);
    const ref = this.store(key, decoded);
    if (!(data instanceof ArrayBuffer)) {
      // Usable at once, without waiting for the promise to settle.
      ref.buffer = data;
      ref.state = 'ready';
      this.byBuffer.set(data, ref);
    }
    return ref;
  }

  get(key: string): BufferRef | undefined {
    return this.refs.get(key);
  }

  delete(key: string): boolean {
    return this.refs.delete(key);
  }

  on(event: 'ready' | 'error', listener: (ref: BufferRef) => void): Unsubscribe {
    return this.events.on(event, listener);
  }

  /** Turns anything a node accepts as a buffer into a store entry. */
  resolve(source: BufferSource): BufferRef {
    if (typeof source === 'string') return this.refs.get(source) ?? this.load(source);
    if (source instanceof BufferRefImpl) return source;
    if (source instanceof AudioBuffer) {
      return this.byBuffer.get(source) ?? this.add(`buffer-${this.anonymous++}`, source);
    }
    throw new CrackedUpError(
      'buffer',
      'A buffer must be a URL, a store key, an AudioBuffer or a BufferRef.',
    );
  }

  /** The store key for a value that is a buffer or buffer entry; null for anything else. */
  keyOf(value: unknown): string | null {
    if (value instanceof BufferRefImpl) return value.key;
    if (value instanceof AudioBuffer) return this.byBuffer.get(value)?.key ?? null;
    return null;
  }

  private store(key: string, source: Promise<AudioBuffer>): BufferRefImpl {
    const ref = new BufferRefImpl(key, source, this.events);
    this.refs.set(key, ref);
    return ref;
  }
}
