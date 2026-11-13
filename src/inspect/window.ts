/**
 * A ready-made place for the inspector: a sidebar or a modal with a title and a close button, for the
 * "click a button, see the graph" case. Apps with their own layout use `createInspector` directly.
 */

import type { Engine, Scope } from '../api';
import { createInspector } from './inspector';
import type { Inspector, InspectorOptions } from './inspector';
import { STYLES } from './styles';

export interface InspectorWindowOptions extends Omit<InspectorOptions, 'parent'> {
  /** `sidebar`: a panel down the right edge of the page. `modal`: a window over the page. Default `sidebar`. */
  mode?: 'sidebar' | 'modal';
  /** Where the window's element is added. Default `document.body`. */
  parent?: HTMLElement;
  /** The heading. Default "Graph". */
  title?: string;
  /** Sidebar width in pixels. Default 420. */
  width?: number;
  /** Called after the window has closed, however it was closed. */
  onClose?: () => void;
}

export interface InspectorWindow {
  readonly inspector: Inspector;
  /** The window's element. */
  readonly element: HTMLElement;
  readonly closed: boolean;
  /** Closes the window and destroys its inspector. */
  close(): void;
}

/**
 * Opens the inspector in a sidebar or modal of its own. Escape closes it (in a sidebar, while the
 * keyboard focus is inside it), as does its close button, and a click outside a modal.
 */
export function openInspector(
  target: Engine | Scope,
  options: InspectorWindowOptions = {},
): InspectorWindow {
  const { mode = 'sidebar', parent = document.body, title = 'Graph', width, onClose } = options;
  const before = document.activeElement;

  const element = document.createElement('div');
  element.className = 'cu-inspector-window';
  if (options.theme && options.theme !== 'auto') element.dataset['theme'] = options.theme;
  if (width !== undefined) element.style.setProperty('--cu-inspect-width', `${width}px`);
  const shadow = element.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = STYLES;

  const frame = document.createElement('div');
  frame.className = `window ${mode}`;
  frame.tabIndex = -1;
  frame.setAttribute('role', mode === 'modal' ? 'dialog' : 'complementary');
  frame.setAttribute('aria-label', title);
  if (mode === 'modal') frame.setAttribute('aria-modal', 'true');
  const head = document.createElement('div');
  head.className = 'window-head';
  const heading = document.createElement('h1');
  heading.textContent = title;
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'window-close';
  closeButton.textContent = 'Close';
  head.append(heading, closeButton);
  const body = document.createElement('div');
  body.className = 'window-body';
  frame.append(head, body);

  let backdrop: HTMLElement | null = null;
  if (mode === 'modal') {
    backdrop = document.createElement('div');
    backdrop.className = 'backdrop';
    shadow.append(style, backdrop, frame);
  } else {
    shadow.append(style, frame);
  }
  parent.append(element);

  const {
    parent: _parent,
    mode: _mode,
    title: _title,
    width: _width,
    onClose: _on,
    ...rest
  } = options;
  void [_parent, _mode, _title, _width, _on];
  const inspector = createInspector(target, { ...rest, parent: body });

  let closed = false;
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && !event.defaultPrevented) close();
  };
  const close = (): void => {
    if (closed) return;
    closed = true;
    keyTarget.removeEventListener('keydown', onKey as EventListener);
    inspector.destroy();
    element.remove();
    if (opened.get(target) === handle) opened.delete(target);
    if (before instanceof HTMLElement && before.isConnected) before.focus({ preventScroll: true });
    onClose?.();
  };
  // A modal owns the keyboard while it is up. A sidebar shares the page, so it only takes Escape
  // while the focus is inside it.
  const keyTarget: EventTarget = mode === 'modal' ? document : frame;
  keyTarget.addEventListener('keydown', onKey as EventListener);
  closeButton.addEventListener('click', close);
  backdrop?.addEventListener('click', close);
  frame.focus({ preventScroll: true });

  const handle: InspectorWindow = {
    inspector,
    element,
    get closed() {
      return closed;
    },
    close,
  };
  return handle;
}

/** The window `toggleInspector` opened for each engine or scope, while it is open. */
const opened = new WeakMap<object, InspectorWindow>();

/**
 * For a button: opens the inspector for `target`, or closes it if this function opened one for the
 * same target and it is still open. Returns the window, or null after closing.
 */
export function toggleInspector(
  target: Engine | Scope,
  options: InspectorWindowOptions = {},
): InspectorWindow | null {
  const existing = opened.get(target);
  if (existing && !existing.closed) {
    existing.close();
    return null;
  }
  const made = openInspector(target, options);
  opened.set(target, made);
  return made;
}
