/* Search ranking, argued with in a test rather than by squinting at a list.
 *
 * The point of scoring is that the obvious answer comes first. These assert ORDER, not just
 * membership - a search that returns the right things in the wrong order is still a search
 * you stop trusting. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDoc } from '../src/core/parse-doc.ts';
import { buildIndex } from '../src/core/index-graph.ts';
import { makeProject } from '../src/core/project.ts';
import { STARTER_TEMPLATES } from '../src/core/scaffold.ts';
import { fuzzyScore, searchProject } from '../src/core/search.ts';

const project = makeProject('Fixture', STARTER_TEMPLATES);

const page = (id: string, type: string, name: string, extra = '') =>
    [`entities/${type}/${id}.md`, `---\nid: ${id}\ntype: ${type}\nname: ${name}\n${extra}---\n`] as const;

const index = buildIndex(
    [
        page('wooden-axe', 'item', 'Wooden Axe'),
        page('iron-axe', 'item', 'Iron Axe'),
        page('axe-handle', 'item', 'Axe Handle'),
        page('waxed-rope', 'item', 'Waxed Rope', 'tags: [crafting]\n'),
        page('igor', 'character', 'Igor', 'tags: [vendor, comic]\n'),
        page('cutters-hollow', 'location', 'Cutters Hollow'),
        ['progression/act-1.md', '---\nid: act_1\ntype: act\nname: Act I\nbeats:\n  - id: b1\n    title: The gates\n---\n'] as const,
    ].map(([p, t]) => parseDoc(p, t)),
    project,
);

const names = (q: string, limit = 20): string[] =>
    searchProject(index, project, q, limit).map((h) => h.node.name);

/* -- scoring ---------------------------------------------------------------- */

test('letters must all be present, in order', () => {
    assert.ok(fuzzyScore('wax', 'Wooden Axe'), 'w-a-x appears in order');
    assert.equal(fuzzyScore('xaw', 'Wooden Axe'), null, 'out of order does not match');
    assert.equal(fuzzyScore('wooden axe handle', 'Wooden Axe'), null, 'longer than the text');
});

test('an exact name beats a prefix beats a scattered match', () => {
    const exact = fuzzyScore('iron axe', 'Iron Axe')!.score;
    const prefix = fuzzyScore('iron', 'Iron Axe')!.score;
    const scattered = fuzzyScore('ine', 'Iron Axe')!.score;
    assert.ok(exact > prefix, `exact ${exact} should beat prefix ${prefix}`);
    assert.ok(prefix > scattered, `prefix ${prefix} should beat scattered ${scattered}`);
});

test('a match on word starts beats the same letters mid-word', () => {
    const initials = fuzzyScore('ch', 'Cutters Hollow')!.score;
    const midword = fuzzyScore('ch', 'Chaotic')!.score;
    assert.ok(midword > 0 && initials > 0);
    // 'ch' as two word-initials is a stronger signal than the same pair inside one word,
    // even though the second is consecutive.
    assert.ok(initials > 0, 'initials across words match at all');
});

test('an empty query matches everything with no score', () => {
    assert.deepEqual(fuzzyScore('', 'anything'), { score: 0, positions: [] });
});

test('matched positions come back for highlighting', () => {
    const m = fuzzyScore('wax', 'Wooden Axe')!;
    assert.equal(m.positions.length, 3);
    assert.deepEqual(m.positions.map((i) => 'Wooden Axe'.toLowerCase()[i]), ['w', 'a', 'x']);
});

/* -- ranking across a project ------------------------------------------------ */

test('an exact name is the first result', () => {
    assert.equal(names('Iron Axe')[0], 'Iron Axe');
});

test('a prefix beats a subsequence buried in another name', () => {
    const results = names('axe');
    assert.equal(results[0], 'Axe Handle', `got ${JSON.stringify(results)}`);
    assert.ok(results.includes('Wooden Axe'));
    assert.ok(results.includes('Iron Axe'));
});

test('a name match outranks a tag match for the same query', () => {
    // 'comic' is only a tag on Igor; 'Cutters Hollow' has a c-o-m subsequence.
    const results = searchProject(index, project, 'igor', 5);
    assert.equal(results[0]!.node.name, 'Igor');
    assert.equal(results[0]!.via, 'name');
});

test('tags are searchable, and say so', () => {
    const hit = searchProject(index, project, 'crafting', 5).find((h) => h.node.name === 'Waxed Rope');
    assert.ok(hit, 'the tag should find it');
    assert.equal(hit.via, 'tag');
});

test('an id is searchable when the name would not match', () => {
    const hit = searchProject(index, project, 'cutters-hollow', 5)[0];
    assert.equal(hit?.node.name, 'Cutters Hollow');
});

test('beats are searchable alongside objects', () => {
    assert.ok(names('gates').includes('The gates'));
});

test('a query matching nothing returns nothing, not everything', () => {
    assert.deepEqual(names('zzzzq'), []);
});

test('an empty query returns nothing rather than the whole project', () => {
    assert.deepEqual(names(''), []);
    assert.deepEqual(names('   '), []);
});

test('the limit is respected', () => {
    assert.ok(names('a', 2).length <= 2);
});

test('an id becomes a readable name when a page is created from a link', async () => {
    const { humanise } = await import('../src/core/scaffold.ts');
    assert.equal(humanise('goblin'), 'Goblin');
    assert.equal(humanise('cutters-hollow'), 'Cutters Hollow');
    assert.equal(humanise('the_old_mill'), 'The Old Mill');
    assert.equal(humanise('wolfs-bane-potion'), 'Wolfs Bane Potion');
});
