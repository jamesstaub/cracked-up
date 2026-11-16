# Changelog

What changed in each release of cracked-up. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). How versions are chosen and released is
described in the README.

Write changes under "Unreleased" as you make them, grouped under Added, Changed, Fixed or Removed.
`npm version` turns that section into the new release's section.

## [Unreleased]

### Added

- **`sequence.options` is as given, and cannot change the sequence.** A sequence's `options` are
  the options it was made with, not worked out: `{ steps: 16, step: '1/16' }` reads back with
  `steps` as 16, and an array or a pattern string reads back as that array or string, so a host or
  a script can tell how a sequence was declared. After `update` they are the merged options;
  `setStep` changes a value in `steps` and leaves `options.steps` as declared. The object is now a
  frozen copy, and an array of steps in it a frozen copy of the one given, so writing to either
  throws in strict code and changing the array you passed no longer reaches the sequence at its
  next `update`. A remote's sequences do the same.

- **`node.buffer`.** The buffer store entry a sampler plays (`key`, `duration`, `slices`,
  `buffer`), or null: what a host needs to give `start`, `end`, `loopStart` and `loopEnd` their
  real range, 0 to `node.buffer.duration`, in place of the nominal 0 to 60 seconds of their
  metadata. It follows `setOption('buffer', ...)`. On a remote's node it has the key, duration
  and slices. A node type of your own answers by returning `buffer()` from `build`.

- **Changing a sampler's sound without making a new node.** `setOption('buffer', key)` on a node
  or a selection points an existing sampler at another buffer (a store key, a URL, an
  `AudioBuffer` or a `BufferRef`, as at creation). Voices already sounding finish on the sound
  they started with; triggers at or after the change's time (`{ at }`, or the event's time in a
  sequence callback) play the new one; parameters keep their values. `start`, `end` and the loop
  points are not changed: an `end` past the new sound stops at its end, and a `start` at or past
  its end plays nothing until it is set lower. `describe()` reports the new buffer and the scope
  emits `option:changed`.
  - `build()` and `apply()` now keep a sampler whose `buffer` is the only creation option that
    changed, and change it in place: the node is in `updated`, not in `removed` and `added`, and
    what it was playing carries on. A `setOption` made at top level of a build after the node has
    the last word, as a `set` does, so a host's choice of sound survives re-runs of the script.
  - It is general: an option a node type can change in place is marked `live` in its
    `OptionInfo`, and its `build` returns a handler for it in `options`. Today only the
    sampler's `buffer` is.
  - As a command it is `{ op: 'option', target, at, name, value }`, which is what a remote's
    `setOption` sends; a host that filters commands in `allow` sees it.

- **Loop points on the sampler.** Two parameters, `loopStart` and `loopEnd`, in seconds of the
  buffer like `start` and `end`. With `loop` on, a voice plays from `start`, and on reaching
  `loopEnd` goes round from `loopStart` until it is released, when it stops (it does not play on
  to `end`). Reversed, it plays down from `end` and goes round between the same two points. The
  points are kept inside the region, and inside the slice for `trigger({ slice })`; a `loopEnd`
  at or before `loopStart`, which the defaults of 0 are, means the whole region repeats, so
  existing code sounds the same, sample for sample. Both can be given for one trigger.

- **Play position.** `node.playheads(at?, into?)` gives where each sounding voice of a sampler is
  in its buffer, in seconds, at an audio time (default now): for drawing a play cursor. It is
  worked out from what each voice was told (start time, region, speed and its changes, reverse,
  loop, and where it was stopped), so it costs a few additions per voice, allocates nothing when
  handed a list to fill, and can be asked for future times. Empty when nothing sounds and for
  other node types. Checked against offline renders of a sound whose samples hold their own time:
  within a tenth of a sample in Chromium and WebKit, speed changes included; Firefox filters
  sound played at a speed other than 1, which a render confirms only to 2 ms. A node type of
  your own answers by returning `playheads(at, into)` from `build`. Host only: a remote's nodes
  answer with nothing.

- **Slices as data a host edits.** `addSlice`, `moveSlice`, `removeSlice`, `normalizeSlices` and
  `sliceAt` in `cracked-up/util` take a list of boundaries and return a new one, sorted, without
  repeats and (given the duration) inside the sound: `ref.slices = addSlice(ref.slices, 1.5)`.
  `moveSlice` keeps a boundary between its neighbours, so a drag never changes the order or the
  count. The buffer store has a `slices` event, fired when an entry's boundaries are set to
  something different (`ready` already fires when its audio arrives or is replaced). Slices can
  be changed while samplers play: a trigger reads them when it is called, so voices started or
  scheduled keep their region and the next `trigger({ slice })` uses the new list. A sandboxed
  script sets them with `remote.buffers.setSlices(key, boundaries)`, which is the new `slices`
  command; a host can refuse it in `allow`. Slices stay on the store entry: `describe()` and
  `snapshot()` carry a sampler's buffer key, not the slices.

- **Onset detection and slice grids.** `detectOnsets(sound, { sensitivity, minGap, start, end })`
  in `cracked-up/util` gives the times where hits begin in an `AudioBuffer` or plain channel data:
  an energy detector over the whole signal and its high frequencies, with the time moved to the
  first sample that stands out. Deterministic. Tested on synthetic material: clicks to the sample,
  drum-like hits within 1 ms, 5 ms attacks within 5 ms, a hi-hat over a held bass note within
  12 ms, nothing in silence or in a sustained tone after its start.
  Three ways to make a buffer's slice boundaries, all returning a list for `ref.slices`:
  `sliceGrid(seconds, count, offset?)` (equal parts; it was a function of the demo page),
  `sliceByTempo(seconds, bpm, step?, offset?)` and `sliceByOnsets(sound, options?)`. All are
  helpers, so scripts and the editor's completion have them.

- **Waveform data for drawing.** `waveformPeaks(source, { buckets, start, end, channel, rms })` in
  `cracked-up/util` reduces an `AudioBuffer` (or plain channel arrays with a sample rate) to the
  lowest and highest sample, and optionally the RMS, of each of `buckets` equal parts of a time
  range, for one channel or the mix of all. It reads every sample in the range once.
  `createWaveformCache(source)` gives the same numbers from a multi-resolution cache in a time that
  depends on the number of buckets and not on the length: for five minutes of stereo at 48 kHz and
  1000 buckets, about 1 ms against 23 to 57 ms, after one pass of 30 to 56 ms to build it. Neither
  draws anything or needs a page.

- **The editor helps inside a host's own functions.** A catalog's new `functions` list describes a
  function an app puts in scope of scripts: its signatures, and for each argument a kind:
  `'selector'`, `'param'` (of the nodes another argument refers to), `'sequence'`, `'bus'`,
  `'buffer'`, `'name'`, `'options'` (keys, with values or a kind for each), `'list'` or `'value'`.
  The editor completes each argument accordingly, picks the signature that fits the arguments
  written (a string, an object or an array), shows it with the argument being typed, documents the
  function and its option keys on hover, and completes the members of what it returns, after the
  call or a variable declared with it. A parameter argument follows its target: what a selector
  matches, the nodes a chain in a variable made, a selection, or a bus (`gain`).
- **Catalog entries can say what they are.** `buses` and `sequences` take `{ name, description }`
  as well as a name, and `ids` take `{ name, type, description }`. Descriptions show in completion
  and on hover; an id's `type` gives the editor its parameters wherever a selector names it. Plain
  strings are still valid. `catalogFromScope(scope)` and `catalogFromSnapshot(snapshot)` read these
  names from a scope, and `catalogFromRemoteState` now lists them when the state has a snapshot.
- **Problems from the host in the editor.** `editor.setDiagnostics([{ line | from, severity,
  message, source? }])` underlines each place, colours its line number, and shows the message on
  hover and with F8 / Shift-F8. Problems follow their text through edits until the host replaces
  them with the next list or `clearDiagnostics()`. New theme properties `--cu-warning-text` and
  `--cu-info-text`. No new dependency.
- **Going to a place and knowing where the cursor is.** `editor.reveal({ line, column? } | { pos },
  { select, flash, focus, align })`, `editor.cursor`, and the `onCursor` option, which reports the
  user's cursor moves and not the host's.
- Hover in the editor now describes a parameter name in a string (`ramp('frequency', …)`), an id or
  node type inside a selector, and a chain's `.nodes` and a selection's `.filter('type')` narrow
  completion to the right node types.
- **Inserts on a bus.** Calling a node type on a bus puts that node inside the bus, in series
  between its mix and its output: `__.bus('drums').compressor({ id: 'glue', threshold: -18 })`.
  Everything sent to the bus passes through it, nothing goes round it, and the bus stays routed
  where it was, so the long form `bus.to(null).chain()....to('main')` is no longer needed to put
  an effect on a bus. Calls follow one another in signal order
  (`bus.overdrive(0.4).lowpass(900)`). What a call returns (`BusInserts`) has every node type as a
  method, `to()` (routes the bus), `chain()` (taps it), `bus` and `nodes`.
  - `bus.gain` stays the bus's level, a parameter, now applied after the inserts. `bus.insert()`
    returns the same `BusInserts` without adding anything, which is the way to a gain node:
    `bus.insert().gain(0.5)`. `bus.inserts` is a selection of the inserts in order, and
    `node.insertOf` is the bus a node is an insert on.
  - An insert is an ordinary node of the scope: selected, set, bypassed and disposed like any
    other. It needs an input and an output, and can only be added from the scope that owns the
    bus.
  - Outside `build()` each call adds another insert. Inside, a bus ends up with the inserts the
    build asked for, in order: unchanged ones are kept without touching the audio path, changed
    values are set in place, removed lines take their insert out, reordering re-patches, and a
    build that throws changes nothing.
  - As data: `GraphData.inserts` lists each bus's insert ids in order, so `describe()`, `apply()`,
    `snapshot()` and the remote's `apply` command carry them, and
    `{ op: 'bus', name, inserts: [ids] }` sets a bus's inserts from existing nodes. The same script
    text works through `cracked-up/remote`.
  - The inspector draws a bus's inserts in a row leading into the bus. The editor completes node
    types after `__.bus('x').`, documents them, and follows what an insert call returns.
- **Node types can be described without an engine.** `describeNodeTypes(definitions?)` and
  `describeNodeType(definition)` from `cracked-up` return what `engine.registry.list()` and
  `describe(type)` report, read from the definitions alone (the built-ins when given nothing). No
  audio context is made. `catalogFromNodes(definitions?, extra?)` in `cracked-up/editor` builds an
  editor catalog from them, for a page that shows an editor before any audio exists. The registry,
  `catalogFromEngine` and `remote.define` use the same function.
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
- `transport.sequences`: the named sequences of the scope whose view of the transport it is, in
  the order they were first made (`scope.transport.sequences`, `__.transport.sequences`). A host
  reads it after a `build()` to learn which sequences a script declares. Sequences made without a
  name, `every` and `at` are not listed.
- **Callback errors say where they came from.** A `callback` error has an `origin`: the `scope` it
  was scheduled in, its `kind` (`'sequence'`, `'every'` or `'at'`), the `sequence` and its `name`
  (null unless it is a sequence), and `cancel()`, which removes it from the transport. The error
  message names the sequence and the scope.
- `node.autoId` is in the public types: true when the node was made without an `id` and the
  library gave it one from its type and position.

### Changed

- **A rebuild keeps a sampler whose buffer changed.** `build()` and `apply()` used to replace a
  sampler when its `buffer` differed (it was in `removed` and `added`, and what it was playing
  was cut off). It is now kept and its buffer changed in place: it is in `updated`, voices that
  are sounding finish on the old sound, and the next trigger plays the new one. Any other
  creation option that changes (`choke`, `voices`) still replaces it.
- `waveformPeaks`, `createWaveformCache`, `detectOnsets` and the slice helpers are in `helpers`
  and `HELPER_GROUPS` (a new group, "Sounds and slices"), so scripts run with the helpers in
  scope have those names, and a script's own variable of the same name still wins.

- **`scope.build()` is all or nothing.** If the builder throws, or asks for anything that cannot
  be done, the promise rejects and nothing the builder asked for has happened. Before, only a
  throwing builder was undone, and only partly:
  - A bad value for a node being kept (`frequency: 'loud'` on a node that already exists) used to
    be found after everything else had been applied: that one value was skipped and listed in
    `result.errors`, and the promise resolved. Now the build is refused, the promise rejects with
    that error (it names the parameter and carries the node's id), and nothing is applied.
  - What the builder had already asked of nodes that were there before (`set`, a shortcut
    setter, `ramp`, `offset`, `trigger`, `bypass`, `disconnect`, `dispose`), a kept bus's `to()`
    and `gain`, and the tempo used to stay done when the builder then threw. Now none of it
    happens, and no `param:changed`, `node:added` or `node:removed` is emitted.
  - A sequence the builder replaced gets back its exact state on failure, steps changed with
    `setStep` and its mute included, as does anything removed with `stop()` or `clear()`.
  - To make this possible, what a builder asks of a node or bus that was there before the build
    is checked as it asks and carried out when the builder has returned, in the order asked and
    after kept nodes have taken the values they were declared with. Inside the builder,
    `param.value` and `node.bypass` of a kept node therefore still read the old value after
    being set. New nodes are made, set and connected at once, as before.
  - `param:changed` for a node the build adds is now emitted after that node's `node:added`.
  - `result.errors` from `build()` now holds only what a node's own code threw while a
    successful build was carried out (a `trigger`, `release` or method called on a kept node, a
    custom parameter handler). The rest of that build has been applied.
  - Not undone: starting, stopping or seeking the transport inside the builder, buffers loaded
    and node types registered there. A `tempo` listener hears a refused tempo, then the old one.
  - A build of another scope made inside a builder is part of the outer build: it is applied
    when the outer builder succeeds and not at all if it fails.
- `scope.apply()` still works node by node, and is now consistent about it: a node with a value
  that cannot be set is left exactly as it was and reported in `result.errors`. Before, the
  values listed ahead of the bad one were set and those after it were not.
- A `ramp` with a duration or `from` that is not a finite number, and an `offset` with such a
  duration, are refused with an `invalid-param` error that names the parameter, in place of the
  browser's own `TypeError`.
- **`remote.build()` is all or nothing too.** `set`, shortcut setters, `ramp`, `offset` and the
  values a node is created with are checked in the sandbox with the host's rules, in or out of a
  build: a value of the wrong kind now throws there, where it used to be sent and come back as
  an `error` event. A build's commands are sent as one message with a build number
  (`RemoteMessage.build`); the host applies all of them or none and answers with a new `built`
  message. When it refuses, the reasons arrive at `remote.on('error')` as before and the remote
  goes back to the nodes, sequences and callbacks it had before the build. Commands sent outside
  a build are applied one by one as before.
- An error thrown by a sequence, `every` or `at` callback is now also sent to the `error` event of
  the scope it was scheduled in, before the engine's. What happens next is unchanged and now
  documented: the callback is called again at its next step. A host that wants it quiet sets
  `error.origin.sequence.muted = true` (a rebuild keeps a named sequence and its mute) or calls
  `error.origin.cancel()`.
- `bus.chain()` taps the bus's output, which is now after its inserts as well as its level.
  `bus.input` is a mix node of its own in front of the inserts; `bus.output` is the same node as
  before.
- `apply()` now sets the inserts of the scope's buses: a description without `inserts` leaves
  them with none.
- `bus` and `chain` can no longer be node type names, as they are members of what an insert call
  returns.
- The live demo and the sandboxed demo use `cracked-up/editor` in place of a text box. Clicking a
  sample, node type or helper in the demo's side column inserts it at the cursor.
- The docs page's contents list keeps its own scroll: reaching its end no longer scrolls the page.
- The docs on buses open with a table of what a bus can do (`bus()`, `gain`, inserts, `insert()`,
  `chain()`, `to()`), and have a "Buses in practice" section: a shared reverb, parallel compression,
  groups inside groups, recording a group, and how to choose between an insert and a tap.
- The sequencing guide shows how to change a playing pattern with `update`, `setStep` and
  `ev.sequence`, without giving the callback again.
- `npm run lint` also checks that `src/editor/sources.generated.ts` is up to date.

### Fixed

- The level parameters of `looper` (`gain`, `monitor`, `overdub`) and of `input` (`gain`) had no
  unit in their metadata; they now say `gain`, like every other level. Values and behaviour are
  unchanged.

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
