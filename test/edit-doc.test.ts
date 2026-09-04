/* Editing frontmatter without wrecking it.
 *
 * The thing being defended here is the author's own writing: the comments they left in the
 * YAML explaining a decision, the prose under it, and the ordering they chose. A
 * parse-then-dump would take the comments away silently, which is the worst kind of data
 * loss - nobody notices until they go looking for the reasoning. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { addBeat, editFrontmatter, moveBeat, nextBeatId, removeBeat, updateBeat } from '../src/core/edit-doc.ts';
import { parseDoc } from '../src/core/parse-doc.ts';

const ACT = `---
id: act_1
type: act
name: Act I
# The order below is the order the player meets these. Do not sort it.
beats:
  - id: b1
    title: The gates
    status: complete
  # Igor is deliberately AFTER the gates - he reacts to the player arriving.
  - id: b2
    title: Igor arrives
    status: pending
  - id: b3
    title: The hollow
    status: pending
---

Prose that must survive, with a [[wikilink]] in it.
`;

const beatIds = (text: string): string[] => {
    const beats = parseDoc('a.md', text).data['beats'];
    return (beats as Array<{ id: string }>).map((b) => b.id);
};

const ok = (r: ReturnType<typeof moveBeat>): string => {
    assert.equal(r.ok, true, r.ok ? '' : `refused: ${r.problem.rule}`);
    return r.ok ? r.text : '';
};

test('moving a beat down reorders it and nothing else', () => {
    const out = ok(moveBeat(ACT, 'b1', 1));
    assert.deepEqual(beatIds(out), ['b2', 'b1', 'b3']);
});

test('moving a beat up reorders it', () => {
    const out = ok(moveBeat(ACT, 'b3', -1));
    assert.deepEqual(beatIds(out), ['b1', 'b3', 'b2']);
});

/* The whole reason for using the Document API rather than parse-then-dump. */
test('comments in the frontmatter survive a reorder', () => {
    const out = ok(moveBeat(ACT, 'b3', -1));
    assert.match(out, /# The order below is the order the player meets these\./);
    assert.match(out, /# Igor is deliberately AFTER the gates/);
});

test('the prose body survives byte for byte', () => {
    const out = ok(moveBeat(ACT, 'b1', 1));
    const body = out.slice(out.lastIndexOf('---\n') + 4);
    assert.equal(body, '\nProse that must survive, with a [[wikilink]] in it.\n');
});

test('moving the first beat up is a no-op, not a failure', () => {
    const r = moveBeat(ACT, 'b1', -1);
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.changed, false);
    assert.equal(r.ok && r.text, ACT, 'an unchanged document is returned untouched');
});

test('moving the last beat down is a no-op', () => {
    const r = moveBeat(ACT, 'b3', 1);
    assert.equal(r.ok && r.changed, false);
    assert.equal(r.ok && r.text, ACT);
});

test('moving a beat that does not exist changes nothing', () => {
    const r = moveBeat(ACT, 'nope', 1);
    assert.equal(r.ok && r.changed, false);
    assert.equal(r.ok && r.text, ACT);
});

test('a new beat is appended with a sensible default status', () => {
    const out = ok(addBeat(ACT, { id: 'b4', title: 'The castle' }));
    assert.deepEqual(beatIds(out), ['b1', 'b2', 'b3', 'b4']);
    const beats = parseDoc('a.md', out).data['beats'] as Array<Record<string, unknown>>;
    assert.equal(beats[3]!['status'], 'pending');
    assert.equal(beats[3]!['title'], 'The castle');
});

test('a new beat can be inserted after a named one', () => {
    const out = ok(addBeat(ACT, { id: 'b1a', title: 'A pause' }, 'b1'));
    assert.deepEqual(beatIds(out), ['b1', 'b1a', 'b2', 'b3']);
});

test('an act with an empty beats list still accepts its first beat', () => {
    const bare = '---\nid: act_9\ntype: act\nname: Act IX\nbeats: []\n---\n\nNothing yet.\n';
    const out = ok(addBeat(bare, { id: 'b1', title: 'Something' }));
    assert.deepEqual(beatIds(out), ['b1']);
    assert.match(out, /Nothing yet\./);
});

test('removing a beat takes only that beat', () => {
    const out = ok(removeBeat(ACT, 'b2'));
    assert.deepEqual(beatIds(out), ['b1', 'b3']);
    assert.match(out, /# The order below/, 'unrelated comments stay');
});

test('updating a beat sets fields and leaves the rest alone', () => {
    const out = ok(updateBeat(ACT, 'b2', { status: 'complete', verify: 'flag igor_met is set' }));
    const beats = parseDoc('a.md', out).data['beats'] as Array<Record<string, unknown>>;
    assert.equal(beats[1]!['status'], 'complete');
    assert.equal(beats[1]!['verify'], 'flag igor_met is set');
    assert.equal(beats[0]!['status'], 'complete', 'b1 is untouched');
    assert.equal(beats[2]!['status'], 'pending', 'b3 is untouched');
});

test('writing a value that is already there is not a change', () => {
    const r = updateBeat(ACT, 'b1', { status: 'complete' });
    assert.equal(r.ok && r.changed, false);
    assert.equal(r.ok && r.text, ACT);
});

test('setting a field to null removes the key rather than writing a null', () => {
    const withVerify = ok(updateBeat(ACT, 'b2', { verify: 'something' }));
    const out = ok(updateBeat(withVerify, 'b2', { verify: null }));
    assert.doesNotMatch(out, /verify:/);
    assert.doesNotMatch(out, /null/);
});

test('an edit followed by its inverse returns the original document', () => {
    // b3 carries no comment, so nothing is re-anchored and the bytes must match exactly.
    const up = ok(moveBeat(ACT, 'b3', -1));
    const back = ok(moveBeat(up, 'b3', 1));
    assert.equal(back, ACT, 'round-tripping must not reformat the file');
});

/* A known limitation of the FORMAT, not of this code.
 *
 *     beats:
 *       # is this about the list, or about the first entry?
 *       - id: b1
 *
 * YAML cannot tell those apart, and the parser resolves it to the list. So a comment
 * written above a beat stays with that beat until the beat is moved to the top, at which
 * point it becomes a comment about the list and stops travelling. Nothing is ever lost -
 * it is anchoring that changes - and the result is stable from then on. */
test('a comment survives its beat being moved to the top, re-anchored to the list', () => {
    const out = ok(moveBeat(ACT, 'b1', 1));
    assert.deepEqual(beatIds(out), ['b2', 'b1', 'b3']);
    assert.match(out, /# Igor is deliberately AFTER the gates/, 'the comment is still in the file');
    assert.match(out, /beats:\n  # Igor is deliberately AFTER/, 'now above the list');

    // And it settles: a further edit does not move it again.
    const again = ok(moveBeat(out, 'b3', -1));
    assert.match(again, /beats:\n  # Igor is deliberately AFTER/);
});

test('a document with no frontmatter is refused, not given one', () => {
    const r = editFrontmatter('Just prose.\n', () => true);
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.problem.rule, 'edit/no-frontmatter');
});

test('unparseable frontmatter is refused rather than rewritten', () => {
    const r = moveBeat('---\nid: [unclosed\n---\n\nbody\n', 'b1', 1, 'broken.md');
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.problem.rule, 'edit/frontmatter');
    assert.equal(!r.ok && r.problem.file, 'broken.md');
});

test('a fresh beat id skips the ones already taken', () => {
    assert.equal(nextBeatId([]), 'beat_01');
    assert.equal(nextBeatId(['beat_01', 'beat_02']), 'beat_03');
    assert.equal(nextBeatId(['beat_02']), 'beat_01');
});
