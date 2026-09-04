/* The M1 acceptance test.
 *
 * A beat in a progression document says Igor hands over the axe. Nobody types a
 * relationship into the axe's page - it grows one by itself, naming Igor and
 * the beat that claimed it. That is the whole product in one test. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDoc } from '../src/core/parse-doc.ts';
import { buildIndex } from '../src/core/index-graph.ts';
import { makeProject } from '../src/core/project.ts';
import { renderSections } from '../src/core/generate.ts';
import { applyBlocks } from '../src/core/write-doc.ts';
import { STARTER_TEMPLATES } from '../src/core/scaffold.ts';

const project = makeProject('Fixture', STARTER_TEMPLATES);

const files: Record<string, string> = {
    'entities/character/igor.md': `---
id: igor
type: character
name: Igor
role: Odd neighbour who becomes a vendor
home: "[[cutters-hollow]]"
---

He points at the only tree on the farm and is delighted when it dies.
`,
    'entities/item/wooden-axe.md': `---
id: wooden-axe
type: item
name: Wooden Axe
value: 12
---

The first tool the player owns.
`,
    'entities/location/cutters-hollow.md': `---
id: cutters-hollow
type: location
name: Cutters Hollow
---
`,
    'progression/act-1.md': `---
id: act_1
type: act
name: Act I
beats:
  - id: beat_01_03
    title: Igor turns up uninvited
    status: pending
    verify: "flag igor_met is set and [[wooden-axe]] is in the player's inventory"
    introduces: ["[[igor]]"]
    grants: [{ item: "[[wooden-axe]]", from: "[[igor]]", how: gift }]
    opens: ["[[cutters-hollow]]"]
---

Igor arrives on the player's land.
`,
};

const index = () =>
    buildIndex(Object.entries(files).map(([p, t]) => parseDoc(p, t)), project);

/** Regenerate one page the way the app does: query the index, rewrite blocks. */
function regenerate(path: string, id: string, text: string): string {
    const result = applyBlocks(text, renderSections(index(), project, id), path);
    assert.equal(result.ok, true, 'a well-formed page must be writable');
    return result.ok ? result.text : '';
}

test('the fixture project is internally consistent', () => {
    assert.deepEqual(index().problems, []);
});

test('the item page grows its own Available from block, naming the giver and the beat', () => {
    const out = regenerate('entities/item/wooden-axe.md', 'wooden-axe', files['entities/item/wooden-axe.md']!);

    assert.match(out, /<!-- basic:available-from -->/);
    assert.match(out, /#### Available from/);
    assert.match(out, /\*\*Given by\*\* \[\[igor\|Igor\]\]/);
    // Provenance: the beat that claimed it is linked, not just asserted.
    assert.match(out, /\[\[act_1#beat_01_03\|Igor turns up uninvited\]\]/);

    // The author's prose is untouched, and the frontmatter never gained a relation.
    assert.match(out, /The first tool the player owns\./);
    assert.doesNotMatch(out.split('---')[1] ?? '', /igor/);
});

test('a section with nothing to show says so rather than rendering an empty list', () => {
    const out = regenerate('entities/item/wooden-axe.md', 'wooden-axe', files['entities/item/wooden-axe.md']!);
    const usedIn = out.split('<!-- basic:used-in -->')[1]?.split('<!-- /basic:used-in -->')[0] ?? '';
    assert.match(usedIn, /_Nothing yet\._/);
});

test('the character page shows what it gives, from the same single assertion', () => {
    const out = regenerate('entities/character/igor.md', 'igor', files['entities/character/igor.md']!);
    assert.match(out, /#### Gives and sells/);
    assert.match(out, /\*\*Grants\*\* \[\[wooden-axe\|Wooden Axe\]\]/);
    assert.match(out, /#### Appears in/);
    assert.match(out, /\*\*Introduced in\*\* \[\[act_1#beat_01_03\|Igor turns up uninvited\]\]/);
});

test('the location page lists what is inside it and what opened it', () => {
    const out = regenerate('entities/location/cutters-hollow.md', 'cutters-hollow', files['entities/location/cutters-hollow.md']!);
    assert.match(out, /#### Contains\n\n- \*\*Contains\*\* \[\[igor\|Igor\]\]/);
    assert.match(out, /\*\*Opened by\*\* \[\[act_1#beat_01_03\|Igor turns up uninvited\]\]/);
});

test('regenerating a second time changes nothing', () => {
    const once = regenerate('entities/item/wooden-axe.md', 'wooden-axe', files['entities/item/wooden-axe.md']!);
    const twice = applyBlocks(once, renderSections(index(), project, 'wooden-axe'));
    assert.equal(twice.ok && twice.changed, false, 'the page must settle after one pass');
    assert.equal(twice.ok && twice.text, once);
});

test('editing prose around a generated block does not disturb the block', () => {
    const once = regenerate('entities/item/wooden-axe.md', 'wooden-axe', files['entities/item/wooden-axe.md']!);
    const edited = once.replace('The first tool the player owns.', 'The first tool. Blunt, heavy, and slow.');
    const again = applyBlocks(edited, renderSections(index(), project, 'wooden-axe'));
    assert.equal(again.ok && again.changed, false);
    assert.match(again.ok ? again.text : '', /Blunt, heavy, and slow\./);
});

test('removing the beat removes the claim from the item page', () => {
    const withBeat = regenerate('entities/item/wooden-axe.md', 'wooden-axe', files['entities/item/wooden-axe.md']!);
    assert.match(withBeat, /Given by/);

    const before = files['progression/act-1.md']!;
    files['progression/act-1.md'] = before.replace(/  - id: beat_01_03[\s\S]*?opens:.*\n/, '');
    try {
        const out = applyBlocks(withBeat, renderSections(index(), project, 'wooden-axe'));
        assert.equal(out.ok && out.changed, true);
        assert.doesNotMatch(out.ok ? out.text : '', /Given by/);
        assert.match(out.ok ? out.text : '', /#### Available from\n\n_Nothing yet\._/);
    } finally {
        files['progression/act-1.md'] = before;
    }
});
