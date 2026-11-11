# API design (Phase 0)

Status: approved by the owner on 2026-11-11 with the decisions below. Phase 1 implements `api/` except `remote.ts` and `global.ts`, which come later.

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
| `api/engine.ts` | `createEngine`, the buffer store, seeded random, offline `render` |
| `api/graph.ts` | Nodes, selections and the selector grammar, chains, buses, scopes, the graph as data, commands |
| `api/params.ts` | `Param`: base value, ramps, temporary offsets, modulators, metadata |
| `api/nodes.ts` | The node type map, `defineNode`, `defineMacro`, the registry |
| `api/transport.ts` | Transport, sequences, the event object, durations |
| `api/global.ts` | The `cracked-up/global` entry point for live coding |
| `api/remote.ts` | The `cracked-up/remote` entry point: the same scripting API inside a sandbox |

`npm run typecheck` checks everything here.

## Differences from Cracked that a script author will notice

- `__()` returns a chain, and the chain must be continued from that value. Cracked let a later, separate statement (`__.lowpass()`) continue "the previous node"; that relied on global state and is gone.
- `__('sel')` returns a selection that can be kept and reused.
- `.attr({ ... })` is `.set({ ... })`. Reading is `.param('name').value`. Every parameter also has a shortcut setter: `.frequency(200)`, `.gain(0.5)`.
- `.start()` / `.stop()` on sources are `.trigger()` / `.release()`. Samplers no longer need `stop()` before `start()`.
- `.connect('#main-output')` is `.to('main')`: chains end at a named bus.
- `class` takes space-separated names, not comma-separated.
- `*` does not include the nodes inside macros. Reach those with `polysynth lowpass` or `polysynth *`.
- `__.loop(...)` and `.bind('step', ...)` are `transport.steps(...)` and `transport.sequence(...)`. The callback receives an event with the exact audio time.

## Decisions (from the owner, 2026-11-11)

1. **Implicit event time: yes.** Inside a sequence callback, an operation with no `at` fires at the event's time. Anywhere else it fires now. Code that continues after an `await` or a timer passes a time explicitly.
2. **Nodes without an id are matched by position.** On a rebuild, the old and new un-id'd nodes are aligned by type in creation order, so an insertion does not disturb the nodes after it. They can be selected by position: `lowpass:nth(1)`.
3. **Shortcut setters: yes**, generated from the registered parameter names. A parameter whose name is already a selection method (today only `release`) is set with `.set()`.
4. **`*` excludes macro internals**, with descendant selectors and `selection.select()` as the way in.
5. **Buses carry no built-in meaning.** The library has no notion of tracks or a master. The engine has one bus, `main`, feeding the output. Any other bus is created by the caller and feeds `main` until routed elsewhere. `.to('name')` fails clearly if no bus of that name exists in the scope or its parents.
6. **One transport per engine; sequences belong to it,** not to scopes. Related sequences share a `group` and can be cleared together.
7. **Commands cover everything.** Every mutating method is implemented by dispatching a command, so the command set is complete by construction. Macros add their own operations as `methods`, reachable through the `call` command. `api/remote.ts` describes how a sandboxed script gets the full scripting API on top of that: writes become commands, reads come from a mirrored snapshot, and sequence callbacks run in the sandbox ahead of time.

## Open points

- **Remote sequences need a name.** A callback that lives in a sandbox is addressed by its sequence name, so `RemoteTransport.sequence` requires one.
- **Round-trip budget.** A sandboxed sequence callback must answer within the transport's look-ahead (default 100 ms). To be measured when the remote entry point is built.
- **Custom node types in chains.** A type registered at runtime gets a chain method at runtime, but TypeScript only knows about it if `NodeTypeMap` is augmented. Graph data works for any type.

## Not in this draft

Designed in their own phases: recorder, input and looper nodes (Phase 5), MIDI and external clock sources (Phase 6), metering nodes (Phase 3).
