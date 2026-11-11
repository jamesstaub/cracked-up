# cracked-up

cracked-up is a ground-up TypeScript reimagining of Bill Orcutt's
[I Dropped My Phone The Screen Cracked](https://github.com/billorcutt/i_dropped_my_phone_the_screen_cracked)
(MIT, 2014). It is not API-compatible with the original.

## Status

Pre-alpha. The graph core is implemented and tested: engine, scopes, selections, chains, parameters, buses, a sampler and the basic native nodes. The transport, macros and the remaining nodes are not. `design/README.md` has the API decisions and a table of what works today.

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

Opens a page with a code box that re-runs on every key up (`demo/index.html`). While the code has an
error, the last working version keeps playing. The transport is not built yet, so the demo supplies a
temporary `every(seconds, fn)` timer in its place.

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
