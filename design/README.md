# API design (Phase 0)

Status: proposed, awaiting the owner's review. Nothing in this folder is implemented.

This folder is the proposed public API for Phases 1 and 2 of cracked-up (graph core and transport), written as TypeScript declarations, plus example programs that are type-checked against it. The plan it belongs to is in the Euclip repo: `docs/plans/cracked-up-and-euclip-v2.md`.

Implementation starts once the declarations are approved. After Phase 2 a throwaway host prototype is built against the real thing, and one revision of this API is expected then.

## What to read

Start with the examples; they show how the API feels in use.

| File | Shows |
|---|---|
| `examples/live-coding.ts` | A live coder using `__` and the transport: named sequences, pattern strings, a polyrhythm, swing, a ratchet |
| `examples/host-with-tracks.ts` | A host with tracks: one scope per track, controls from metadata, adding an effect by editing graph data, sandboxed-script commands |
| `examples/offline-test.ts` | Rendering offline and asserting on the audio |
| `examples/type-safety.ts` | Mistakes the types reject |

Then the declarations:

| File | Covers |
|---|---|
| `api/engine.ts` | `createEngine`, the buffer store, seeded random, offline `render` |
| `api/graph.ts` | Nodes, selections and the selector grammar, chains, buses, scopes, the graph as data, commands |
| `api/params.ts` | `Param`: base value, ramps, temporary offsets, modulators, metadata |
| `api/nodes.ts` | The node type map, `defineNode`, `defineMacro`, the registry |
| `api/transport.ts` | Transport, sequences, the event object, durations |
| `api/global.ts` | The `cracked-up/global` entry point for live coding |

`npm run typecheck` checks everything here.

## Differences from Cracked that a script author will notice

- `__()` returns a chain, and the chain must be continued from that value. Cracked let a later, separate statement (`__.lowpass()`) continue "the previous node"; that relied on global state and is gone.
- `__('sel')` returns a selection that can be kept and reused.
- `.attr({ ... })` is `.set({ ... })`. Reading is `.param('name').value`.
- `.start()` / `.stop()` on sources are `.trigger()` / `.release()`. Samplers no longer need `stop()` before `start()`.
- `.connect('#main-output')` is `.to('main')`: chains end at a named bus.
- `class` takes space-separated names, not comma-separated.
- `__.loop(...)` and `.bind('step', ...)` are `transport.steps(...)` and `transport.sequence(...)`. The callback receives an event with the exact audio time.
- Per-node shortcut setters (`.frequency(200)`, `.volume(0.5)`) are not in this draft. See question 3.

## Questions for review

1. **Implicit event time.** Inside a sequence callback, an operation with no `at` uses the event's time. This keeps live code short, but it is a small piece of ambient state on the engine (set while a callback runs, cleared after), and it does not carry across `await` or `setTimeout`. The alternative is to require `at` everywhere. The draft includes the implicit form.
2. **Ids of nodes created without one.** `scope.build` gives them ids from type and position (`lowpass-1`). Inserting a node ahead of another of the same type renames the later ones, so a rebuild treats them as different nodes. Hosts should assign ids; the question is whether un-id'd nodes should instead be matched by position in their chain.
3. **Shortcut setters on selections.** Cracked has `.frequency(n)`, `.volume(n)`, `.fadeIn()`. They could be generated from parameter names for typed selections. Left out for now to keep the surface small; easy to add in `cracked-up/global` only.
4. **`*` excludes macro internals.** In Cracked `*` returns containers and their inner nodes together. Here inner nodes are reached with a descendant selector (`polysynth lowpass`) or `selection.select(...)`.
5. **Bus routing default.** A bus created in a child scope feeds the same-named bus in the parent if there is one, otherwise the parent's `main`. That makes `to('main')` in a track mean "this track's output", which then flows to the master. Check this matches how track and master should relate in Euclip.
6. **Sequences belong to the transport, not to a scope.** A scope's `dispose()` cancels sequences that were created through it, which needs sequences to record an owner. The draft's `transport.sequence` has no scope argument yet; the likely shape is `scope.sequence(...)` as a thin wrapper. To settle before Phase 2.
7. **Commands.** `Command` covers trigger, release, set, ramp and offset. Graph edits from a sandboxed setup script would travel as `GraphData`. Is anything else needed across the sandbox boundary (sequence edits such as `setStep`)?

## Not in this draft

Designed in their own phases: recorder, input and looper nodes (Phase 5), MIDI and external clock sources (Phase 6), metering nodes (Phase 3).
