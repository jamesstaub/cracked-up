# API design (Phase 0)

Status: approved by the owner on 2026-11-11 with the decisions below. The declarations now live in `src/api/` as the library's real types. `cracked-up/remote` is implemented in `src/remote/`.

This folder is the proposed public API for Phases 1 and 2 of cracked-up (graph core and transport), written as TypeScript declarations, plus example programs that are type-checked against it. The plan it belongs to is in the Euclip repo: `docs/plans/cracked-up-and-euclip-v2.md`.

After Phase 2 a throwaway host prototype is built against the real thing, and one revision of this API is expected then.

## What to read

Start with the examples; they show how the API feels in use.

| File | Shows |
|---|---|
| `examples/live-coding.ts` | A live coder using `__` and the transport: named sequences, pattern strings, a polyrhythm, swing, a ratchet |
| `examples/host-with-tracks.ts` | A host with tracks: one scope per track, controls from metadata, adding an effect by editing graph data, sandboxed-script commands |
| `examples/offline-test.ts` | Rendering offline and asserting on the audio |
| `examples/type-safety.ts` | Mistakes the types reject |
| `examples/custom-macro.ts` | A macro with its own method, called directly and as a command |

Then the declarations:

| File | Covers |
|---|---|
| `src/api/engine.ts` | `createEngine`, the buffer store, seeded random, offline `render` |
| `src/api/graph.ts` | Nodes, selections and the selector grammar, chains, buses, scopes, the graph as data, commands |
| `src/api/params.ts` | `Param`: base value, ramps, temporary offsets, modulators, metadata |
| `src/api/nodes.ts` | The node type map, `defineNode`, `defineMacro`, the registry |
| `src/api/transport.ts` | Transport, sequences, the event object, durations |
| `src/global/index.ts` | The `cracked-up/global` entry point for live coding |
| `src/api/remote.ts` | The `cracked-up/remote` entry point: the same scripting API inside a sandbox |

`npm run typecheck` checks everything here.

## What is implemented

| Area | State |
|---|---|
| Engine, scopes, buses, selections, chains, shortcut setters | Done |
| Selector grammar | Done |
| Parameters: base values, scheduled sets, ramps, offsets, modulation, metadata, change events | Done |
| Transport: sequences, polyrhythm, swing, tempo changes, loop region, live and offline scheduling | Done. `onDisplay` and the Worker timer are exercised only through the demo, not by automated tests |
| Buffer store, slices | Done |
| Macros: `defineMacro`, private inner scope with `in` and `out` buses, exposed parameters, methods, nesting | Done |
| `cracked-up/global` | Done |
| Commands | Done. `sequence` needs a link (its callback lives in the sandbox), so plain `dispatch` reports it as `unsupported`. A `bus` command cannot change a bus of an outer scope |
| `cracked-up/remote` | `createRemote` (sandbox side, no Web Audio) and `linkRemote` (host side) done: chains, selections, shortcut setters, parameters, buses, `build`, named sequences with callbacks in the sandbox, tempo, errors sent back, host changes mirrored. `demo/sandbox.html` runs it in a frame with an opaque origin. Also `remote.define` (macros written in the sandbox: the inner graph travels as data, and `trigger`, `release` and methods run in the sandbox when the host calls them, nested instances included), `every`, `at`, unnamed sequences, `restart`, and buffer durations and slices. Tested through `structuredClone` on every message, in a real Worker, and against malformed input. Not mirrored: the internals of macros registered on the host (they can be written to, not read) and connections changed on the host |
| `describe()`, `snapshot()` | Done. Connections that cross scopes are not described yet |
| `build()`, `apply()` | Done. Both reconcile: unchanged nodes are kept and keep sounding, changed values are set in place, a node is replaced only if its type or creation options changed. `build()` also reconciles sequences and the buses earlier builds made, and leaves the scope as it was if the builder throws |
| `bypass` | Done. A short crossfade between the node and a path around it; a bypassed source is silent |
| Docs | `demo/docs.html`: a guide, plus a node reference generated from the definitions' metadata. Tests fail if a built-in type, parameter or option lacks a description, or if a type's generated example does not run |
| Recording | `recorder` (sample-exact, into the buffer store; recorders triggered together line up, which gives stems), `looper` (layers, undo, clear, latency shift, an `overdub` level of 0.7 for layers after the first; a worklet, so it works offline and never drifts from the audio clock), `input` (microphone, or a stream the host supplies), `encodeWav` in `cracked-up/util`. Either captures any signal: chain into it, or send chains to a bus and continue from the bus (`bus.to(null)` makes the chain the bus's only way out). Both worklets are controlled through audio-rate parameters used as gates, not messages, so timing is exact and offline renders work. Live capture is tested only in Chromium (a pretend microphone); the rest is tested offline in all three browsers. Not done: a compressed long-take mode (`MediaRecorder`), measuring memory on long takes, automatic latency detection |
| Helpers (`cracked-up/util`) | Every composing helper from Cracked's `algorithmic` and `utilities` plugins has an equivalent: `euclid`, `fillArray`, `arrayNext`, `everyNth`, `holdSteps`, `scales`, `chords`, `randomScale`, `randomArpeggio`, `randomInt`, `randomFloat`, `chance`, `pick`, `shuffle`, `randomEnvelope`, `scale`, `clamp`, and the pitch, gain and time conversions. The Cracked names (`fill_array`, `pitch2freq`, `random`, ...) are exported as aliases. Helpers that make a random choice take an optional last argument, a `Random` or a function, so a seeded source makes them repeat; without one they use `Math.random`. Beyond Cracked, there are helpers that take a pattern (a list or a string such as `'x..x'`) and return a new list: transforms (`rotate`, in the same direction as `euclid`'s rotate, `reverse`, `invert`, `stretch`, `spread`, `palindrome`, `repeat`), combinations (`and`, `or`, `xor`, which repeat patterns of different lengths until they line up, `interleave`, `concat`), Euclip's `binaryPattern` and `onOffPattern` with `binaryToNumber`, Xenakis-style `sieve(length?, [modulus, offset], ...)`, and `indexes`, `countHits` and `patternToString` for reading a pattern. No helper builds more than 4096 steps. `src/util/helper-docs.ts` is the one list the editor's completion, the two demos, the demo's side column and the docs reference are built from (`cracked-up/util` exports it as `HELPER_GROUPS` and `helpers`), and a test runs every documented example. Not ported: `random_interval` and `sequence` (wall-clock timers; use the transport), `mouse_movement`, `key_press` and the `is*` type checks |
| Effect macros | `multiband`: a three-band compressor. A 4th-order Linkwitz-Riley crossover (two Butterworth filters per slope, an allpass on the low band) that adds back up flat, measured within 0.02 dB from 30 Hz to 18 kHz in all three browsers; one `compressor` per band with the browser's automatic make-up gain taken out (`makeup: false`), so a band's threshold does not change its level; `mix` blends in the original through the same phase shift and delay, so it does not comb. `tapedelay`: a feedback loop through `delayline` with saturation, a highpass and a lowpass in it, two lfos on the delay time for wow and flutter, a glide on changes of `time`, feedback up to 1.1 that the saturation keeps bounded, and `freeze` / `unfreeze`, which catch one trip round the loop in a `looper`. Both are built only from other node types. Added for them: `delayline` (a delay and nothing else; a loop through `delay` has a path round the delay, which Firefox silences), `oversample` on `waveshaper`, `makeup` on `compressor`. The glide on `time` runs through `smooth` (a critically damped lowpass made from the browser's double-precision IIR filter) and not a `lowpass`: the browser's biquad is inexact at very low frequencies in Chromium and WebKit off macOS (a steady 1 through 4 Hz comes out as 1.22), which left the delay time 13% out after a change; found by the first run on GitHub's Linux machines. Known differences between browsers: Chromium and WebKit add 128 samples to each trip round the tape loop and Firefox adds none; Firefox's compressor turns high frequencies down further than the others (7 dB more at 6 kHz for the same settings), so the high band is squashed harder there. No tempo-synced `time`: a macro cannot follow the tempo, so pass `__.transport.seconds('1/8d')` |
| Editor (`cracked-up/editor`) | `createEditor` (CodeMirror 6, mounted into a host's element; any number per page), `createSourcePanel`, `createCatalogStore`, `catalogFromEngine`, `catalogFromRemoteState`. Completion, hover and signature help come from a catalog of plain data (node types, helpers, buffers, and ids, classes, buses and sequences from the host) plus what the document itself defines, read from CodeMirror's syntax tree: after a dot on a chain, selection, `__`, transport, bus, sequence, parameter or sequence event; keys and values of options objects; inside selector, bus, buffer, sequence, parameter and duration strings; helpers and host globals as names. Cmd/Ctrl-click or F12 on a node type or helper jumps to a definition in the script, or opens the source panel, or calls the host's `onDefinition`. The source of every built-in type and helper is copied from `src/nodes` and `src/util` by `scripts/extract-sources.mjs` into `src/editor/sources.generated.ts` (committed; `npm run lint` fails if it is stale) and loaded with a dynamic import on first use. CodeMirror is an optional peer dependency and external to the build; a test walks the import graph of every other entry point and fails if one reaches a package or `src/editor`. Tested in all three browsers; the demo pages were driven with Playwright in Chromium only. Not done: completion on variables that are reassigned or returned from functions (a name is known only by its declaration), methods of a node type (`call('...')` names are not in `NodeTypeInfo`), links from helper names inside shown source, a search panel, and go to definition for a type named in a selector string. `__.buffers` is not completed because `ScopeApi` has no such member |
| MIDI (`cracked-up/midi`) | `requestMidi` / `createMidi`: devices with hot-plug, every message type on all channels with any number of listeners, `play` (notes onto a synth), `bind` and `learn` (controller to parameter through its metadata), outputs with audio-clock timestamps and implicit event time, `sendClock` (24 ppqn, Start/Stop/Continue with song position), `follow` (an external `ClockSource`: tempo from averaged pulse spacing, position by gentle correction). Tested with pretend devices in all three browsers; a simulated clock with 1.5 ms of jitter is followed to within 2 ms. **Not measured against real hardware**, and Safari has no Web MIDI. Not exposed to sandboxed scripts |
| Graph inspector (`cracked-up/inspect`) | `createInspector` (into a host element), `openInspector` and `toggleInspector` (a sidebar or modal). Not imported by the core, no dependencies. A layered layout written for it (`layout.ts`: loops cut at the edge that closes them and never at a modulation edge, lanes for edges that skip columns or run back, an incremental mode that keeps nodes where they were). The picture is built from `snapshot()` plus what a snapshot lacks: type metadata, chains continued from an outer scope's bus (read from `node.inputs`), and the scopes inside macros (`node.insideScope`, added to the public types for this). Structure is DOM and SVG and changes only with the graph; meters and movement along connections are painted on one canvas from one animation frame loop. Levels come from one `AnalyserNode` per output in view, through the public `node.output` and `bus.output`, made only while audio runs and removed a second after they stop being wanted; an analyser was preferred to a shared worklet because it needs no module, works on any context and costs one buffer copy per reading. Tested: layout, model, meter maths against offline renders, a render with a tap on every output identical to one without, taps all removed on `destroy`, following rebuilds without moving kept nodes. Measured in headless Chromium: 0.3 ms of script per frame with 20 nodes in view, 0.85 ms with 100, 1.2 ms with 260; reading a 100-node graph again takes 0.4 ms and a fresh layout 3 ms. Limits: parameter values shown are base values (ramps in flight, offsets and modulation are not readable through the public API); readings mix all channels to one; a child scope's frame is linked to outer buses by one unmetered line per bus; connections from a node in one scope straight to a node in another are not drawn, as `describe()` does not report them; live metering is tested under Vitest only in Chromium (Firefox and WebKit do not start audio there without a click) and was checked by hand-driven Playwright runs in the other two; paint time beyond the script time was not measured |

Node types: see `src/nodes/builtin.ts`, or the generated reference in the docs page. Every type in the type map is implemented.

## Differences from Cracked that a script author will notice

- `__()` returns a chain, and the chain must be continued from that value. Cracked let a later, separate statement (`__.lowpass()`) continue "the previous node"; that relied on global state and is gone.
- `__('sel')` returns a selection that can be kept and reused.
- `.attr({ ... })` is `.set({ ... })`. Reading is `.param('name').value`. Every parameter also has a shortcut setter: `.frequency(200)`, `.gain(0.5)`.
- `.start()` / `.stop()` on sources are `.trigger()` / `.release()`. Samplers no longer need `stop()` before `start()`.
- `.connect('#main-output')` is `.to('main')`: chains end at a named bus.
- `class` takes space-separated names, not comma-separated.
- `*` does not include the nodes inside macros. Reach those with `polysynth lowpass` or `polysynth *`.
- `__.loop(...)` and `.bind('step', ...)` are `__.transport.steps(...)` and `__.transport.sequence(...)`. The callback receives an event with the exact audio time.
- `chance(p)` takes a probability from 0 to 1, not a percentage. `shuffle` returns a new array. `pitchToFreq` and `freqToPitch` do not round. `scale` returns a number, not a string.

## Decisions (from the owner, 2026-11-11)

1. **Implicit event time: yes.** Inside a sequence callback, an operation with no `at` fires at the event's time. Anywhere else it fires now. Code that continues after an `await` or a timer passes a time explicitly.
2. **Nodes without an id are matched by position.** On a rebuild, the old and new un-id'd nodes are aligned by type in creation order, so an insertion does not disturb the nodes after it. They can be selected by position: `lowpass:nth(1)`.
3. **Shortcut setters: yes**, generated from the registered parameter names. A parameter whose name is already a selection method (today only `release`) is set with `.set()`.
4. **`*` excludes macro internals**, with descendant selectors and `selection.select()` as the way in.
5. **Buses carry no built-in meaning.** The library has no notion of tracks or a master. The engine has one bus, `main`, feeding the output. Any other bus is created by the caller and feeds `main` until routed elsewhere. `.to('name')` fails clearly if no bus of that name exists in the scope or its parents.
6. **One transport per engine; sequences belong to it.** Scripts reach it as `__.transport`: the same transport seen from that `__`'s scope. Tempo, position and timing are shared; sequence names are per scope, and disposing a scope removes what it scheduled. `engine.transport` is the engine-wide view.
7. **Commands cover everything.** Every mutating method and its matching command run the same internal operation, so a command can do whatever a method can. Macros add their own operations as `methods`, reachable through the `call` command. `src/api/remote.ts` describes how a sandboxed script gets the full scripting API on top of that: writes become commands, reads come from a mirrored snapshot, and sequence callbacks run in the sandbox ahead of time.

## Open points

- **Remote sequences need a name.** A callback that lives in a sandbox is addressed by its sequence name, so `RemoteTransport.sequence` requires one.
- **Round-trip budget.** A sandboxed sequence callback must answer within the transport's look-ahead (default 100 ms). Measured in `demo/sandbox.html` (headless Chromium, sandboxed iframe, `postMessage` both ways): about 0.6 ms mean and under 2 ms worst, so the budget is not a concern on an idle page. A frame that blocks its own thread for longer than the look-ahead will be late; the demo counts those.
- **Remote graph edits are whole-graph.** A remote sends its full mirrored graph as one `apply` whenever its structure changed, at most once per turn of the event loop. If the host changes the structure at the same moment, the remote's version wins. Connections changed on the host are not mirrored until the next snapshot (sent when nodes are added or removed).
- **Custom node types in chains.** A type registered at runtime gets a chain method at runtime, but TypeScript only knows about it if `NodeTypeMap` is augmented. Graph data works for any type.

## Not in this draft

Designed in their own phases: recorder, input and looper nodes (Phase 5), MIDI and external clock sources (Phase 6), metering nodes (Phase 3).
