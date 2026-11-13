# cracked-up

cracked-up is a library for building and sequencing sound in the browser with the Web Audio API,
made for live coding. You chain audio nodes together and find them again with CSS-style selectors:

```js
__().saw({ id: 'bass', gate: 'closed' }).lowpass({ id: 'filter', frequency: 500, q: 6 }).gain(0.25).to('main');

__.transport.sequence('bass', { steps: [55, 0, 55, 82.4], step: '1/8' }, (ev) => {
  if (ev.value) __('#bass').set({ frequency: ev.value }).trigger({ duration: ev.duration * 0.6 });
});
```

It is a ground-up TypeScript rewrite of Bill Orcutt's
[I Dropped My Phone The Screen Cracked](https://github.com/billorcutt/i_dropped_my_phone_the_screen_cracked)
(MIT, 2014). It keeps that library's idea, the `__` object and selectors, but it is not compatible
with it: old Cracked code will not run unchanged.

**Status: pre-alpha.** It is not on npm yet, and names and behaviour may still change. See
[Versions and releases](#versions-and-releases).

## What is in it

- **No global state.** Everything belongs to an engine you create on your own audio context. Scopes
  give each script or track its own ids. Selections are immutable, so code in one callback cannot
  disturb another.
- **A transport with tight timing.** Sequences, polyrhythm, swing, tempo changes, `every` and `at`,
  scheduled ahead of time on the audio clock.
- **Rebuilding in place.** Re-run changed code and only the difference is applied: what you did not
  touch keeps sounding, and code that throws leaves the previous version playing.
- **Parameters with metadata**, so a host can build controls, and so values can be ramped,
  offset and modulated.
- **Node types**: oscillators, a sampler with slices, filters, delays, distortion, envelopes,
  modulators, two synths, a recorder, a looper, live input, a multiband compressor and a tape delay.
  Define your own with `defineNode` and `defineMacro`.
- **Offline rendering.** The same code renders faster than real time, which is also how the library
  is tested, and how stems and WAV files are made.
- **Sandboxed scripts** (`cracked-up/remote`): the same scripting API for code that runs in a
  sandboxed frame or Worker, for apps where people share scripts.
- **MIDI** (`cracked-up/midi`): notes and controllers in and out, and clock sync both ways.
- **An editor** (`cracked-up/editor`): a code editor for an app to embed, built on CodeMirror 6.
  Completion and hover documentation for node types, parameters, selectors, buffers and helpers,
  and the source of any node type or helper on Cmd-click. It works from plain data, so it needs no
  engine and behaves the same beside a sandbox.
- **Composing helpers** (`cracked-up/util`): Euclidean rhythms, pattern transforms, sieves, scales
  and chords, seeded randomness, conversions.

`design/README.md` records the API decisions and has a table of exactly what is implemented and
what its limits are.

## Try it

In the browser, with nothing to install:

- [Live demo](https://jamesstaub.github.io/cracked-up/)
- [Docs](https://jamesstaub.github.io/cracked-up/docs.html)
- [Sandboxed demo](https://jamesstaub.github.io/cracked-up/sandbox.html) and the guide to
  [running other people's scripts](https://jamesstaub.github.io/cracked-up/collaboration.html)

That site is rebuilt from `main` on every push (`.github/workflows/pages.yml`).

To run it yourself you need Node 22.12 or newer (see `.nvmrc`).

```sh
npm install
npm run demo
```

That opens:

- **A live demo** (`demo/index.html`): the editor, with code that re-runs as you type.
- **The docs** (`demo/docs.html`): a guide, a helper reference, and a reference for every node type
  that is generated from the library itself. Every example has a "Try it" link into the demo.
- **A sandboxed demo** (`demo/sandbox.html`) and a guide to
  [running other people's scripts](demo/collaboration.html), for apps with collaboration.

## Entry points

| Import | What it is |
|---|---|
| `cracked-up` | `createEngine`, `defineNode`, `defineMacro`, and all the types |
| `cracked-up/util` | Pure helpers: patterns, scales, randomness, conversions, `encodeWav`; and `helpers`, every helper by name with its documentation, for putting in scope of scripts |
| `cracked-up/remote` | `createRemote` and `linkRemote`, for sandboxed scripts |
| `cracked-up/midi` | `requestMidi` and `createMidi` |
| `cracked-up/nodes` | The built-in node definitions |
| `cracked-up/worklets` | The AudioWorklet source, for hosts that must serve it themselves |
| `cracked-up/global` | A ready-made engine and `__` for quick experiments |
| `cracked-up/editor` | `createEditor`, `createSourcePanel` and the catalog functions. Needs CodeMirror 6, which you install (see below) |

```js
import { createEngine } from 'cracked-up';

const engine = await createEngine({ context: new AudioContext() });
const __ = engine.$;
__().sine(440).gain(0.2).to('main');
```

No entry point has a dependency except `cracked-up/editor`, which is built on CodeMirror 6. The
CodeMirror packages are optional peer dependencies, so they are not installed with the library and
nothing else imports them. An app that uses the editor installs them:

```sh
npm install @codemirror/state @codemirror/view @codemirror/commands @codemirror/language \
  @codemirror/autocomplete @codemirror/lang-javascript @lezer/highlight @lezer/common
```

```js
import { createEditor, catalogFromEngine } from 'cracked-up/editor';

const editor = createEditor({
  parent: document.querySelector('#code'),
  doc: "__().sine(440).gain(0.2).to('main');",
  catalog: catalogFromEngine(engine),
  onChange: (code) => run(code),
});
```

The docs page has the rest: the catalog, several editors on a page, sandboxed scripts, the source
panel, and theming.

## Development

```sh
npm install
npx playwright install chromium firefox webkit
npm run typecheck
npm run lint
npm run build
npm test                    # Chromium, headless
npm run test:all-browsers   # Chromium, Firefox and WebKit
npm run check               # all of the above, as CI and releases run it
```

`src/editor/sources.generated.ts` holds the source text the editor's source viewer shows. It is
written by `npm run sources` (which `npm run build` runs first) from `src/nodes` and `src/util`, and
it is committed, so the demo and the type check work from a fresh clone. `npm run lint` fails if it
is out of date: after changing a node definition or a helper, run `npm run sources` and commit the
result.

Tests run in real browsers through Vitest browser mode and Playwright, because they need Web Audio.
Most render offline and compare exact samples. Two tests need a live sound device and a pretend
microphone; they run only in Chromium, and are skipped when `VITE_SKIP_LIVE_AUDIO` is set, as it is
on GitHub.

## Versions and releases

cracked-up follows [Semantic Versioning](https://semver.org). A version is `major.minor.patch`:

| You changed | Before 1.0.0 | From 1.0.0 on |
|---|---|---|
| Something that breaks existing code (a renamed or removed name, different behaviour) | `minor` (0.1.0 to 0.2.0) | `major` (1.4.2 to 2.0.0) |
| Something new that breaks nothing | `patch` (0.1.0 to 0.1.1) | `minor` (1.4.2 to 1.5.0) |
| A fix that breaks nothing | `patch` | `patch` (1.4.2 to 1.4.3) |

While the version starts with 0, the API is still settling, so a breaking change only raises the
middle number. 1.0.0 will be the promise that it has settled.

What counts as the API: everything importable from the entry points above, the node types and their
parameters, the selector grammar, and the command and message formats of `cracked-up/remote`. The
demo pages are not part of it.

### Day to day

Write each change under **Unreleased** in `CHANGELOG.md` as you make it, under Added, Changed, Fixed
or Removed.

### Making a release

1. Make sure `main` is committed and clean, and that **Unreleased** in `CHANGELOG.md` says what
   changed.
2. Choose the kind of release from the table and run one of:

   ```sh
   npm version patch
   npm version minor
   npm version major
   ```

   This runs every check (`npm run check`), raises the version in `package.json`, moves
   **Unreleased** in the changelog under the new version with today's date, commits, and creates the
   tag, for example `v0.2.0`. If a check fails, or nothing is listed under **Unreleased**, it stops
   and changes nothing.
3. Push the commit and the tag:

   ```sh
   git push --follow-tags
   ```

GitHub Actions takes it from there (`.github/workflows/release.yml`). On a version tag it runs the
checks again in all three browsers, confirms the tag matches `package.json`, and creates a GitHub
release whose text is that version's changelog section, with the built package
(`cracked-up-x.y.z.tgz`) attached.

For a trial version, use a pre-release: `npm version preminor --preid=beta` gives `0.2.0-beta.0`,
and `npm version prerelease` the next one. Versions with a hyphen are marked as pre-releases on
GitHub.

The first release is already prepared: `package.json` and the changelog say 0.1.0. Once the
repository is on GitHub, tag it by hand, since there is nothing to raise the version from:

```sh
git tag v0.1.0
git push origin main --follow-tags
```

### Using a release

Until the library is on npm, install the package attached to a release, or a tag straight from git:

```sh
npm install https://github.com/jamesstaub/cracked-up/releases/download/v0.1.0/cracked-up-0.1.0.tgz
```

The repository is a fork of the original library on GitHub. The rewrite lives on the `main` branch;
the original code, with this fork's earlier fixes, stays on `master`. Publishing to npm is not set up;
it would be one more step in the release workflow and an npm token in the repository's secrets.

Every push and pull request also runs the checks (`.github/workflows/ci.yml`).

## License

MIT. Copyright (c) 2014 Bill Orcutt, Copyright (c) 2026 James Staub.
