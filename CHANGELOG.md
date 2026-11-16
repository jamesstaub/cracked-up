# Changelog

What changed in each release of cracked-up. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). How versions are chosen and released is
described in the README.

Write changes under "Unreleased" as you make them, grouped under Added, Changed, Fixed or Removed.
`npm version` turns that section into the new release's section.

## [Unreleased]

### Added

Buses and the graph:

- **Inserts on a bus.** Calling a node type on a bus puts that node inside the bus, in series
  between its mix and its level: `__.bus('drums').compressor({ id: 'glue', threshold: -18 })`. The
  bus stays routed where it was, and calls follow one another in signal order.
- What an insert call returns (`BusInserts`) has every node type as a method, `to()` (routes the
  bus), `chain()` (taps it), `bus` and `nodes`. An insert is an ordinary node of the scope; it needs
  an input and an output, and can only be added from the scope that owns the bus.
- `bus.insert()` returns the same `BusInserts` without adding anything, which is the way to a gain
  node, since `bus.gain` is the bus's level: `bus.insert().gain(0.5)`.
- `bus.inserts` is a selection of a bus's inserts in signal order, and `node.insertOf` is the bus a
  node is an insert on, or null.
- Inside `build()` a bus ends up with exactly the inserts the build asked for, in order, keeping
  the ones that did not change. Outside it each call adds another insert.
- Inserts as data: `GraphData.inserts` lists each bus's insert ids in order, so `describe()`,
  `apply()`, `snapshot()` and a remote carry them. The command
  `{ op: 'bus', name, inserts: [ids] }` sets a bus's inserts from existing nodes.
- **Node types can be described without an engine.** `describeNodeTypes(definitions?)` and
  `describeNodeType(definition)` from `cracked-up` return what `engine.registry.list()` and
  `describe(type)` report, read from the definitions alone. No audio context is made.
- `node.autoId` is in the public types: true when the node was made without an `id` and the
  library gave it one from its type and position.
- `node.insideScope`: the private scope of a macro instance, or null for any other node.

Parameters:

- **`set` with `glide`.** `param.set(value, { glide: 0.02 })` moves to the value in a straight line
  over that many seconds, starting from the value the parameter has reached. It is safe to repeat
  while the last move is in flight, which is how a fader is followed without clicks.
- `glide` is also taken by `selection.set`, the generated setters (`.gain(0.5, { glide })`),
  `setNormalized`, `reset`, the `set` command and a remote. A parameter that cannot be ramped is
  set at once, and a `glide` that is negative or not a number throws `invalid-param`.

Transport and sequences:

- **Step listeners.** `sequence.on('step', listener)` calls the listener with the event the
  sequence's callback gets, before the callback, for every step the sequence comes to: rests,
  steps `probability` drops and steps of a muted sequence included. It returns a function that
  stops it.
- `transport.on('step', listener)` does the same for every sequence of a scope, and
  `engine.transport.on('step', listener)` for those of every scope, with `ev.sequence` saying
  which. It runs after a sequence's own listeners and outlasts sequences that are stopped and
  declared again.
- Step listeners stay with a sequence through `update`, `setStep`, `restart`, a later declaration
  of the same name and a rebuild, and are released when it is stopped, cleared, left out of a
  rebuild or its scope disposed. In a sandbox both forms throw `unsupported`; the host listens with
  `scope.transport.get(name).on('step', listener)`.
- `transport.sequences`: the named sequences of the scope whose view of the transport it is, in the
  order they were first made. Sequences made without a name, `every` and `at` are not listed.
- **Callback errors say where they came from.** A `callback` error has an `origin`: the `scope`,
  the `kind` (`'sequence'`, `'every'`, `'at'` or `'listener'`), the `sequence` and its `name`, and
  `cancel()`, which removes the sequence or repeating callback, or for a step listener only that
  listener. The error message names the sequence and the scope.

The sampler:

- **Loop points.** Two parameters, `loopStart` and `loopEnd`, in seconds of the buffer. With `loop`
  on, a voice plays from `start` and goes round between the two points until it is released; a
  `loopEnd` at or before `loopStart`, which is the default, repeats the whole region as before.
- **Changing a sampler's sound without making a new node.** `setOption('buffer', key)` on a node or
  a selection points a sampler at another buffer. Voices already sounding finish on the old sound,
  and triggers from the change's time on play the new one.
- Live options in general: an option a node type can change in place is marked `live` in its
  `OptionInfo`, and its `build` returns a handler for it in `options`. The change is the command
  `{ op: 'option', target, at, name, value }`, and the scope emits `option:changed`.
- `node.buffer`: the buffer store entry a sampler plays (`key`, `duration`, `slices`, `buffer`), or
  null. Its `duration` is the real range of `start`, `end`, `loopStart` and `loopEnd`.
- **Play position.** `node.playheads(at?, into?)` gives where each sounding voice of a sampler is
  in its buffer, in seconds, at an audio time, for drawing a play cursor. It is worked out from
  what each voice was told, and a remote's nodes answer with nothing.
- **Slices as data.** `addSlice`, `moveSlice`, `removeSlice`, `normalizeSlices` and `sliceAt` in
  `cracked-up/util` take a list of boundaries and return a new one, sorted and without repeats.
  `moveSlice` keeps a boundary between its neighbours.
- The buffer store has a `slices` event, fired when an entry's boundaries are set to something
  different. A sandboxed script sets them with `remote.buffers.setSlices(key, boundaries)`, which
  is the new `slices` command.
- **Slice grids and onsets.** `sliceGrid(seconds, count, offset?)`,
  `sliceByTempo(seconds, bpm, step?, offset?)` and `sliceByOnsets(sound, options?)` make a list of
  boundaries for `ref.slices`. `detectOnsets(sound, { sensitivity, minGap, start, end })` gives
  the times where hits begin.
- **Waveform data for drawing.** `waveformPeaks(source, { buckets, start, end, channel, rms })`
  gives the lowest and highest sample, and optionally the RMS, of each of `buckets` parts of a time
  range. `createWaveformCache(source)` gives the same numbers in a time that does not grow with the
  length of the sound.
- All of these are in `helpers` and `HELPER_GROUPS`, in a new group, "Sounds and slices", so
  scripts and the editor's completion have them.

The editor:

- **`cracked-up/editor`**: a code editor for an app to embed, built on CodeMirror 6.
  `createEditor({ parent, doc, catalog, onChange })` mounts into an element; any number can be on
  one page.
- **Completion, hover and signature help** from a catalog of plain data, so the editor needs no
  engine and works the same beside a sandbox. `catalogFromEngine` and `catalogFromRemoteState`
  build a catalog, and `createCatalogStore` shares one between editors.
- `catalogFromNodes(definitions?, extra?)` builds a catalog from node definitions alone, for a page
  that shows an editor before any audio exists.
- **Go to definition**: Cmd/Ctrl-click or F12 on a node type or helper jumps to a type the script
  defines, or opens a source panel with its description, parameters and TypeScript source.
  `createSourcePanel` makes the panel on its own, and `onDefinition` hands the result to the host.
- **Functions of the host's own.** A catalog's `functions` list describes a function an app puts
  in scope of scripts: its signatures, and for each argument a kind (`'selector'`, `'param'`,
  `'sequence'`, `'bus'`, `'buffer'`, `'name'`, `'options'`, `'list'` or `'value'`). The editor
  completes each argument accordingly, shows the signature that fits, and completes the members of
  what the function returns.
- **Catalog entries can say what they are.** `buses` and `sequences` take `{ name, description }`
  as well as a name, and `ids` take `{ name, type, description }`, where the type gives the editor
  the parameters of that node. `catalogFromScope(scope)` and `catalogFromSnapshot(snapshot)` read
  these names from a scope, and `catalogFromRemoteState` lists them when the state has a snapshot.
- **Problems from the host.** `editor.setDiagnostics([{ line | from, severity, message, source? }])`
  underlines each place and shows the message on hover and with F8 / Shift-F8;
  `clearDiagnostics()` removes them and `editor.diagnostics` is the list as it stands. New theme
  properties `--cu-warning-text` and `--cu-info-text`.
- **Going to a place and knowing where the cursor is.** `editor.reveal({ line, column? } | { pos },
  { select, flash, focus, align })`, `editor.cursor`, and the `onCursor` option, which reports the
  user's cursor moves and not the host's.
- The editor completes node types after `__.bus('x').` and follows what an insert call returns,
  offers `glide` among the options of `set`, and describes on hover a parameter name in a string,
  and an id or node type inside a selector.
- Completion, hover and signature help for MIDI and the interaction helpers. A host names its midi
  object in the catalog (`globals: [{ name: 'midi', kind: 'midi' }]`) and lists the ports
  (`midiInputs`, `midiOutputs`).
- `cracked-up/util` exports `HELPER_GROUPS`, `HELPER_DOCS`, `helpers` and `wrapUserCode`: every
  helper with its documentation, and by name for putting in scope of scripts.
- `scripts/extract-sources.mjs` (`npm run sources`, run by `npm run build`) copies the source of
  every built-in node type and helper into `src/editor/sources.generated.ts`, which the editor
  loads on first use.
- The CodeMirror packages are optional peer dependencies. No other entry point imports them.

The inspector, interaction and MIDI:

- **`cracked-up/inspect`.** A graph view for debugging: `createInspector(engine or scope,
  { parent })` draws a scope's nodes, buses, inserts and connections into an element you supply,
  with a meter on each output and the details of any node. `openInspector` and `toggleInspector`
  open it in a sidebar or modal of their own, which a "Full width" button (`wide`, `setWide`)
  widens to the whole page.
- **Interaction helpers**, after Cracked's `key_press` and `mouse_movement`: `createInteraction()`
  in `cracked-up/util` gives `keyPress`, `keyRelease` and `mouseMovement`, and a `clear()` that
  removes every listener added through it. Keys typed into a text box or editor are left out.
- **`midi.build(run)`** and **`midi.session()`**, for scripts that are re-run: a run's MIDI calls
  replace the last run's, and a `follow` or `sendClock` whose arguments have not changed is left
  running. Nothing changes if the run throws.

Demo and docs:

- `demo/inspect.html`, a patch with the inspector beside it. The live demo offers `midi` and the
  interaction helpers to scripts.
- A guide section on macros, with a simple and a larger example and a reference of the definition.
  The live demo gives scripts `define`, as the sandboxed demo does, so the examples run there.
- Docs sections for everything above, a reference of every sequencing, interaction and MIDI
  method, and a contents list that links to each part of a section and to every method, helper and
  node type.

### Changed

- **`scope.build()` is all or nothing.** If the builder throws, or asks for anything that cannot
  be done, the promise rejects and nothing the builder asked for has happened: nodes, values,
  connections, buses, sequences and tempo are as they were, and no event is emitted. Before, only
  a throwing builder was undone, and only partly.
- A bad value for a node being kept (`frequency: 'loud'`) now refuses the build with an error that
  names the parameter and carries the node's id. Before, that one value was skipped and listed in
  `result.errors`.
- `result.errors` from `build()` now holds only what a node's own code threw while a successful
  build was carried out (a `trigger`, `release` or method on a kept node, a custom parameter
  handler).
- Inside a builder, what is asked of a node or bus that was there before the build is checked as
  it is asked and carried out when the builder has returned, in the order asked. So `param.value`
  and `node.bypass` of a kept node still read the old value there.
- A build that fails gives a replaced sequence back its exact state, with its steps, mute and step
  listeners. Not undone: starting, stopping or seeking the transport inside the builder, buffers
  loaded and node types registered there.
- A build of another scope made inside a builder is part of the outer build. `param:changed` for
  a node a build adds is now emitted after that node's `node:added`.
- `scope.apply()` still works node by node, and is now consistent about it: a node with a value
  that cannot be set is left exactly as it was and reported in `result.errors`.
- **`remote.build()` is all or nothing too.** A build's commands are sent as one message with a
  build number (`RemoteMessage.build`); the host applies all of them or none and answers with a
  new `built` message, and on a refusal the remote goes back to what it held before.
- A remote checks `set`, shortcut setters, `ramp`, `offset` and creation values in the sandbox
  with the host's rules: a value of the wrong kind now throws there, where it used to come back as
  an `error` event.
- A `ramp` with a duration or `from` that is not a finite number, and an `offset` with such a
  duration, are refused with an `invalid-param` error in place of the browser's own `TypeError`.
- An error thrown by a sequence, `every` or `at` callback is now also sent to the `error` event of
  the scope it was scheduled in, before the engine's. The callback is still called again at its
  next step.
- **`sequence.options` is as given, and read-only.** `{ steps: 16 }` reads back with `steps` as 16,
  and an array or a pattern string as that array or string; after `update` they are the merged
  options, and `setStep` leaves them alone. The object is a frozen copy, an array of steps in it
  included, so changing the array you passed no longer reaches the sequence.
- **A rebuild keeps a sampler whose buffer changed.** `build()` and `apply()` used to replace a
  sampler when its `buffer` differed; it is now kept, in `updated`, and its buffer changed in
  place. Any other creation option that changes (`choke`, `voices`) still replaces it.
- `bus.chain()` taps the bus's output, which is now after its inserts as well as its level.
  `bus.input` is a mix node of its own in front of the inserts.
- `apply()` now sets the inserts of the scope's buses: a description without `inserts` leaves them
  with none.
- `bus` and `chain` can no longer be node type names, as they are members of what an insert call
  returns.
- The live demo and the sandboxed demo use `cracked-up/editor` in place of a text box. The docs
  page's contents list keeps its own scroll.
- `npm run lint` also checks that `src/editor/sources.generated.ts` is up to date.

### Fixed

- **`ramp` during a ramp.** `ramp` without `from` starts from the value the parameter has at `at`,
  as its documentation said, and the ramp that was in flight stops there. It used to jump to the
  earlier ramp's target first.
- **`set` during a ramp** stops the ramp, and the value stays where it was set. Before, the value
  stepped and then carried on ramping to the old target.
- `build()`: a `set` or `ramp` the code makes after asking for a node now has the last word on a
  re-run as well. Before, a kept node went back to the value it is made with on every run after
  the first.
- The level parameters of `looper` (`gain`, `monitor`, `overdub`) and of `input` (`gain`) had no
  unit in their metadata; they now say `gain`.
- Following MIDI clock: a MIDI Start that arrives while the transport is already playing now moves
  it to the beginning.
- `follow.stop()` on an earlier follow no longer takes the tempo back from a later one.
- Following MIDI clock: a pulse that arrives before a transport started by hand has begun no longer
  throws ("Invalid duration").

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
