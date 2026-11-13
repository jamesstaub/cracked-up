/**
 * The inspector's stylesheet. It lives inside a shadow root, so it neither leaks into the host page
 * nor picks up the page's rules. A host can still restyle it: every colour reads a
 * `--cu-inspect-*` custom property first, and custom properties cross the shadow boundary.
 */
export const STYLES = /* css */ `
:host {
  color-scheme: light dark;
  display: block;
  min-width: 0;
  min-height: 0;
  --bg: var(--cu-inspect-bg, light-dark(#f6f5f1, #171716));
  --panel: var(--cu-inspect-panel, light-dark(#ffffff, #1f1f1d));
  --text: var(--cu-inspect-text, light-dark(#1d1d1b, #ecebe6));
  --muted: var(--cu-inspect-muted, light-dark(#6b6a65, #98968f));
  --border: var(--cu-inspect-border, light-dark(#d9d7cf, #34332f));
  --edge: var(--cu-inspect-edge, light-dark(#b9b6ab, #55534d));
  --accent: var(--cu-inspect-accent, light-dark(#b4530a, #f0a35e));
  --ok: var(--cu-inspect-level, light-dark(#2f7d4f, #7fd3a0));
  --clip: var(--cu-inspect-clip, light-dark(#c42b1c, #ff8a7a));
  --mod: var(--cu-inspect-modulation, light-dark(#8a3ea8, #cda8f2));
  --group: var(--cu-inspect-group, light-dark(rgba(29, 29, 27, 0.035), rgba(236, 235, 230, 0.04)));
}
:host([data-theme='light']) {
  color-scheme: light;
}
:host([data-theme='dark']) {
  color-scheme: dark;
}
* {
  box-sizing: border-box;
}
.root {
  container-type: inline-size;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: var(--bg);
  color: var(--text);
  font:
    13px/1.4 system-ui,
    -apple-system,
    'Segoe UI',
    sans-serif;
}
button {
  font: inherit;
  color: inherit;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 2px 9px;
  cursor: pointer;
}
button:hover {
  border-color: var(--accent);
}
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  min-width: 0;
}
.crumbs {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  font-size: 12px;
}
.crumbs button {
  border-color: transparent;
  background: none;
  padding: 2px 5px;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 0 1 auto;
}
.crumbs button[aria-current] {
  font-weight: 600;
  cursor: default;
}
.crumbs .sep {
  color: var(--muted);
}
.bar .tool {
  min-width: 28px;
  padding: 2px 7px;
  font-size: 12px;
}
.body {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  min-height: 0;
}
.body.with-detail {
  grid-template-rows: minmax(0, 1fr) minmax(0, 46%);
}
@container (min-width: 760px) {
  .body.with-detail {
    grid-template-columns: minmax(0, 1fr) 320px;
    grid-template-rows: minmax(0, 1fr);
  }
  .body.with-detail .detail {
    border-top: 0;
    border-left: 1px solid var(--border);
  }
}
.viewport {
  position: relative;
  overflow: hidden;
  min-height: 0;
  cursor: grab;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  background: var(--bg);
}
.viewport.panning {
  cursor: grabbing;
}
.world {
  position: absolute;
  left: 0;
  top: 0;
  width: 0;
  height: 0;
  transform-origin: 0 0;
}
.edges {
  position: absolute;
  left: 0;
  top: 0;
  width: 1px;
  height: 1px;
  overflow: visible;
  pointer-events: none;
}
.edges path {
  fill: none;
  stroke: var(--edge);
  stroke-width: 1.5;
}
.edges path.modulation {
  stroke: var(--mod);
  stroke-dasharray: 2 4;
  stroke-linecap: round;
  opacity: 0.75;
}
.edges path.route {
  stroke-width: 2;
}
.edges path.link {
  stroke-dasharray: 6 5;
}
.edges .head {
  fill: var(--edge);
  stroke: none;
}
.edges .head.modulation {
  fill: var(--mod);
}
.edges text {
  font:
    10px ui-monospace,
    'SF Mono',
    Menlo,
    Consolas,
    monospace;
  fill: var(--mod);
  stroke: var(--bg);
  stroke-width: 3px;
  paint-order: stroke;
}
canvas.live {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.node,
.group {
  position: absolute;
  left: 0;
  top: 0;
  cursor: pointer;
}
.node {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 2px 16px 2px 9px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-left: 3px solid var(--muted);
  border-radius: 6px;
  white-space: nowrap;
  animation: arrive 0.25s ease-out;
}
@keyframes arrive {
  from {
    opacity: 0;
  }
}
.node:hover,
.group:hover > .group-head {
  border-color: var(--accent);
}
.node .type,
.group .type {
  font-weight: 600;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.node .name,
.group .name {
  font:
    10.5px ui-monospace,
    'SF Mono',
    Menlo,
    Consolas,
    monospace;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
}
.node .name:empty {
  display: none;
}
/* The stripe on the left says what kind of thing a node is. */
.node.cat-source,
.node.cat-synth,
.node.cat-io {
  border-left-color: var(--accent);
}
.node.control {
  border-left-color: var(--mod);
}
.node.bus {
  border-radius: 999px;
  border-left-width: 1px;
  border-left-color: var(--border);
  padding: 0 20px 0 14px;
  align-items: flex-start;
}
.node.bus .type {
  font-weight: 500;
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 11.5px;
}
.node.bus.external {
  border-style: dashed;
  background: none;
}
.node.output {
  border-radius: 999px;
  border-left-width: 1px;
  border-left-color: var(--border);
  padding: 0;
  align-items: center;
  color: var(--muted);
  cursor: default;
}
.node.macro,
.node.scope {
  box-shadow: 3px 3px 0 -1px var(--panel), 3px 3px 0 0 var(--border);
  padding-left: 26px;
}
.node.scope {
  border-left-color: var(--border);
  border-left-width: 1px;
  border-style: dashed;
}
.node.bypassed {
  border-style: dashed;
  background: repeating-linear-gradient(
    -45deg,
    var(--panel),
    var(--panel) 5px,
    var(--bg) 5px,
    var(--bg) 10px
  );
}
.node.bypassed .type {
  text-decoration: line-through;
  color: var(--muted);
}
.node .flag {
  position: absolute;
  right: 14px;
  bottom: 4px;
  font-size: 8.5px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--muted);
}
/* The track of the meter. The level itself is painted on the canvas above. */
.node:not(.output):not(.scope)::after,
.group:not(.scope) > .group-head::after {
  content: '';
  position: absolute;
  right: 5px;
  top: 4px;
  bottom: 4px;
  width: 4px;
  border-radius: 1px;
  background: var(--border);
  opacity: 0.7;
}
.node.bus::after {
  right: 8px;
}
.node.selected,
.group.selected > .group-head {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent);
}
.node.macro.selected {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent);
}
.expand,
.enter {
  position: absolute;
  left: 4px;
  top: 50%;
  translate: 0 -50%;
  width: 18px;
  height: 18px;
  padding: 0;
  border-radius: 4px;
  font-size: 12px;
  line-height: 1;
  color: var(--muted);
  background: none;
}
.group {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--group);
  cursor: default;
}
.group.scope {
  border-style: dashed;
}
.group-head {
  position: absolute;
  left: -1px;
  top: -1px;
  right: -1px;
  height: 26px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 14px 0 26px;
  border: 1px solid var(--border);
  border-radius: 8px 8px 0 0;
  background: var(--panel);
  white-space: nowrap;
  cursor: pointer;
}
.group.scope > .group-head {
  border-style: dashed;
}
.group-head .enter {
  position: static;
  translate: none;
  margin-left: auto;
  flex: none;
  font-size: 11px;
}
.empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  text-align: center;
  color: var(--muted);
  pointer-events: none;
}
.empty[hidden] {
  display: none;
}
.status {
  display: flex;
  gap: 10px;
  padding: 4px 10px;
  border-top: 1px solid var(--border);
  color: var(--muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
}
.status .state.running {
  color: var(--ok);
}
.status .cost {
  margin-left: auto;
}

/* --- Detail panel ---------------------------------------------------------------------------- */
.detail {
  border-top: 1px solid var(--border);
  background: var(--panel);
  overflow: auto;
  padding: 10px 12px 14px;
  min-height: 0;
  font-size: 12px;
}
.detail[hidden] {
  display: none;
}
.detail header {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.detail h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.detail header .name {
  font:
    11.5px ui-monospace,
    'SF Mono',
    Menlo,
    Consolas,
    monospace;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.detail header .close {
  border-color: transparent;
  background: none;
  padding: 0 6px;
  font-size: 16px;
  line-height: 1.2;
}
.detail .desc {
  margin: 6px 0 8px;
  color: var(--muted);
  max-height: 5.6em;
  overflow: auto;
}
.detail .actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  margin: 8px 0;
}
.detail .actions:empty {
  display: none;
}
.detail .actions label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
}
.detail canvas.signal {
  display: block;
  width: 100%;
  height: 176px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
}
.detail .readout {
  margin: 4px 0 10px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 11px;
  min-height: 1.4em;
}
.detail h3 {
  margin: 12px 0 4px;
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
}
.detail table {
  border-collapse: collapse;
  width: 100%;
}
.detail td {
  vertical-align: top;
  padding: 3px 8px 3px 0;
  border-bottom: 1px solid var(--border);
}
.detail td.pname {
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 11.5px;
  white-space: nowrap;
}
.detail td.pvalue {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  font-weight: 600;
}
.detail td.pmeta {
  color: var(--muted);
  padding-right: 0;
}
.detail .mod {
  display: block;
  color: var(--mod);
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 11px;
}
.detail .links {
  margin: 0;
  color: var(--muted);
}
.detail .links span {
  color: var(--text);
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 11px;
}
.probe {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
  visibility: hidden;
}
@media (prefers-reduced-motion: reduce) {
  .node {
    animation: none;
  }
}

/* --- The ready-made window (openInspector) --------------------------------------------------- */
.window {
  position: fixed;
  z-index: 2147483000;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.25);
  font:
    13px/1.4 system-ui,
    -apple-system,
    'Segoe UI',
    sans-serif;
}
.window.sidebar {
  top: 0;
  right: 0;
  bottom: 0;
  width: min(var(--cu-inspect-width, 420px), 100vw);
  border-width: 0 0 0 1px;
}
.window.modal {
  inset: 5vh 5vw;
  border-radius: 10px;
  overflow: hidden;
}
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 2147482999;
  background: rgba(0, 0, 0, 0.35);
}
.window-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px 8px 12px;
  border-bottom: 1px solid var(--border);
}
.window-head h1 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  flex: 1;
}
.window-body {
  min-height: 0;
  display: grid;
}
`;
