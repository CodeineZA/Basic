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
npm run pack         # a Windows installer into release/, published nowhere
npm run release      # cut a GitHub Release and publish it (needs GH_TOKEN)
npm run art          # regenerate build/icon.ico and the NSIS bitmaps
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
  fold.ts           World state at any beat, and ordering mistakes only order can reveal.
  edit-doc.ts       Frontmatter edits (beat order, status) that keep comments and prose.
  validate.ts       Every finding, plus act rollups. Ordering rules live here.
  render.ts         Markdown to HTML, with wikilinks as a markdown-it inline rule.
  search.ts         Fuzzy matching and ranking.
  edit-schema.ts    Editing templates and relations, comments intact.
  canvas.ts         Canvas documents: positions, sketches, and what gets drawn.
  promote.ts        Turning a drawn line into something a file actually says.
  project.ts        Templates and the relation registry.
  generate.ts       Renders a template's declared sections into Markdown.
  scaffold.ts       What a new project starts life as.

src/platform/     The ONLY files that know Electron from browser.
  index.ts          The adapter. Electron goes over IPC; a browser gets an in-memory
                    project persisted to localStorage, so the whole UI is driveable
                    under Vite with nothing packaged.
  demo.ts           The project opened on first run, built by the real scaffolder.

src/state/store.ts  One store. Docs in, index out, every view subscribes.
src/ui/             React. canvas/ script/ board/ problems/ wiki/ schema/ table/ explorer/
  wiki/page.tsx       The read view: rendered prose, backlinks, dead-link creation.
  wiki/editor.tsx     The edit view: prose textareas, generated blocks read-only.
src/styles/         tokens.css owns every literal value.
test/               Flat *.test.ts, node --test.

electron-builder.yml  NSIS packaging and the GitHub publish target.
scripts/              make-installer-art.mjs, ensure-release.mjs, finish-release.mjs
build/                GENERATED art. Gitignored; `npm run art` rebuilds it.
release/              GENERATED installer. Gitignored.
dist-electron/        GENERATED desktop renderer bundle. Gitignored.
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
| What does the world look like at beat N? | `src/core/fold.ts` |
| How is an act's beat order changed? | `src/core/edit-doc.ts` |
| Why is this beat being complained about? | `src/core/validate.ts` |
| Why can I not mark this beat complete? | `canComplete` in `src/core/validate.ts` |
| Why is that link orange with a plus? | `render.ts` - it points at no page yet |
| Why is this search result here? | `src/core/search.ts`, and the hit's `via` |
| How do I add a field to a kind of thing? | The template editor, or `src/core/edit-schema.ts` |
| Why does filling in a field create a link? | The field's `rel` - see the template editor |
| Why can I not promote this line? | `planPromotion` in `src/core/promote.ts` - it says why |
| Where did my card positions go? | `canvases/<id>.json` |
| Where do files actually get written? | `electron/app.js` |
| Why is the app served from basic:// ? | `electron/app.js`, the protocol comment |
| Why did packaging fail with EPERM? | see below - it is the dev server |

## Conventions

- **The core is pure.** If logic is worth testing, it goes in `src/core` as a function of
  its arguments. There is no jsdom and adding one would be a step back.
- **`createX({...})` factories** returning an object of methods.
- **Comments say *why*, and name the bug.** Most files open with the reasoning.
- **Every literal value lives in `tokens.css`.** A raw hex, gap or z-index anywhere else
  is a bug; the fix is to add the missing token.
- **State is never carried by depth alone.** Selection is a ring *and* a colour change.
- **Never fabricate.** An unset field renders "— not set". A section with nothing in it
  says `_Nothing yet._`. The status bar prints a count, never a verdict, and an empty
  problems list says the references resolve — not that the design is finished.
- **A derived number must not be settable.** An act's status comes from `rollupOf` and there
  is deliberately no way to type one in, because a green act on top of red beats is exactly
  the fabricated metric the house rules forbid.
- **A rule the UI enforces gets a validation rule too.** The status dropdown will not offer
  `complete` without a `verify`, but a file hand-edited elsewhere can still say it, so
  `beat/complete-without-verify` catches it. Prevent in the UI, detect in the core.
- Kebab-case filenames. 4-space indent, single quotes, semicolons, trailing commas.

## Things that have already cost time

- **React Flow will not measure your nodes if you pass `nodes` without `onNodesChange`.**
  `nodesInitialized` stays false forever, the wrapper keeps `visibility: hidden`, and
  `fitView` fits a bounding box that does not exist. Symptom: a five-card graph at 26%
  zoom, or an invisible canvas. Basic sidesteps the whole thing — it supplies `width` and
  `height` on every node and computes the viewport itself in `tidy.ts`, using the same
  numbers dagre used. Layout and framing cannot disagree because they are one calculation.
- **Never put required work in `requestAnimationFrame` or `ResizeObserver`.** Both are
  callback-driven and neither fires in a window that is not being composited - hidden,
  minimised, occluded, or a headless preview pane. The canvas framing sat in a rAF for a
  while and simply never ran. `getBoundingClientRect` inside a `useEffect` is synchronous,
  the DOM is already committed by then, and it works whether or not anything is painting.
- **`overflow: hidden` on a node clips React Flow's connection handles.** Handles sit half
  outside the node by design. Clipping them leaves an unhittable sliver, so every attempt to
  drag a connection grabs the pane instead and silently pans the canvas - which reads as
  "dragging does not work". Diagnose it with
  `document.elementFromPoint(cx, cy) === handleElement`; if that is false the handle is
  covered, whatever the screenshot suggests.
- **A canvas renders nothing measurable while the window is hidden.** React Flow learns node
  and handle geometry from a ResizeObserver, which does not fire without compositing, so
  edges are absent from the DOM even though they are in state. Querying the DOM from
  JavaScript will report zero edges and look exactly like a regression. Take a screenshot
  first - it forces a paint - and only then believe what the DOM says. This cost most of an
  afternoon twice, the second time convinced of a regression that did not exist.
- **Check the viewport is not 0x0 before believing any measurement.** A collapsed preview
  pane reports `innerWidth === 0`, every element measures 0x0, and it looks exactly like a
  broken flexbox. Several hours went into a CSS bug that did not exist. `resize_window`
  fixes it; measuring `innerWidth` first would have saved the lot.
- **A bash heredoc will turn `\b` in a Python string into a literal backspace byte.** It
  has happened twice: once in a doc path, once in a regex. The result looks correct in a
  diff and is not - `/\b\w/` becomes `/<BS>\w/`, which silently matches nothing. Use a
  Python raw string, or write the file with the Write tool. A repo-wide sweep for bytes
  below 0x09 catches it. It happened a third time while writing this very entry.
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
  `main.js` exist precisely to catch this class of thing. Two logs matter:
  `%TEMP%\basic\startup-crash.log` for a failure before the app is ready, and
  `%APPDATA%\Basic\logs\main.log` (electron-log) for everything after it.
- **Reindexing must not clobber write refusals.** `reindex()` rebuilds `problems` from the
  index, and the index has no idea a file was refused. Write refusals live in
  `state.writeProblems` and are merged in, because "Basic declined to touch this page" is
  the single most important thing the problems list can say and it was being silently
  dropped. `test/store.test.ts` catches the regression.
- **A running Vite dev server breaks packaging.** electron-builder extracts ~200 MB of
  Electron into `release/win-unpacked.tmp` and then RENAMES that directory. A file watcher
  holding handles inside it makes the rename fail with `EPERM`, and the error says nothing
  whatsoever about a dev server - it looks like a permissions problem with the disk.
  `vite.config.ts` now excludes `release/`, `dist-electron/`, `dist/` and `build/` from the
  watcher, which fixes it properly. If it ever comes back, stop the dev server first.
- **`verifyUpdateCodeSignature: false` is load-bearing while we ship unsigned.**
  electron-updater checks a downloaded installer's Authenticode signature before running it.
  An unsigned build has none, so with the check on every update fails verification and is
  discarded - the app reports an update error forever and never moves a version. It flips
  back to true the day there is a certificate.
- **Differential updates need the PREVIOUS installer in the updater cache.** Running
  `release/win-unpacked/Basic.exe` directly never populates that cache, so the log says
  "Cannot download differentially, fallback to full download: ENOENT ... installer.exe".
  That is correct behaviour, not a fault. The delta itself works - a point release computed
  1.7 MB of changed blocks out of 94 MB.
- **Hash the writes, do not time them.** Every write Basic makes fires its own watcher.
  `electron/app.js` records the hash of what it wrote and drops matching events. A settling
  timer is a guess about scheduler latency and it is wrong under load.
- **The dev server is registered in `D:\Claude_Projects\.claude\launch.json`** as `basic`,
  not in this folder, because the preview tool reads the session root.

## State

M1 through M5 are done and verified end to end.

M1: templates, object pages, a progression document with beats, the graph index with
provenance, generated sections, the canvas, and the editor.

M2: multi-beat acts, the script view, beat reordering and editing that preserves YAML
comments, the fold that derives world state at any beat, and the beat scrubber that shows
the act - script and canvas both - as of a moment in time.

M3: developer mode. The build board with derived rollups, the verify-required-to-complete
rule enforced in the UI and checked in the core, status filtering across script and canvas,
and a problems panel surfacing the ordering rules above.

M4: the wiki. Pages render with clickable wikilinks and labelled generated sections,
backlinks name the file and field that claimed them, fuzzy search ranks by how the match was
made, and a link pointing at nothing offers to create the page.

M5: authoring the schema. Templates and relations are edited in the app, new kinds of thing
are created from the explorer, and a table view puts every thing of one kind side by side
with its scalar fields editable for balancing.

Canvas authoring: canvas documents you build on. Drag from the palette to place or create,
drag between handles to draw a line, and promote a line into a real relationship that is
written into the document that owns it. Positions persist in `canvases/<id>.json`.
The desktop app is packaged and shipping: an NSIS installer, the renderer served over
`basic://`, and updates from GitHub Releases. Verified in a packaged build, not just wired:
`renderer loaded: basic://app/index.html`, and a kept 0.1.0 build found 0.1.1 on the live
feed and downloaded it. The browser path under Vite is what the UI itself was driven and
screenshotted through.
M2 onwards — saved canvas layouts, multi-beat authoring, the fold, developer mode — is in
`C:\Users\Hentu\.claude\plans\i-d-like-to-make-luminous-babbage.md`.

The store's consistency guarantees are covered in `test/store.test.ts` against the
in-memory platform. The Electron filesystem path in `electron/app.js` (atomic writes, echo
suppression, the path-traversal guard) is **not** unit-tested - it needs an Electron host,
and pulling it apart to fake one has not been done.

Not yet built: `dev/cards.html` (static specimens of every card state). The dimmed and
broken-reference states have CSS but nothing in the app can reach them yet, so that page
would be showing states the app cannot produce.

## Releasing

`npm run release` does the whole thing: create the release as a draft, generate the art,
build the desktop renderer, package and upload, then publish only once the installer, its
blockmap and `latest.yml` are all present. A missing asset stops it - an updater pointed at
a release with no `latest.yml` reports an error to every user, forever.

It needs `GH_TOKEN` in the environment, which `git push` does not. Read it out of Credential
Manager rather than pasting one anywhere. From the Bash tool:

```bash
GH_TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill | sed -n 's/^password=//p') npm run release
```

Scope it to the one command. That token lands in the session's environment otherwise, where
anything else in the session can read it.

Bump `version` in package.json first and commit it, so the tag matches shipped code.

## Verifying an update actually works

Checking that the app "finds the feed" is not the same as checking that it updates. To prove
the whole path, keep the old build before bumping:

```bash
cp -r release/win-unpacked /d/Claude_Projects/.scratch/basic-<old-version>
```

Bump, release, then run that kept copy and watch `%APPDATA%\Basic\logs\main.log`. It should
report the newer version, compute a block delta, and download. This is how the pipeline was
verified for 0.1.0 -> 0.1.1.

## What Basic can tell you that a wiki cannot

Referential checks - "this link goes nowhere" - are table stakes. The findings that justify
the tool all need the ORDER of the progression:

| Rule | What it catches |
|---|---|
| `beat/anachronism` | Something used before the beat that introduces it - a vendor selling before anyone has met them. Names the beat that does introduce them. |
| `beat/unreachable` | A beat requiring one that happens later, or itself. Dead content. |
| `beat/complete-without-verify` | Done claimed with no way to check it. |
| `beat/asserts-nothing` | A beat that changes nothing, so it appears nowhere else. |
| `object/orphan` | Nothing in the design places this in the world. |
| `item/no-source` | No beat grants, sells or drops it. Only raised for types whose template declares an `obtain` section - a location has no business having a source. |

`test/validate.test.ts` gives every rule a fixture that trips it and the same fixture
corrected, because a rule that only ever fires is as useless as one that never does.

## Rendering someone's Markdown

`render.ts` turns a page into HTML, which means it is the one place where a file becomes
executable content. Three decisions hold it shut:

- **Wikilinks are a markdown-it inline rule, not a regex over the source.** A regex would
  cheerfully rewrite `[[this]]` inside a code fence, where it is meant to be shown rather
  than followed. An inline rule only runs where inline markup runs.
- **`html: false`.** Raw HTML in a page is escaped, not run. These are the user's own files,
  but "the user's own file" is exactly what an imported or shared project is not.
- **A link scheme allowlist.** markdown-it blocks `javascript:` by default; `SAFE_LINK` is
  narrower still, permitting only http, https, mailto, `basic:` and fragments.

`test/render.test.ts` covers all three, including the fence case and a `data:` URL.

## The schema is the user's

The whole brief rests on one sentence: *not all characters have the same properties*. So a
template is not a built-in — it is a YAML file the user edits, in the app, and every form,
dropdown, table column and generated section follows from it.

A field is not just a form input. A field with a `rel` **is an assertion about the graph**,
so the editor says so in words rather than hiding it: choosing a relation reads "Character
sells it", and the hint underneath a reference field says filling it in emits a relation.

`updateTemplateField` clears `to` and `rel` when a field stops being a reference, and
`options` when it stops being a choice. Otherwise the file keeps claiming a relation the
field can no longer carry — a lie that produces no error anywhere, just a link that never
appears. `validateSchema` catches the rest of that class: a field emitting a relation nobody
defined, a `to` naming no template, a section querying a group no relation belongs to, and a
relation with no inverse, since a backlink is the inverse read from the far end.

The table view edits scalars in place and shows references read-only. A reference is an
assertion and belongs where it is asserted, not in a spreadsheet cell that would quietly
rewrite someone's frontmatter.

## Two canvases, on purpose

The act's **Flow** view is a picture of what the files already say, laid out automatically.
Nothing is stored; open it and it tidies itself. It answers "how does this act hang
together".

A **canvas document** is the other thing: you choose what is on it and where, and the layout
is saved. It answers "let me work this out".

Both draw the same way, and the rule that keeps either from lying is in `drawnEdges`: real
relationships are read from the index, and the canvas file only holds positions, lines that
have not been promoted yet, and gates. A promoted edge is therefore drawn once, from the
file that asserts it - `test/canvas.test.ts` pins that down, including the case where a
leftover sketch sits alongside the real thing.

Promotion refuses with the fix rather than hiding the option. "No field on the Character
template means Drops" is the moment someone discovers their schema is missing something; a
greyed-out menu item teaches nothing.
