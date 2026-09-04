# Basic

A game design workbench: a wiki that writes its own cross-references, driven by a
progression document and a flow-chart canvas.

Two halves, one graph. **Object pages** (characters, items, locations — whatever your
templates say) are nouns. **Progression documents** (acts, and beats inside them) say what
becomes true and when. Every link between them is *generated*: you state a fact once, in
the beat where it happens, and the object pages grow the back-references by themselves.

The design principle everything else follows from: **a fact is asserted once, and every
view is a query.** No view owns data.

## Commands

```bash
npm run dev          # Vite dev server on :5173 — the whole UI runs in a browser
npm run electron:dev # the desktop app (expects the dev server already running)
npm test             # node --test over the pure core. No Jest, no Vitest.
npm run typecheck    # tsc --noEmit
npm run build        # renderer bundle into dist/
```

Node 24 strips TypeScript natively, so `node --test test/*.test.ts` runs `.ts` with no
loader and no build step. `erasableSyntaxOnly` is on, which is what keeps that true — no
enums, no namespaces, no parameter properties.

## Layout

```
electron/
  main.js         Thin bootstrap. Crash handlers first, then a DYNAMIC import of app.js.
  app.js          Window, IPC, filesystem. Knows nothing about the domain model.
  preload.cjs     One frozen `basicNative` namespace. CommonJS by necessity.

src/core/         PURE. No DOM, no Electron, no fs. This is where the thinking lives.
  types.ts          Nodes, edges, templates, relations, requirements, problems.
  parse-doc.ts      Frontmatter split and the ONE wikilink parser.
  write-doc.ts      Managed-block writer. The sharpest edge in the app.
  index-graph.ts    Builds the graph. Two passes: nodes, then edges.
  project.ts        Templates and the relation registry.
  generate.ts       Renders a template's declared sections into Markdown.
  scaffold.ts       What a new project starts life as.

src/platform/     The ONLY files that know Electron from browser.
  index.ts          The adapter. Electron goes over IPC; a browser gets an in-memory
                    project persisted to localStorage, so the whole UI is driveable
                    under Vite with nothing packaged.
  demo.ts           The project opened on first run, built by the real scaffolder.

src/state/store.ts  One store. Docs in, index out, every view subscribes.
src/ui/             React. canvas/ wiki/ explorer/ inspector/
src/styles/         tokens.css owns every literal value.
test/               Flat *.test.ts, node --test.
```

## Which file

| Question | File |
|---|---|
| How does a `[[link]]` get found? | `src/core/parse-doc.ts` |
| Why did my prose survive a regenerate? | `src/core/write-doc.ts` |
| Where does an edge come from? | `src/core/index-graph.ts` |
| What does "Available from" mean? | `src/core/project.ts` (relations) + the template's `sections` |
| Why is the canvas framed like that? | `src/ui/canvas/tidy.ts` |
| Why did the card open on click but not on drag? | `src/ui/canvas/card.tsx` |
| Where do files actually get written? | `electron/app.js` |

## Conventions

- **The core is pure.** If logic is worth testing, it goes in `src/core` as a function of
  its arguments. There is no jsdom and adding one would be a step back.
- **`createX({...})` factories** returning an object of methods.
- **Comments say *why*, and name the bug.** Most files open with the reasoning.
- **Every literal value lives in `tokens.css`.** A raw hex, gap or z-index anywhere else
  is a bug; the fix is to add the missing token.
- **State is never carried by depth alone.** Selection is a ring *and* a colour change.
- **Never fabricate.** An unset field renders "— not set". A section with nothing in it
  says `_Nothing yet._`. The status bar prints a count, never a verdict.
- Kebab-case filenames. 4-space indent, single quotes, semicolons, trailing commas.

## Things that have already cost time

- **React Flow will not measure your nodes if you pass `nodes` without `onNodesChange`.**
  `nodesInitialized` stays false forever, the wrapper keeps `visibility: hidden`, and
  `fitView` fits a bounding box that does not exist. Symptom: a five-card graph at 26%
  zoom, or an invisible canvas. Basic sidesteps the whole thing — it supplies `width` and
  `height` on every node and computes the viewport itself in `tidy.ts`, using the same
  numbers dagre used. Layout and framing cannot disagree because they are one calculation.
- **A `useRef` guard inside an effect is eaten by StrictMode.** The first invocation sets
  the guard, the second returns early, and the real render never runs. If an effect must
  run once per *thing*, key the effect on that thing.
- **Managed blocks are read-only widgets in the editor, not editable text.** That is what
  makes regeneration safe: the cursor physically cannot be inside a region the app
  rewrites. They stay plain text on disk — read-only is a property of the editor, not the
  format.
- **Never `await app.whenReady()` at the top level of the main process.** Electron
  dispatches `ready` only once the main entry has finished evaluating. `main.js` awaits
  `app.js`, so a top-level await on `whenReady()` there means evaluation waits for ready
  and ready waits for evaluation. The app comes up with no window, no error and no log,
  forever. Attach a `.then()` and let the module finish.
- **`setWindowOpenHandler` is on `win.webContents`, not on `win`.** Calling it on the
  window throws inside the ready callback, which is an unhandled *rejection* - so nothing
  reaches the console and you get a window that never loads. The crash handlers in
  `main.js` exist precisely to catch this class of thing; check
  `%TEMP%\basic\startup-crash.log` before assuming Electron is broken.
- **Reindexing must not clobber write refusals.** `reindex()` rebuilds `problems` from the
  index, and the index has no idea a file was refused. Write refusals live in
  `state.writeProblems` and are merged in, because "Basic declined to touch this page" is
  the single most important thing the problems list can say and it was being silently
  dropped. `test/store.test.ts` catches the regression.
- **Hash the writes, do not time them.** Every write Basic makes fires its own watcher.
  `electron/app.js` records the hash of what it wrote and drops matching events. A settling
  timer is a guess about scheduler latency and it is wrong under load.
- **The dev server is registered in `D:\Claude_Projects\.claude\launch.json`** as `basic`,
  not in this folder, because the preview tool reads the session root.

## State

M1 is done and verified end to end: templates, object pages, a progression document with
beats, the graph index with provenance, generated sections, the canvas, and the editor.
The Electron shell launches and loads the renderer (`%TEMP%\basic\main.log` confirms it);
the browser path under Vite is what the UI was driven and screenshotted through.
M2 onwards — saved canvas layouts, multi-beat authoring, the fold, developer mode — is in
`C:\Users\Hentu\.claude\plans\i-d-like-to-make-luminous-babbage.md`.

The store's consistency guarantees are covered in `test/store.test.ts` against the
in-memory platform. The Electron filesystem path in `electron/app.js` (atomic writes, echo
suppression, the path-traversal guard) is **not** unit-tested - it needs an Electron host,
and pulling it apart to fake one has not been done.

Not yet built: `dev/cards.html` (static specimens of every card state). The dimmed and
broken-reference states have CSS but nothing in the app can reach them yet, so that page
would be showing states the app cannot produce.
