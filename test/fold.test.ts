/* The fold, walked one beat at a time.
 *
 * This is the mechanism that means nobody maintains a per-phase table by hand, so it is
 * tested the way you would read it: an act of six beats, and what the world looks like
 * after each one. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDoc } from '../src/core/parse-doc.ts';
import { buildIndex } from '../src/core/index-graph.ts';
import { makeProject } from '../src/core/project.ts';
import { STARTER_TEMPLATES } from '../src/core/scaffold.ts';
import { elapsedTo, existsAt, findAnachronisms, foldTo } from '../src/core/fold.ts';

const project = makeProject('Fixture', STARTER_TEMPLATES);

const page = (id: string, type: string, name: string) =>
    [`entities/${type}/${id}.md`, `---\nid: ${id}\ntype: ${type}\nname: ${name}\n---\n`] as const;

const ACT = `---
id: act_1
type: act
name: Act I
beats:
  - id: b1
    title: The gates
    introduces: ["[[governor]]"]
    opens: ["[[village]]"]
  - id: b2
    title: Igor arrives
    introduces: ["[[igor]]"]
    grants: [{ item: "[[axe]]", from: "[[igor]]", how: gift }]
  - id: b3
    title: Igor opens a stall
    sells: [{ vendor: "[[igor]]", items: ["[[rope]]", "[[nails]]"] }]
  - id: b4
    title: The herbalist
    introduces: ["[[herbalist]]"]
    opens: ["[[hollow]]"]
  - id: b5
    title: Stock arrives
    sells: [{ vendor: "[[herbalist]]", items: ["[[potion]]"] }, { vendor: "[[igor]]", items: ["[[lantern]]"] }]
  - id: b6
    title: A real blade
    grants: [{ item: "[[sword]]", from: "[[herbalist]]", how: gift }]
---

Prose.
`;

const files: Array<readonly [string, string]> = [
    page('governor', 'character', 'The Governor'),
    page('igor', 'character', 'Igor'),
    page('herbalist', 'character', 'The Herbalist'),
    page('axe', 'item', 'Wooden Axe'),
    page('rope', 'item', 'Rope'),
    page('nails', 'item', 'Nails'),
    page('lantern', 'item', 'Lantern'),
    page('potion', 'item', 'Wolfsbane Potion'),
    page('sword', 'item', 'Iron Sword'),
    page('village', 'location', 'The Village'),
    page('hollow', 'location', 'Cutters Hollow'),
    ['progression/act-1.md', ACT],
];

const index = buildIndex(files.map(([p, t]) => parseDoc(p, t)), project);
const at = (beat: string | null) => foldTo(index, project, beat);
const qualified = (bare: string) => `act_1#${bare}`;

const stockOf = (beat: string, vendor: string): string[] =>
    [...(at(qualified(beat)).stock.get(vendor) ?? [])].sort();

const sourcesOf = (beat: string, item: string): string[] =>
    (at(qualified(beat)).obtainable.get(item) ?? []).map((c) => `${c.rel} from ${c.from}`).sort();

test('the fixture is consistent, and its six beats are in order', () => {
    assert.deepEqual(index.problems, [], JSON.stringify(index.problems));
    assert.deepEqual(index.order, ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'].map(qualified));
});

test('before anything happens the world is empty, not partially built', () => {
    const world = at(null);
    assert.deepEqual(world.elapsed, []);
    assert.equal(world.introduced.size, 0);
    assert.equal(world.opened.size, 0);
    assert.equal(world.obtainable.size, 0);
    assert.equal(existsAt(world, 'igor'), false);
});

test('after b1 the governor exists and the village is open, and nothing else is', () => {
    const world = at(qualified('b1'));
    assert.deepEqual([...world.introduced.keys()], ['governor']);
    assert.deepEqual([...world.opened.keys()], ['village']);
    assert.equal(existsAt(world, 'igor'), false, 'Igor has not turned up yet');
});

test('after b2 Igor exists and the axe has exactly one source', () => {
    const world = at(qualified('b2'));
    assert.deepEqual([...world.introduced.keys()].sort(), ['governor', 'igor']);
    assert.deepEqual(sourcesOf('b2', 'axe'), ['GRANTS from igor']);
    assert.equal(world.stock.size, 0, 'nobody is selling anything yet');
});

test('after b3 Igor has stock, and it is only what b3 gave him', () => {
    assert.deepEqual(stockOf('b3', 'igor'), ['nails', 'rope']);
    assert.deepEqual(sourcesOf('b3', 'rope'), ['SELLS from igor']);
    assert.equal(at(qualified('b3')).stock.has('herbalist'), false);
});

test('after b4 the hollow is open and the herbalist exists', () => {
    const world = at(qualified('b4'));
    assert.deepEqual([...world.opened.keys()].sort(), ['hollow', 'village']);
    assert.ok(world.introduced.has('herbalist'));
    // b4 sells nothing, so stock is unchanged from b3.
    assert.deepEqual(stockOf('b4', 'igor'), ['nails', 'rope']);
});

/* The point of a fold: Igor's stock is never written down anywhere. It accumulates. */
test('after b5 stock has grown for one vendor and appeared for another', () => {
    assert.deepEqual(stockOf('b5', 'igor'), ['lantern', 'nails', 'rope']);
    assert.deepEqual(stockOf('b5', 'herbalist'), ['potion']);
});

test('after b6 the sword is obtainable and every earlier fact still holds', () => {
    const world = at(qualified('b6'));
    assert.deepEqual(sourcesOf('b6', 'sword'), ['GRANTS from herbalist']);
    assert.deepEqual(stockOf('b6', 'igor'), ['lantern', 'nails', 'rope']);
    assert.deepEqual([...world.introduced.keys()].sort(), ['governor', 'herbalist', 'igor']);
    assert.equal(world.elapsed.length, 6);
});

test('an item can accumulate more than one source as the act goes on', () => {
    // Igor gives the axe in b2; nothing else ever provides it.
    assert.equal((at(qualified('b6')).obtainable.get('axe') ?? []).length, 1);
    // The potion is only ever sold.
    assert.deepEqual(sourcesOf('b6', 'potion'), ['SELLS from herbalist']);
});

test('a cursor naming a beat that no longer exists shows everything, not nothing', () => {
    // A deleted beat must not silently empty the world - that would read as "no content".
    assert.equal(elapsedTo(index, 'act_1#deleted').length, index.order.length);
});

/* -- ordering mistakes ----------------------------------------------------- */

const BROKEN = `---
id: act_2
type: act
name: Act II
beats:
  - id: c1
    title: Selling a thing nobody has met
    sells: [{ vendor: "[[smith]]", items: ["[[hammer]]"] }]
  - id: c2
    title: The smith arrives
    introduces: ["[[smith]]"]
---
`;

test('a beat that uses an entity before it is introduced is reported', () => {
    const ix = buildIndex(
        [
            ...files.map(([p, t]) => parseDoc(p, t)),
            parseDoc('entities/character/smith.md', '---\nid: smith\ntype: character\nname: The Smith\n---\n'),
            parseDoc('entities/item/hammer.md', '---\nid: hammer\ntype: item\nname: Hammer\n---\n'),
            parseDoc('progression/act-2.md', BROKEN),
        ],
        project,
    );

    const found = findAnachronisms(ix, project);
    const smith = found.find((a) => a.entity === 'smith');
    assert.ok(smith, `expected the smith to be flagged, got ${JSON.stringify(found)}`);
    assert.equal(smith.beat, 'act_2#c1');
    assert.equal(smith.introducedBy, 'act_2#c2', 'and it should say which beat does introduce them');
});

test('a correctly ordered act reports no anachronisms', () => {
    assert.deepEqual(findAnachronisms(index, project), []);
});
