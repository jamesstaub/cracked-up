# cracked-up

cracked-up is a ground-up TypeScript reimagining of Bill Orcutt's
[I Dropped My Phone The Screen Cracked](https://github.com/billorcutt/i_dropped_my_phone_the_screen_cracked)
(MIT, 2014). It is not API-compatible with the original.

## Status

Pre-alpha. Implemented and tested: the graph core (engine, scopes, selections, chains, parameters,
buses), the transport (sequences, polyrhythm, swing, tempo changes, offline rendering), a sampler and a
set of native and effect nodes. Not yet: macros and synths, graph reconciliation, sandboxed scripts,
recording and MIDI. `design/README.md` has the API decisions and a table of what works today.

## Development

Requires Node 22.12 or newer (see `.nvmrc`).

```sh
npm install
npx playwright install chromium   # add firefox webkit for test:all-browsers
npm run typecheck
npm run lint
npm run build
npm test                          # Chromium, headless
npm run test:all-browsers         # Chromium, Firefox and WebKit
```

### Live demo

```sh
npm run demo
```

Opens a page with a code box that re-runs on every key up (`demo/index.html`), with a docs page
beside it (`demo/docs.html`). The docs explain the concepts and list every node type; that list is
generated from the node definitions, and each example opens in the demo. While the code has an
error, the last working version keeps playing, and a new version comes in exactly in time.

Tests run in real browsers through Vitest browser mode and Playwright, because they need Web Audio
(`OfflineAudioContext`).

## Planned entry points

- `cracked-up`: engine, selection, parameters, transport
- `cracked-up/nodes`: node definitions and registry
- `cracked-up/worklets`: AudioWorklet processors
- `cracked-up/util`: pure helpers
- `cracked-up/global`: optional global-namespace convenience

## License

MIT. Copyright (c) 2014 Bill Orcutt, Copyright (c) 2026 James Staub.
