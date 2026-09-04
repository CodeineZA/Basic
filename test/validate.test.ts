/* The findings that justify the tool.
 *
 * A referential check ("this link goes nowhere") is something any wiki could do. Everything
 * here needs the ORDER of the progression, which is the thing Basic knows and a pile of
 * Markdown does not - so these are the tests that say the design is worth its complexity.
 *
 * Each rule gets a fixture that trips it AND the same fixture corrected, because a rule that
 * only ever fires is as useless as one that never does. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDoc } from '../src/core/parse-doc.ts';
import { buildIndex } from '../src/core/index-graph.ts';
import { makeProject } from '../src/core/project.ts';
import { STARTER_TEMPLATES } from '../src/core/scaffold.ts';
import { canComplete, rollupOf, validateProject } from '../src/core/validate.ts';

const project = makeProject('Fixture', STARTER_TEMPLATES);
const STATUSES = project.statuses;

const page = (id: string, type: string, name: string) =>
    [`entities/${type}/${id}.md`, `---\nid: ${id}\ntype: ${type}\nname: ${name}\n---\n`] as const;

const WORLD = [
    page('igor', 'character', 'Igor'),
    page('smith', 'character', 'The Smith'),
    page('axe', 'item', 'Wooden Axe'),
    page('hammer', 'item', 'Hammer'),
    page('village', 'location', 'The Village'),
];

const build = (act: string, extra: Array<readonly [string, string]> = []) =>
    buildIndex(
        [...WORLD, ...extra, ['progression/act-1.md', act] as const].map(([p, t]) => parseDoc(p, t)),
        project,
    );

const rules = (act: string, extra?: Array<readonly [string, string]>): string[] =>
    validateProject(build(act, extra), project).map((p) => p.rule);

/** A well-formed act that trips nothing, used as the baseline. */
const CLEAN = `---
id: act_1
type: act
name: Act I
beats:
  - id: b1
    title: Arrival
    status: complete
    verify: flag arrived is set
    introduces: ["[[igor]]"]
    opens: ["[[village]]"]
  - id: b2
    title: The axe
    status: pending
    verify: the player is holding the axe
    requires: { all: [{ done: b1 }] }
    grants: [{ item: "[[axe]]", from: "[[igor]]" }]
  - id: b3
    title: The smith
    status: pending
    verify: the smith is in the village
    introduces: ["[[smith]]"]
    sells: [{ vendor: "[[smith]]", items: ["[[hammer]]"] }]
---
`;

test('a well-formed act reports nothing at all', () => {
    assert.deepEqual(rules(CLEAN), [], JSON.stringify(validateProject(build(CLEAN), project), null, 1));
});

/* -- done has to mean something ------------------------------------------- */

test('a beat marked complete with no verify is an error', () => {
    const act = CLEAN.replace(`    status: pending
    verify: the player is holding the axe`, '    status: complete');
    const found = validateProject(build(act), project).filter((p) => p.rule === 'beat/complete-without-verify');
    assert.equal(found.length, 1);
    assert.match(found[0]!.message, /no way to tell whether it works/);
    assert.equal(found[0]!.locator, 'b2', 'and it names the beat');
});

test('canComplete refuses an empty or whitespace verify, and allows a real one', () => {
    const ix = build(CLEAN);
    assert.equal(canComplete(ix.nodes.get('act_1#b1')!), true);

    const blank = build(CLEAN.replace('verify: flag arrived is set', 'verify: "   "'));
    assert.equal(canComplete(blank.nodes.get('act_1#b1')!), false);
});

/* -- content nobody can ever reach ---------------------------------------- */

test('a beat requiring one that happens later can never be reached', () => {
    const act = CLEAN.replace('requires: { all: [{ done: b1 }] }', 'requires: { all: [{ done: b3 }] }');
    const found = validateProject(build(act), project).filter((p) => p.rule === 'beat/unreachable');
    assert.equal(found.length, 1);
    assert.match(found[0]!.message, /happens later/);
});

test('a beat requiring itself is reported as such', () => {
    const act = CLEAN.replace('requires: { all: [{ done: b1 }] }', 'requires: { all: [{ done: b2 }] }');
    const found = validateProject(build(act), project).filter((p) => p.rule === 'beat/unreachable');
    assert.equal(found.length, 1);
    assert.match(found[0]!.message, /requires itself/);
});

test('requiring an EARLIER beat is fine, which is the whole point of ordering', () => {
    assert.ok(!rules(CLEAN).includes('beat/unreachable'));
});

/* -- using something before it exists -------------------------------------- */

test('a vendor selling before anyone has met them is an anachronism, and it names the fix', () => {
    // Move the smith's shop before the beat that introduces him.
    const act = `---
id: act_1
type: act
name: Act I
beats:
  - id: b1
    title: The stall
    status: pending
    verify: the stall is open
    sells: [{ vendor: "[[smith]]", items: ["[[hammer]]"] }]
  - id: b2
    title: The smith
    status: pending
    verify: the smith is in the village
    introduces: ["[[smith]]"]
---
`;
    const found = validateProject(build(act), project).filter((p) => p.rule === 'beat/anachronism');
    assert.ok(found.length >= 1, JSON.stringify(found));
    assert.match(found[0]!.message, /before 'The smith' introduces them/);
});

test('the same act in the right order reports no anachronism', () => {
    assert.ok(!rules(CLEAN).includes('beat/anachronism'));
});

/* -- things nobody can get ------------------------------------------------- */

test('an item with no source is a warning, and a location is not', () => {
    // The hammer exists and is sold; give a fourth item that nothing provides.
    const found = validateProject(
        build(CLEAN, [page('sword', 'item', 'Iron Sword')]),
        project,
    );
    const orphan = found.filter((p) => p.rule === 'object/orphan');
    assert.equal(orphan.length, 1, 'the sword is placed nowhere at all');
    assert.match(orphan[0]!.message, /Iron Sword/);
    // The village is a location; it has no "source" and must not be nagged about one.
    assert.ok(!found.some((p) => p.rule === 'item/no-source' && p.message.includes('Village')));
});

test('an item that is referenced but never obtainable is flagged separately from an orphan', () => {
    // The axe is only ever MENTIONED, never granted.
    const act = CLEAN.replace('    grants: [{ item: "[[axe]]", from: "[[igor]]" }]\n', '');
    const found = validateProject(build(act), project);
    assert.ok(found.some((p) => p.rule === 'object/orphan' && p.message.includes('Wooden Axe')),
        JSON.stringify(found.map((f) => `${f.rule}: ${f.message}`), null, 1));
});

/* -- a beat that does nothing ---------------------------------------------- */

test('a beat that changes nothing is a warning', () => {
    const act = `---
id: act_1
type: act
name: Act I
beats:
  - id: b1
    title: A quiet afternoon
    status: pending
    verify: nothing happens
---
`;
    const found = validateProject(build(act), project).filter((p) => p.rule === 'beat/asserts-nothing');
    assert.equal(found.length, 1);
    assert.match(found[0]!.message, /does not change anything/);
});

/* -- rollups cannot be fabricated ------------------------------------------ */

test('an act is only complete when every beat is', () => {
    const ix = build(CLEAN);
    const roll = rollupOf(ix, 'act_1', STATUSES);
    assert.equal(roll.total, 3);
    assert.equal(roll.complete, 1);
    assert.equal(roll.status, 'in-progress', 'one done out of three is not done');
});

test('an act with every beat complete is complete', () => {
    const act = CLEAN.replace(/status: pending/g, 'status: complete');
    assert.equal(rollupOf(build(act), 'act_1', STATUSES).status, 'complete');
});

test('an act with nothing started is pending, and an empty act is too', () => {
    const act = CLEAN.replace('status: complete\n    verify: flag arrived is set', 'status: pending\n    verify: flag arrived is set');
    assert.equal(rollupOf(build(act), 'act_1', STATUSES).status, 'pending');

    const empty = '---\nid: act_1\ntype: act\nname: Act I\nbeats: []\n---\n';
    const roll = rollupOf(build(empty), 'act_1', STATUSES);
    assert.equal(roll.total, 0);
    assert.equal(roll.status, 'pending', 'an act with no work in it is not finished work');
});

test('the counts add up to the number of beats', () => {
    const roll = rollupOf(build(CLEAN), 'act_1', STATUSES);
    const summed = Object.values(roll.counts).reduce((a, b) => a + b, 0);
    assert.equal(summed, roll.total);
});

/* -- ordering of findings --------------------------------------------------- */

test('errors are listed before warnings', () => {
    const act = CLEAN
        .replace('requires: { all: [{ done: b1 }] }', 'requires: { all: [{ done: b3 }] }')
        .replace('    sells: [{ vendor: "[[smith]]", items: ["[[hammer]]"] }]\n', '');
    const found = validateProject(build(act), project);
    const firstWarning = found.findIndex((p) => p.severity === 'warning');
    const lastError = found.map((p) => p.severity).lastIndexOf('error');
    assert.ok(found.some((p) => p.severity === 'error'), 'the fixture should produce an error');
    assert.ok(found.some((p) => p.severity === 'warning'), 'and a warning');
    assert.ok(lastError < firstWarning, 'errors must come first');
});
