import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDoc } from '../src/core/parse-doc.ts';
import { buildIndex, incoming, outgoing } from '../src/core/index-graph.ts';
import { makeProject } from '../src/core/project.ts';
import type { Template } from '../src/core/types.ts';

const character: Template = {
    id: 'character', label: 'Character',
    fields: [{ key: 'home', label: 'Home', type: 'ref', to: ['location'], rel: 'LOCATED_IN' }],
};
const item: Template = { id: 'item', label: 'Item', fields: [{ key: 'value', label: 'Value', type: 'number' }] };
const location: Template = { id: 'location', label: 'Location', fields: [] };

const project = makeProject('Test', [character, item, location]);

const igor = `---
id: igor
type: character
name: Igor
home: "[[cutters-hollow]]"
---

He points at the only tree. See also [[wooden-axe]].
`;

const axe = `---
id: wooden-axe
type: item
name: Wooden Axe
value: 12
---

A blunt thing.
`;

const hollow = `---
id: cutters-hollow
type: location
name: Cutters Hollow
---
`;

const act = `---
id: act_1
type: act
name: "Act I"
beats:
  - id: beat_01_01
    title: The gates
    status: complete
    verify: flag entered_gates is set
  - id: beat_01_03
    title: Igor turns up uninvited
    status: pending
    requires: { all: [{ flag: entered_gates }, { done: beat_01_01 }] }
    introduces: ["[[igor]]"]
    grants: [{ item: "[[wooden-axe]]", from: "[[igor]]", how: gift }]
    sells: [{ vendor: "[[igor]]", items: ["[[wooden-axe]]"] }]
    opens: ["[[cutters-hollow]]"]
---

Prose overview.
`;

const build = (files: Array<[string, string]>) =>
    buildIndex(files.map(([p, t]) => parseDoc(p, t)), project);

const world = () => build([
    ['entities/character/igor.md', igor],
    ['entities/item/wooden-axe.md', axe],
    ['entities/location/cutters-hollow.md', hollow],
    ['progression/act-1.md', act],
]);

test('objects, acts and beats all become nodes', () => {
    const ix = world();
    assert.deepEqual(
        [...ix.nodes.keys()].sort(),
        ['act_1', 'act_1#beat_01_01', 'act_1#beat_01_03', 'cutters-hollow', 'igor', 'wooden-axe'],
    );
    assert.equal(ix.nodes.get('act_1#beat_01_03')!.kind, 'beat');
    assert.equal(ix.nodes.get('act_1#beat_01_03')!.name, 'Igor turns up uninvited');
    assert.equal(ix.problems.length, 0, JSON.stringify(ix.problems));
});

test('beats are ordered, which is what makes the fold possible', () => {
    assert.deepEqual(world().order, ['act_1#beat_01_01', 'act_1#beat_01_03']);
});

test('a template ref field emits its declared relation', () => {
    const edge = outgoing(world(), 'igor', ['LOCATED_IN'])[0];
    assert.equal(edge?.to, 'cutters-hollow');
    assert.equal(edge?.source.kind, 'frontmatter');
    assert.equal(edge?.source.locator, 'home');
});

/* The point of the whole design: the beat says Igor grants the axe, so the edge
 * runs Igor -> axe, and the axe's page can name the beat that claimed it. */
test('a beat asserts a relation between two OTHER things and is remembered as the source', () => {
    const ix = world();
    const grant = incoming(ix, 'wooden-axe', ['GRANTS'])[0];
    assert.equal(grant?.from, 'igor');
    assert.equal(grant?.beat, 'act_1#beat_01_03');
    assert.equal(grant?.source.kind, 'beat');
    assert.equal(grant?.source.locator, 'beat_01_03');
    assert.equal(grant?.source.file, 'progression/act-1.md');
});

test('sells names a vendor, and the edge runs from the vendor', () => {
    const sell = incoming(world(), 'wooden-axe', ['SELLS'])[0];
    assert.equal(sell?.from, 'igor');
    assert.equal(sell?.beat, 'act_1#beat_01_03');
});

test('introduces and opens run from the beat itself', () => {
    const ix = world();
    assert.equal(outgoing(ix, 'act_1#beat_01_03', ['INTRODUCES'])[0]?.to, 'igor');
    assert.equal(outgoing(ix, 'act_1#beat_01_03', ['OPENS'])[0]?.to, 'cutters-hollow');
});

test('a requirement naming a bare beat id resolves to the qualified beat', () => {
    const req = outgoing(world(), 'act_1#beat_01_03', ['REQUIRES']);
    assert.deepEqual(req.map((e) => e.to), ['act_1#beat_01_01']);
});

test('a wikilink in prose is a soft MENTIONS edge, not an assertion', () => {
    const ix = world();
    const mention = outgoing(ix, 'igor', ['MENTIONS'])[0];
    assert.equal(mention?.to, 'wooden-axe');
    assert.equal(mention?.source.kind, 'prose');
});

test('a reference to something that does not exist is reported, not silently dropped', () => {
    const ix = build([['progression/act-1.md', act]]);
    const unknown = ix.problems.filter((p) => p.rule === 'ref/unknown').map((p) => p.locator);
    assert.ok(unknown.includes('beat_01_03.introduces'), JSON.stringify(unknown));
    assert.ok(ix.problems.every((p) => p.file === 'progression/act-1.md'));
});

test('two documents claiming the same id is an error, not a last-one-wins', () => {
    const ix = build([['a.md', axe], ['b.md', axe]]);
    assert.equal(ix.problems.filter((p) => p.rule === 'doc/duplicate-id').length, 1);
});

test('an object whose type has no template is reported', () => {
    const ix = build([['x.md', '---\nid: x\ntype: dragon\n---\n']]);
    assert.equal(ix.problems[0]?.rule, 'doc/unknown-type');
});

test('unparseable frontmatter is a problem, not a crash', () => {
    const ix = build([['bad.md', '---\nid: [unclosed\n---\n\nbody\n']]);
    assert.equal(ix.problems[0]?.rule, 'doc/frontmatter');
});
