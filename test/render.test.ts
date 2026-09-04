/* Rendering a page, and the two things that must not go wrong while doing it:
 * a link that runs code, and a wikilink inside a code fence being followed. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPage, unresolvedLinks } from '../src/core/render.ts';

const KNOWN = new Set(['igor', 'wooden-axe', 'act_1#beat_01']);
const opts = {
    exists: (id: string) => KNOWN.has(id),
    displayName: (id: string) => (id === 'igor' ? 'Igor' : id),
};

const html = (text: string): string =>
    renderPage(text, opts).parts.map((p) => p.html).join('\n');

test('a wikilink becomes a link carrying the id it points at', () => {
    const out = html('Meet [[igor]] by the gate.\n');
    assert.match(out, /data-ref="igor"/);
    assert.match(out, /class="wikilink"/);
    assert.match(out, />Igor</, 'and it uses the display name');
});

test('an alias is used verbatim as the link text', () => {
    assert.match(html('Ask [[igor|the odd neighbour]] about it.\n'), />the odd neighbour</);
});

test('a link to nothing is marked, not hidden', () => {
    const out = html('Beware the [[goblin]].\n');
    assert.match(out, /class="wikilink is-missing"/);
    assert.match(out, /data-ref="goblin"/);
    assert.match(out, /title="goblin — no page yet"/);
});

/* The reason wikilinks are an inline rule rather than a regex over the source. */
test('a wikilink inside a code fence is shown, not turned into a link', () => {
    const out = html('```\nrequires: [[igor]]\n```\n');
    assert.match(out, /<code>/);
    assert.doesNotMatch(out, /data-ref/);
    assert.match(out, /\[\[igor\]\]/, 'it renders as the literal text it is');
});

test('a wikilink inside an inline code span is left alone too', () => {
    const out = html('Write `[[igor]]` to link to him.\n');
    assert.doesNotMatch(out, /data-ref/);
});

/* -- links that should not be followed ------------------------------------- */

test('a javascript: link is refused - rendered as text, never as an href', () => {
    const out = html('[click me](javascript:alert(1))\n');
    assert.doesNotMatch(out, /<a /, 'no anchor at all is the right outcome');
    // The literal text may still contain the word; what matters is nothing is clickable.
    assert.match(out, /\[click me\]/);
});

test('a data: link is refused too', () => {
    const out = html('[x](data:text/html;base64,PHNjcmlwdD4=)\n');
    assert.doesNotMatch(out, /<a /);
});

test('raw HTML in a page is escaped rather than run', () => {
    const out = html('<img src=x onerror="alert(1)">\n\nAnd <script>alert(2)</script>.\n');
    assert.doesNotMatch(out, /<img/);
    assert.doesNotMatch(out, /<script/);
    assert.match(out, /&lt;script&gt;/);
});

test('ordinary http links still work', () => {
    assert.match(html('[docs](https://example.com)\n'), /href="https:\/\/example.com"/);
});

/* -- page structure --------------------------------------------------------- */

test('frontmatter is not rendered into the page', () => {
    const out = html('---\nid: igor\ntype: character\n---\n\nHe points at the tree.\n');
    assert.doesNotMatch(out, /type: character/);
    assert.match(out, /He points at the tree\./);
});

test('generated blocks come back as their own parts, with markers stripped', () => {
    const page = `---
id: wooden-axe
---

Blunt and heavy.

<!-- basic:available-from -->
#### Available from

- **Given by** [[igor]]
<!-- /basic:available-from -->

After the block.
`;
    const { parts } = renderPage(page, opts);
    assert.deepEqual(parts.map((p) => p.kind), ['prose', 'generated', 'prose']);
    assert.equal(parts[1]!.key, 'available-from');

    const generated = parts[1]!.html;
    assert.match(generated, /Available from/);
    assert.match(generated, /data-ref="igor"/);
    assert.doesNotMatch(generated, /basic:available-from/, 'the markers are plumbing, not content');

    assert.match(parts[0]!.html, /Blunt and heavy/);
    assert.match(parts[2]!.html, /After the block/);
});

test('a page with malformed markers still renders rather than failing', () => {
    const out = html('Prose.\n\n<!-- basic:oops -->\nhalf a block\n');
    assert.match(out, /Prose\./);
    assert.match(out, /half a block/);
});

test('an empty document renders to nothing rather than throwing', () => {
    assert.deepEqual(renderPage('---\nid: x\n---\n', opts).parts, []);
});

/* -- unresolved links -------------------------------------------------------- */

test('unresolved links are listed once each, in order, skipping the ones that resolve', () => {
    const page = '---\nid: a\n---\n\nSee [[goblin]], [[igor]] and [[goblin]] again, plus [[troll|the troll]].\n';
    assert.deepEqual(unresolvedLinks(page, (id) => KNOWN.has(id)), ['goblin', 'troll']);
});

test('a link in the frontmatter is not offered for creation from the body', () => {
    const page = '---\nid: a\nhome: "[[nowhere]]"\n---\n\nNothing here.\n';
    assert.deepEqual(unresolvedLinks(page, (id) => KNOWN.has(id)), []);
});
