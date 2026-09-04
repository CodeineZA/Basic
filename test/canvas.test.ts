/* The canvas document, and the rule that keeps it from disagreeing with the files.
 *
 * A canvas owns positions and unpromoted lines. Everything real is read from the index, so
 * the thing most worth testing is that a promoted edge appears exactly once. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDoc } from '../src/core/parse-doc.ts';
import { buildIndex } from '../src/core/index-graph.ts';
import { makeProject } from '../src/core/project.ts';
import { STARTER_TEMPLATES } from '../src/core/scaffold.ts';
import {
    addSketch, drawnEdges, moveNode, newCanvas, parseCanvas, placeNode, removeEdge,
    removeNode, serialiseCanvas, setRequirement,
} from '../src/core/canvas.ts';
import { planDemotion, planPromotion, promotableRelations } from '../src/core/promote.ts';

const project = makeProject('Fixture', STARTER_TEMPLATES);

const page = (id: string, type: string, name: string, extra = '') =>
    [`entities/${type}/${id}.md`, `---\nid: ${id}\ntype: ${type}\nname: ${name}\n${extra}---\n`] as const;

const files = [
    page('igor', 'character', 'Igor'),
    page('axe', 'item', 'Wooden Axe'),
    page('hollow', 'location', 'Cutters Hollow'),
    ['progression/act-1.md', `---
id: act_1
type: act
name: Act I
beats:
  - id: b1
    title: Igor arrives
    status: pending
    verify: flag igor_met
---
`] as const,
];

const index = buildIndex(files.map(([p, t]) => parseDoc(p, t)), project);

const withNodes = (...refs: string[]) =>
    refs.reduce((c, ref, i) => placeNode(c, ref, i * 300, 0), newCanvas('c1', 'Canvas'));

/* -- the document ----------------------------------------------------------- */

test('positions snap to the grid so cards line up without effort', () => {
    const c = placeNode(newCanvas('c1', 'C'), 'igor', 53, 71);
    assert.deepEqual(c.nodes[0], { ref: 'igor', x: 48, y: 64 });
});

test('placing the same thing twice is a no-op, since a canvas shows it once', () => {
    const once = placeNode(newCanvas('c1', 'C'), 'igor', 0, 0);
    assert.equal(placeNode(once, 'igor', 400, 400), once);
});

test('moving a card changes only that card, and an unchanged move is not a change', () => {
    const c = withNodes('igor', 'axe');
    const moved = moveNode(c, 'igor', 160, 96);
    assert.deepEqual(moved.nodes.find((n) => n.ref === 'igor'), { ref: 'igor', x: 160, y: 96 });
    assert.deepEqual(moved.nodes.find((n) => n.ref === 'axe'), c.nodes.find((n) => n.ref === 'axe'));
    assert.equal(moveNode(moved, 'igor', 163, 95), moved, 'snapping to the same cell is no change');
});

test('removing a card takes the lines that needed it', () => {
    const c = addSketch(withNodes('igor', 'axe'), 'igor', 'axe');
    const after = removeNode(c, 'axe');
    assert.equal(after.nodes.length, 1);
    assert.equal(after.edges.length, 0, 'a line to nothing is not a line');
});

test('a card cannot be linked to itself', () => {
    const c = withNodes('igor');
    assert.equal(addSketch(c, 'igor', 'igor'), c);
});

test('a canvas round-trips through its file, and a damaged one opens empty rather than throwing', () => {
    const c = addSketch(withNodes('igor', 'axe'), 'igor', 'axe');
    const back = parseCanvas('c1', serialiseCanvas(c));

    // Order is not preserved on purpose - serialising sorts, so a moved card produces a
    // small diff. What must survive is the content, and writing again must not churn.
    assert.deepEqual(new Set(back.nodes.map((n) => JSON.stringify(n))), new Set(c.nodes.map((n) => JSON.stringify(n))));
    assert.deepEqual(back.edges, c.edges);
    assert.equal(serialiseCanvas(back), serialiseCanvas(c), 'writing twice is byte-identical');

    const broken = parseCanvas('c1', '{ not json');
    assert.deepEqual(broken.nodes, []);
    assert.deepEqual(broken.edges, []);
});

test('serialising is stable, so nudging one card does not rewrite the whole file', () => {
    const a = serialiseCanvas(withNodes('axe', 'igor', 'hollow'));
    const b = serialiseCanvas(withNodes('hollow', 'igor', 'axe'));
    // Same three cards in the same places, listed in a different order: same bytes.
    assert.equal(a.replace(/\d+/g, 'N'), b.replace(/\d+/g, 'N'));
});

/* -- what gets drawn --------------------------------------------------------- */

test('a sketch is drawn as a line with no meaning yet', () => {
    const drawn = drawnEdges(addSketch(withNodes('igor', 'axe'), 'igor', 'axe'), index);
    assert.equal(drawn.length, 1);
    assert.equal(drawn[0]!.sketch, true);
    assert.equal(drawn[0]!.rel, null);
});

test('a real relationship is drawn from the index, and names where it is asserted', () => {
    const withHome = buildIndex(
        [
            parseDoc('entities/character/igor.md', '---\nid: igor\ntype: character\nname: Igor\nhome: "[[hollow]]"\n---\n'),
            ...files.slice(1).map(([p, t]) => parseDoc(p, t)),
        ],
        project,
    );
    const drawn = drawnEdges(withNodes('igor', 'hollow'), withHome);
    assert.equal(drawn.length, 1);
    assert.equal(drawn[0]!.sketch, false);
    assert.equal(drawn[0]!.rel, 'LOCATED_IN');
    assert.equal(drawn[0]!.source?.file, 'entities/character/igor.md');
    assert.equal(drawn[0]!.source?.locator, 'home');
});

/* The rule the whole design rests on. */
test('a promoted edge is drawn ONCE, not once from the file and once from the canvas', () => {
    const withHome = buildIndex(
        [
            parseDoc('entities/character/igor.md', '---\nid: igor\ntype: character\nname: Igor\nhome: "[[hollow]]"\n---\n'),
            ...files.slice(1).map(([p, t]) => parseDoc(p, t)),
        ],
        project,
    );
    // A leftover sketch between the same two cards must not double the line.
    const canvas = addSketch(withNodes('igor', 'hollow'), 'igor', 'hollow');
    const drawn = drawnEdges(canvas, withHome);
    assert.equal(drawn.length, 1, JSON.stringify(drawn));
    assert.equal(drawn[0]!.sketch, false, 'the real one wins');
});

test('an edge between cards that are not both on the canvas is not drawn', () => {
    const drawn = drawnEdges(addSketch(withNodes('igor'), 'igor', 'axe'), index);
    assert.deepEqual(drawn, []);
});

test('a requirement rides along with the edge it gates', () => {
    let canvas = addSketch(withNodes('igor', 'axe'), 'igor', 'axe');
    canvas = setRequirement(canvas, 'igor', 'axe', undefined, { flag: 'met_igor' });
    assert.deepEqual(drawnEdges(canvas, index)[0]!.requirement, { flag: 'met_igor' });

    // Clearing it removes the annotation entirely rather than leaving an empty one.
    canvas = setRequirement(canvas, 'igor', 'axe', undefined, null);
    assert.equal(canvas.edges.length, 0);
});

test('removing an edge leaves the cards alone', () => {
    const c = addSketch(withNodes('igor', 'axe'), 'igor', 'axe');
    const after = removeEdge(c, 'igor', 'axe');
    assert.equal(after.edges.length, 0);
    assert.equal(after.nodes.length, 2);
});

/* -- promotion ---------------------------------------------------------------- */

test('a relation with a matching field is written to the source page', () => {
    const r = planPromotion(index, project, 'igor', 'hollow', 'LOCATED_IN');
    assert.equal(r.ok, true, r.ok ? '' : r.reason);
    if (!r.ok) return;

    assert.equal(r.promotion.path, 'entities/character/igor.md');
    assert.match(r.promotion.describe, /Igor · Home → Cutters Hollow/);

    const applied = r.promotion.edit('---\nid: igor\ntype: character\nname: Igor\n---\n\nProse.\n', 'x.md');
    assert.equal(applied.ok, true);
    assert.match(applied.ok ? applied.text : '', /home: "\[\[hollow\]\]"/);
    assert.match(applied.ok ? applied.text : '', /Prose\./, 'the page body is untouched');
});

/* Refusing with the fix is the point: this is the moment someone finds out their template
 * is missing something, and a disabled menu item would not tell them. */
test('a relation with no field to carry it is refused, and the refusal names the fix', () => {
    const r = planPromotion(index, project, 'igor', 'axe', 'DROPS');
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.reason : '', /No field on the Character template means "Drops"/);
    assert.match(!r.ok ? r.reason : '', /Add one in the Character template/);
});

test('a field that points at one kind of thing refuses another', () => {
    // Home points at a location; an item is not one.
    const r = planPromotion(index, project, 'igor', 'axe', 'LOCATED_IN');
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.reason : '', /points at Location, and 'Wooden Axe' is not one/);
});

test('a beat can introduce and open, and is told plainly why it cannot grant', () => {
    const intro = planPromotion(index, project, 'act_1#b1', 'igor', 'INTRODUCES');
    assert.equal(intro.ok, true, intro.ok ? '' : intro.reason);
    assert.equal(intro.ok && intro.promotion.describe, 'Igor arrives introduces Igor');

    const grants = planPromotion(index, project, 'act_1#b1', 'axe', 'GRANTS');
    assert.equal(grants.ok, false);
    assert.match(!grants.ok ? grants.reason : '', /name whoever hands the thing over/);
});

test('promoting something already true is refused rather than duplicated', () => {
    const withHome = buildIndex(
        [
            parseDoc('entities/character/igor.md', '---\nid: igor\ntype: character\nname: Igor\nhome: "[[hollow]]"\n---\n'),
            ...files.slice(1).map(([p, t]) => parseDoc(p, t)),
        ],
        project,
    );
    const r = planPromotion(withHome, project, 'igor', 'hollow', 'LOCATED_IN');
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.reason : '', /already has 'Cutters Hollow'/);
});

test('the picker only offers relations that would actually work', () => {
    const offered = promotableRelations(index, project, 'igor', 'hollow');
    assert.deepEqual(offered, ['LOCATED_IN']);

    // Nothing on the Character template can carry a link to an item yet.
    assert.deepEqual(promotableRelations(index, project, 'igor', 'axe'), []);
});

test('a promoted link can be taken back out of the file it was written to', () => {
    const withHome = buildIndex(
        [
            parseDoc('entities/character/igor.md', '---\nid: igor\ntype: character\nname: Igor\nhome: "[[hollow]]"\n---\n'),
            ...files.slice(1).map(([p, t]) => parseDoc(p, t)),
        ],
        project,
    );
    const r = planDemotion(withHome, project, 'igor', 'hollow', 'LOCATED_IN');
    assert.equal(r.ok, true, r.ok ? '' : r.reason);
    if (!r.ok) return;

    const applied = r.promotion.edit('---\nid: igor\ntype: character\nname: Igor\nhome: "[[hollow]]"\n---\n\nProse.\n', 'x.md');
    assert.doesNotMatch(applied.ok ? applied.text : '', /home:/);
    assert.match(applied.ok ? applied.text : '', /Prose\./);
});
