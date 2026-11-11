import type { GraphError } from '../api';

/** The error type the library throws from direct calls and reports through `error` events. */
export class CrackedUpError extends Error implements GraphError {
  readonly code: GraphError['code'];
  readonly nodeId?: string;

  constructor(
    code: GraphError['code'],
    message: string,
    options: { nodeId?: string; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'CrackedUpError';
    this.code = code;
    if (options.nodeId !== undefined) this.nodeId = options.nodeId;
  }
}

/** Turns anything thrown into a CrackedUpError, keeping the original as the cause. */
export function toGraphError(thrown: unknown, fallback: GraphError['code']): CrackedUpError {
  if (thrown instanceof CrackedUpError) return thrown;
  const message = thrown instanceof Error ? thrown.message : String(thrown);
  return new CrackedUpError(fallback, message, { cause: thrown });
}

/** A minimal typed event emitter. Listener errors are reported to the console, never thrown to the emitter. */
export class Emitter<Events extends { [K in keyof Events]: (...args: never[]) => void }> {
  private listeners = new Map<keyof Events, Set<(...args: never[]) => void>>();

  on<E extends keyof Events>(event: E, listener: Events[E]): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  emit<E extends keyof Events>(event: E, ...args: Parameters<Events[E]>): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        (listener as (...a: Parameters<Events[E]>) => void)(...args);
      } catch (error) {
        console.error(`cracked-up: a "${String(event)}" listener threw`, error);
      }
    }
  }

  has(event: keyof Events): boolean {
    return (this.listeners.get(event)?.size ?? 0) > 0;
  }

  clear(): void {
    this.listeners.clear();
  }
}
