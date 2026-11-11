# cracked-up

cracked-up is a ground-up TypeScript reimagining of Bill Orcutt's
[I Dropped My Phone The Screen Cracked](https://github.com/billorcutt/i_dropped_my_phone_the_screen_cracked)
(MIT, 2014). It is not API-compatible with the original.

## Status

Pre-alpha. The public API is being designed in `design/`; nothing is implemented yet.

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
