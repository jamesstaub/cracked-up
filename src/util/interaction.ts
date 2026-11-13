/**
 * Keyboard and pointer input for scripts: `keyPress`, `keyRelease` and `mouseMovement`, after the
 * "Interaction" functions of the original Cracked library (`key_press`, `mouse_movement`).
 *
 * Unlike the other helpers these listen to the page, so they are made per use with
 * `createInteraction()`, and `clear()` removes everything that was added through it. A host that
 * re-runs a script makes a new one for each run and clears the one before, so listeners do not pile up.
 */

export interface KeyInfo {
  /** What the key types: 'a', 'A', 'Enter', ' '. */
  readonly key: string;
  /** Which physical key: 'KeyA', 'Space'. The same whatever the keyboard layout or shift state. */
  readonly code: string;
  /** True for the repeats a held key sends. `keyPress` leaves these out unless asked. */
  readonly repeat: boolean;
  readonly event: KeyboardEvent;
}

export interface MouseInfo {
  /** 0 at the left edge of the page (or the target element), 1 at the right. */
  readonly x: number;
  /** 0 at the top, 1 at the bottom. */
  readonly y: number;
  readonly event: PointerEvent;
}

export interface KeyOptions {
  /** Also call back for the repeats a held key sends. Default false. */
  repeat?: boolean;
}

export interface InteractionOptions {
  /**
   * Call back for keys typed into a text box or editor as well. Default false, so that typing code
   * does not play the script being typed.
   */
  whileTyping?: boolean;
}

export interface Interaction {
  /** Calls back when a key goes down. Returns a function that stops it. */
  keyPress(callback: (key: KeyInfo) => void, options?: KeyOptions): () => void;
  /** Calls back when a key comes up. Returns a function that stops it. */
  keyRelease(callback: (key: KeyInfo) => void): () => void;
  /** Calls back when the mouse, a pen or a finger moves. Returns a function that stops it. */
  mouseMovement(callback: (mouse: MouseInfo) => void): () => void;
  /** Removes every listener added through this object. */
  clear(): void;
  /** The same functions by the names a script calls them, with Cracked's names too. */
  readonly helpers: Readonly<Record<string, unknown>>;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** True when the event started in something the user types text into. */
function typingInto(event: Event): boolean {
  const target = event.composedPath()[0] ?? event.target;
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/**
 * Keyboard and pointer input from the page, or from one element of it. With an element, key events
 * are heard while the focus is inside it, and `x` and `y` are measured across it.
 */
export function createInteraction(
  target: Document | HTMLElement = document,
  options: InteractionOptions = {},
): Interaction {
  const removers = new Set<() => void>();

  const listen = <E extends Event>(type: string, handler: (event: E) => void): (() => void) => {
    const listener = handler as EventListener;
    target.addEventListener(type, listener);
    const remove = (): void => {
      target.removeEventListener(type, listener);
      removers.delete(remove);
    };
    removers.add(remove);
    return remove;
  };

  const keys =
    (type: 'keydown' | 'keyup') =>
    (callback: (key: KeyInfo) => void, keyOptions: KeyOptions = {}): (() => void) =>
      listen<KeyboardEvent>(type, (event) => {
        if (event.repeat && keyOptions.repeat !== true) return;
        if (options.whileTyping !== true && typingInto(event)) return;
        callback({ key: event.key, code: event.code, repeat: event.repeat, event });
      });

  const keyPress = keys('keydown');
  const keyRelease = keys('keyup');

  const mouseMovement = (callback: (mouse: MouseInfo) => void): (() => void) =>
    listen<PointerEvent>('pointermove', (event) => {
      const box =
        target instanceof HTMLElement
          ? target.getBoundingClientRect()
          : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
      callback({
        x: box.width > 0 ? clamp01((event.clientX - box.left) / box.width) : 0,
        y: box.height > 0 ? clamp01((event.clientY - box.top) / box.height) : 0,
        event,
      });
    });

  return {
    keyPress,
    keyRelease,
    mouseMovement,
    clear() {
      for (const remove of [...removers]) remove();
    },
    helpers: {
      keyPress,
      keyRelease,
      mouseMovement,
      key_press: keyPress,
      mouse_movement: mouseMovement,
    },
  };
}

export interface InteractionDoc {
  name: string;
  signature: string;
  description: string;
  /** A short use of it. Unlike the other helpers' examples it has no result: it waits for input. */
  example: string;
  /** The name the original Cracked library used, when it had one. It works here too. */
  alias?: string;
}

/** Documentation for the interaction helpers, for editors, side columns and the docs page. */
export const INTERACTION_DOCS: readonly InteractionDoc[] = [
  {
    name: 'keyPress',
    signature: 'keyPress(callback, { repeat }?)',
    description:
      'Calls back each time a key goes down, with { key, code, repeat, event }. key is what it types and code is which physical key. A held key calls back once unless repeat is true. Keys typed into a text box or the editor are left out. Returns a function that stops it.',
    example: "keyPress(({ key }) => { if (key === 'a') __('#kick').trigger(); })",
    alias: 'key_press',
  },
  {
    name: 'keyRelease',
    signature: 'keyRelease(callback)',
    description:
      'Calls back each time a key comes up, with the same { key, code, event }. With keyPress it lets a key hold a note for as long as it is down. Returns a function that stops it.',
    example: "keyRelease(({ key }) => { if (key === 'a') __('#bass').release(); })",
  },
  {
    name: 'mouseMovement',
    signature: 'mouseMovement(callback)',
    description:
      'Calls back whenever the mouse (or a pen or finger) moves, with { x, y, event }. x runs from 0 at the left of the page to 1 at the right, and y from 0 at the top to 1 at the bottom. Returns a function that stops it.',
    example: "mouseMovement(({ x }) => __('#filter').set({ frequency: 200 + x * 4000 }))",
    alias: 'mouse_movement',
  },
];
