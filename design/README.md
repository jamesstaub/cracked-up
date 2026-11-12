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
| External clock sources | Not yet. They throw or report `unsupported` |

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
