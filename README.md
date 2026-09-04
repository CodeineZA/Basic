# Basic

A desktop workbench for designing a game's progression — a wiki that writes its own
cross-references.

Most tools solve half of this. articy:draft has entity templates and a flow editor but is a
closed silo. Obsidian has linked Markdown but no gated flow graph. n8n has the canvas
interaction model but no domain model. Basic is the three together, over plain Markdown
files you own.

## The idea

There are two kinds of document, over one graph.

**Object pages** are nouns — a character, an item, a location, a mob, whatever your
templates describe. **Progression documents** are time: an act, and the beats inside it that
say what becomes true and when.

A fact is asserted once, in the beat where it happens:

```yaml
- id: beat_01_03
  title: Igor turns up uninvited
  status: pending
  verify: "flag igor_met is set and [[wooden-axe]] is in the player's inventory"
  introduces: ["[[igor]]"]
  grants: [{ item: "[[wooden-axe]]", from: "[[igor]]", how: gift }]
  opens: ["[[cutters-hollow]]"]
```

Nobody then types a relationship into an object page. The axe's page grows an **Available
from** section naming Igor and linking back to the beat that claimed it. Igor's page grows
**Gives and sells**. The location's page grows **Contains**. Delete the beat and all three
empty themselves.

Every generated row names its source, so a link you disagree with can be traced to the
document that asserted it. That provenance is the point: a link you cannot get back to is a
link you cannot correct.

## How it stays honest

- **One link syntax.** `[[id]]` works in frontmatter and in prose, so a hand-typed link in a
  paragraph and a structured field enter the graph through the same door.
- **Managed blocks.** Generated sections live between `<!-- basic:key -->` markers. Basic
  only ever touches text between matched markers, writing twice is byte-identical, and a
  file whose markers are malformed is refused rather than guessed at. In the editor those
  blocks are read-only, so regeneration can never land on top of your typing.
- **No view owns data.** The canvas renders index queries; an editor tab holds a text
  buffer. Two views of the same act cannot disagree, because there is only one copy.
- **Edits flow both ways.** Change the flow chart and the wiki updates. Edit the Markdown by
  hand, in Basic or in any other editor, and the graph picks it up.

## Running it

```bash
npm install
npm run dev            # the whole UI in a browser, against an in-memory project
npm run electron:dev   # the desktop app (expects the dev server running)
npm test               # node --test over the pure core
npm run pack           # a Windows installer into release/
```

Requires Node 24 or later — Basic runs its TypeScript tests through Node's own type
stripping, with no build step and no test framework.

## Status

Milestone one. The loop works end to end and is verified: templates, object pages, a
progression document with beats, the graph index with provenance, generated sections, the
canvas, and the editor.

Still to come: saved canvas layouts, drawing and promoting new connections, the fold that
derives world state at any beat, and a developer mode with a build board and per-beat
implementation status.

## Licence

MIT.
