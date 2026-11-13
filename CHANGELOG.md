# Changelog

What changed in each release of cracked-up. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). How versions are chosen and released is
described in the README.

Write changes under "Unreleased" as you make them, grouped under Added, Changed, Fixed or Removed.
`npm version` turns that section into the new release's section.

## [Unreleased]

### Added

- **`cracked-up/editor`**: a code editor for an app to embed, built on CodeMirror 6.
  `createEditor({ parent, doc, catalog, onChange })` mounts into an element and returns `value`,
  `setValue`, `insert`, `setCatalog`, `setReadOnly`, `setTheme`, `showError`, `clearError`,
  `goToDefinition`, `focus` and `destroy`. Any number can be on one page.
- **Completion, hover and signature help** from a catalog of plain data, so the editor needs no
  engine and works the same beside a sandbox: node types and chain methods after a dot, parameter
  setters on selections, the keys and values of options objects (`.lowpass({`, `.trigger({`,
  `.set({`, sequence options), ids, classes and types inside selector strings, buffer, bus and
  sequence names, the members of `__` and the transport, and the helpers. `catalogFromEngine` and
  `catalogFromRemoteState` build a catalog; `createCatalogStore` shares one between editors.
- **Go to definition**: Cmd/Ctrl-click or F12 on a node type or helper. A type defined in the script
  is jumped to; otherwise a source panel shows its description, parameters and TypeScript source,
  with a link to MDN for wrappers of Web Audio nodes. `createSourcePanel` makes the panel on its
  own, and `onDefinition` hands the result to the host instead.
- `scripts/extract-sources.mjs` (`npm run sources`, run by `npm run build`) copies the source of
  every built-in node type and helper into `src/editor/sources.generated.ts`, which the editor
  loads on first use.
- `cracked-up/util` exports `HELPER_GROUPS`, `HELPER_DOCS`, `helpers` and `wrapUserCode`: every
  helper with its documentation, and by name for putting in scope of scripts. This list was in the
  demo before.
- The CodeMirror packages are optional peer dependencies. No other entry point imports them.
- **`cracked-up/inspect`.** A graph view for debugging: `createInspector(engine or scope, { parent })`
  draws a scope's nodes, buses and connections into an element you supply, and `openInspector` and
  `toggleInspector` open it in a sidebar or modal of their own. Signal runs left to right in a
  layered layout that copes with feedback loops and fan-out. Macros and child scopes open in place
  or on their own. Each output in view has a peak and RMS meter with a peak hold, connections move
  only while signal passes, and modulators show a value and range instead of decibels. Clicking a
  node shows its parameters with their metadata, a waveform, a spectrum, a bypass switch and a
  trigger button. The view follows `build()` and other changes without moving nodes that are kept.
  Levels are read through analysers that lead nowhere, attached only to what is on screen while
  audio runs; a test shows a render is sample for sample the same with them attached.
- **`node.insideScope`**: the private scope of a macro instance, or null for any other node.
  The sidebar has a "Full width" button (`wide`, `setWide`) that widens it to the whole page.
- **Demo**: `demo/inspect.html`, a patch with the inspector beside it, and a docs section,
  "Inspecting the graph".
- **Interaction helpers**, after Cracked's `key_press` and `mouse_movement`: `createInteraction()`
  in `cracked-up/util` gives `keyPress`, `keyRelease` and `mouseMovement` (the old names work too)
  and a `clear()` that removes every listener added through it. Callbacks get `{ key, code }` or
  `{ x, y }` (0 to 1 across the page or an element). Keys typed into a text box or editor are left
  out. The live demo offers them to scripts and replaces a run's listeners on the next run.
- **`midi.build(run)`** and **`midi.session()`**, for scripts that are re-run: a run's MIDI calls
  replace the last run's, and a `follow` or `sendClock` whose arguments have not changed is left
  running, so an edit does not restart the sync. Nothing changes if the run throws.
- The live demo offers `midi` to scripts, through `midi.session()`. The browser is asked for MIDI
  access the first time code uses the name.
- **Editor**: completion, hover and signature help for MIDI and the interaction helpers. A host
  names its midi object in the catalog (`globals: [{ name: 'midi', kind: 'midi' }]`) and lists the
  ports (`midiInputs`, `midiOutputs`); the editor then completes `midi.`, what `output()`,
  `follow()` and `bind()` return, the message a listener is given, port names, message kinds and
  the keys of each options object, and what `keyPress` and `mouseMovement` callbacks are given.
- **Docs**: an "Interaction" section, a reference of every sequencing and MIDI method, and groups
  in the contents list for sequencing, interaction, MIDI and each set of helpers, with a link per
  method.

### Changed

- The live demo and the sandboxed demo use `cracked-up/editor` in place of a text box. Clicking a
  sample, node type or helper in the demo's side column inserts it at the cursor.
- The docs page's contents list keeps its own scroll: reaching its end no longer scrolls the page.
- The sequencing guide shows how to change a playing pattern with `update`, `setStep` and
  `ev.sequence`, without giving the callback again.
- `npm run lint` also checks that `src/editor/sources.generated.ts` is up to date.

### Fixed

- Following MIDI clock: a MIDI Start that arrives while the transport is already playing now moves
  it to the beginning. Before, it was ignored, so a transport started by hand never lined up with
  the other device's bar.
- `follow.stop()` on an earlier follow no longer takes the tempo back from a later one.
- Following MIDI clock: a pulse that arrives before a transport started by hand has begun no longer
  throws ("Invalid duration").
- `build()`: a `set` or `ramp` the code makes after asking for a node now has the last word on a
  re-run as well. Before, a kept node went back to the value it is made with, so the same code gave
  one value the first time and another on every run after.

## [0.1.0] - 2026-11-12

The first numbered version. Everything is new; this lists what the library contains.

### Added

- **Engine and graph.** An engine built on an audio context you supply, live or offline, with no
  global state. Scopes with their own ids, buses, immutable selections with a CSS-style selector
  grammar, chains, and one shortcut setter per parameter name.
- **Parameters** with metadata (range, unit, curve, description), scheduled sets, ramps, temporary
  offsets and audio-rate modulation.
- **Transport.** Look-ahead scheduling with sequences, polyrhythm, swing, tempo changes, a loop
  region, `every` and `at`, and the same callbacks in offline renders. `__.transport` is the
  transport as one scope sees it.
- **Rebuilding in place.** `scope.build()` and `scope.apply()` keep unchanged nodes sounding, set
  changed values on them, and remove what is no longer asked for. `build()` undoes itself if the
  builder throws. `bypass` on any node.
- **Node types**: sources, filters, dynamics, delays, distortion, modulators, envelopes, a sampler
  with slices, `monosynth` and `polysynth`, a `bitcrusher` worklet, `recorder`, `looper`, `input`,
  and the effect macros `multiband` and `tapedelay`. `defineNode` and `defineMacro` for your own.
- **Recording.** Sample-exact recording into the buffer store, aligned stems from an offline
  render, a layered looper, and `encodeWav`.
- **`cracked-up/remote`.** The same scripting API for code in a sandboxed frame or Worker, driven
  by plain-data commands, including sequences and macros defined in the sandbox.
- **`cracked-up/midi`.** Devices, messages, controller binding and learn, timed output, and clock
  sync in both directions.
- **`cracked-up/util`.** The composing helpers from Cracked, pattern transforms, binary patterns,
  sieves, Euclidean rhythms, scales and chords, conversions, and seeded randomness.
- **Demo and docs** (`npm run demo`): a live-coding page, a sandboxed version of it, a guide with a
  node reference generated from the library, and a guide to running other people's scripts.

### Known limits

- Clock sync has not been measured against real MIDI hardware. Safari has no Web MIDI.
- Each trip round a feedback loop costs 128 samples in Chromium and WebKit, and none in Firefox.
- Live audio capture is tested only in Chromium.
