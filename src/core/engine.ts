import type {
  BuildContext,
  BufferSource,
  Engine,
  EngineEvents,
  EngineOptions,
  ParamValue,
  Random,
  RenderOptions,
  ScopeApi,
  Unsubscribe,
} from '../api';
import { builtinNodes } from '../nodes/builtin';
import { createRandom } from '../util/random';
import { processorSource } from '../worklets/processors';
import { BufferStoreImpl } from './buffers';
import type { BusImpl } from './bus';
import { ChainImpl } from './chain';
import { CrackedUpError, Emitter } from './errors';
import type { NodeImpl } from './node';
import { RegistryImpl } from './registry';
import type { RegistryEntry } from './registry';
import { ScopeImpl } from './scope';
import { SelectionImpl } from './selection';
import { TransportImpl } from './transport';
import type { TransportView } from './transport';

/** Fixed seed for offline engines, so a render repeats exactly unless the caller asks otherwise. */
const OFFLINE_SEED = 0x5eed;

/** One load of the processor module per audio context, shared by every engine built on it. */
const workletLoads = new WeakMap<BaseAudioContext, Promise<void>>();

function isOffline(context: BaseAudioContext): context is OfflineAudioContext {
  return typeof (context as OfflineAudioContext).startRendering === 'function';
}

export class EngineImpl {
  readonly context: BaseAudioContext;
  readonly offline: boolean;
  readonly random: Random;
  readonly buffersImpl: BufferStoreImpl;
  readonly registryImpl: RegistryImpl;
  readonly root: ScopeImpl;
  readonly transportImpl: TransportImpl;

  /** The engine's `main` bus. Null only while the root scope is creating it. */
  mainBus: BusImpl | null = null;

  /**
   * The time of the sequence event whose callback is running, or null outside one. Operations with no
   * explicit time use it, so code in a callback lands on the event without passing `at` around.
   */
  eventTime: number | null = null;

  private events = new Emitter<EngineEvents>();
  private disposed = false;
  private workletsLoaded = false;
  /** Why the worklet processors could not be loaded, if they could not. */
  private workletError: string | null = null;

  // Each engine has its own Selection and Chain classes, because their generated methods (one setter
  // per parameter name, one chain method per node type) depend on what is registered with that engine.
  private readonly Selection: typeof SelectionImpl;
  private readonly Chain: typeof ChainImpl;

  constructor(options: EngineOptions) {
    this.context = options.context;
    this.offline = isOffline(options.context);
    this.random = createRandom(options.seed ?? (this.offline ? OFFLINE_SEED : Date.now()));
    this.buffersImpl = new BufferStoreImpl(this.context);

    this.Selection = class EngineSelection extends SelectionImpl {};
    this.Chain = class EngineChain extends ChainImpl {};
    this.registryImpl = new RegistryImpl(
      (name) => name in ChainImpl.prototype,
      (entry) => this.addGeneratedMethods(entry),
    );
    for (const definition of builtinNodes) this.registryImpl.register(definition);
    for (const definition of options.nodes ?? []) this.registryImpl.register(definition);

    this.transportImpl = new TransportImpl(this);
    this.root = new ScopeImpl(this, 'root', null);
    this.mainBus = this.root.bus('main');

    if (!this.offline) {
      this.context.addEventListener('statechange', () => {
        this.events.emit('state', this.context.state);
      });
    }
  }

  private addGeneratedMethods(entry: RegistryEntry): void {
    const type = entry.type;
    Object.defineProperty(this.Chain.prototype, type, {
      configurable: true,
      writable: true,
      value(this: ChainImpl, init: unknown) {
        return this.add(type, init);
      },
    });
    for (const name of entry.params.keys()) {
      // A parameter that shares its name with a selection method (`release`) gets no setter.
      if (name in this.Selection.prototype) continue;
      Object.defineProperty(this.Selection.prototype, name, {
        configurable: true,
        writable: true,
        value(this: SelectionImpl, value: ParamValue, options?: { at?: number }) {
          return this.set({ [name]: value }, options);
        },
      });
    }
  }

  /**
   * Loads the library's AudioWorklet processors into this engine's context. From a blob URL by
   * default; from `url` when a content security policy forbids that.
   */
  async loadWorklets(url?: string | URL): Promise<void> {
    if (this.workletsLoaded) return;
    const worklet = this.context.audioWorklet;
    if (!worklet) {
      this.workletError = 'This browser has no AudioWorklet support, which this node type needs.';
      return;
    }
    // A processor name can be registered once per context, so share the load between engines on it.
    let loading = workletLoads.get(this.context);
    if (!loading) {
      const blobUrl =
        url === undefined
          ? URL.createObjectURL(new Blob([processorSource], { type: 'text/javascript' }))
          : null;
      loading = worklet.addModule(url ?? blobUrl!).finally(() => {
        if (blobUrl) URL.revokeObjectURL(blobUrl);
      });
      workletLoads.set(this.context, loading);
    }
    try {
      await loading;
      this.workletsLoaded = true;
    } catch (thrown) {
      const reason = thrown instanceof Error ? thrown.message : String(thrown);
      this.workletError =
        `The AudioWorklet processors could not be loaded (${reason}). If a content security policy ` +
        'blocks blob URLs, serve the source from `cracked-up/worklets` and pass its URL as `workletUrl`.';
    }
  }

  // --- Time ---------------------------------------------------------------------------------------

  now(): number {
    return this.context.currentTime;
  }

  /** The audio time an operation applies at: the given one, else the current event's, else now. */
  resolveAt(at: number | undefined): number {
    return at ?? this.eventTime ?? this.context.currentTime;
  }

  // --- Internal factories -------------------------------------------------------------------------

  createSelection(origin: ScopeImpl, nodes: readonly NodeImpl[]): SelectionImpl {
    return new this.Selection(this, origin, nodes);
  }

  createChain(scope: ScopeImpl, tail: readonly NodeImpl[], all: readonly NodeImpl[]): ChainImpl {
    return new this.Chain(this, scope, tail, all);
  }

  buildContext(node: NodeImpl): BuildContext {
    return {
      audio: this.context,
      random: () => this.random.float(),
      buffer: (source: BufferSource) => this.buffersImpl.resolve(source),
      value: (name: string, at: number) => {
        const param = node.findParam(name);
        if (!param) {
          throw new CrackedUpError('invalid-param', `${node.type} has no parameter "${name}".`);
        }
        return param.effectiveAt(at);
      },
      worklet: (name: string, options?: AudioWorkletNodeOptions) => {
        if (!this.workletsLoaded) {
          throw new CrackedUpError(
            'unsupported',
            this.workletError ??
              'AudioWorklet processors are not loaded yet. Create the engine with createEngine(), or wait for `ready`.',
          );
        }
        return new AudioWorkletNode(this.context, name, options);
      },
    };
  }

  report(error: CrackedUpError): void {
    if (this.events.has('error')) this.events.emit('error', error);
    else console.error(`cracked-up: ${error.message}`, error);
  }

  // --- Public surface -----------------------------------------------------------------------------

  get buffers(): BufferStoreImpl {
    return this.buffersImpl;
  }

  get registry(): RegistryImpl {
    return this.registryImpl;
  }

  /** The engine-wide view of the transport: no owner, and `clear()` removes everything. */
  get transport(): TransportView {
    return this.transportImpl.view(null);
  }

  get $(): ScopeApi {
    return this.root.$;
  }

  scope(name: string): ScopeImpl {
    return this.root.scope(name);
  }

  chain(): ChainImpl {
    return this.root.chain();
  }

  select(selector: string): SelectionImpl {
    return this.root.select(selector);
  }

  bus(name: string): BusImpl {
    return this.root.bus(name);
  }

  async resume(): Promise<void> {
    if (!this.offline) await (this.context as AudioContext).resume();
  }

  async render(options?: RenderOptions): Promise<AudioBuffer> {
    if (!isOffline(this.context)) {
      throw new CrackedUpError(
        'unsupported',
        'render() needs an engine built on an OfflineAudioContext.',
      );
    }
    // The context's length is fixed when it is made, so the whole of it renders; `options.length` is
    // reserved for limiting how much of that the transport fills.
    void options;
    // No real time passes offline: run every scheduled callback across the whole render first.
    this.transportImpl.runOffline(this.context.length / this.context.sampleRate);
    return this.context.startRendering();
  }

  on<E extends keyof EngineEvents>(event: E, listener: EngineEvents[E]): Unsubscribe {
    return this.events.on(event, listener);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.transportImpl.dispose();
    this.root.dispose();
    this.events.clear();
  }
}

/**
 * Creates an engine on the given audio context and loads the library's AudioWorklet processors into
 * it. If they cannot be loaded the engine still works; only the node types that need them fail, with
 * an error that says why.
 */
export async function createEngine(options: EngineOptions): Promise<Engine> {
  const engine = new EngineImpl(options);
  await engine.loadWorklets(options.workletUrl);
  return engine as unknown as Engine;
}
