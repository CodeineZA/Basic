/* The consistency guarantees.
 *
 * These are the promises that make the app trustworthy: an external edit
 * reloads a clean tab silently, a dirty tab raises a conflict instead of
 * merging, and saving regenerates every dependent page in one batch. They run
 * against the in-memory platform, which has the same semantics as the desktop
 * one - the difference is only where the bytes land. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state/store.ts';
import { announce, platform } from '../src/platform/index.ts';
import { scaffoldProject } from '../src/core/scaffold.ts';

let n = 0;
const freshRoot = (): string => `test-project-${++n}`;

const IGOR = `---
id: igor
type: character
name: Igor
home: "[[cutters-hollow]]"
---

He points at the only tree.
`;

const AXE = `---
id: wooden-axe
type: item
name: Wooden Axe
value: 12
---

Blunt and heavy.
`;

const HOLLOW = `---
id: cutters-hollow
type: location
name: Cutters Hollow
---
`;

const ACT = `---
id: act_1
type: act
name: Act I
beats:
  - id: beat_01_03
    title: Igor turns up uninvited
    status: pending
    verify: flag igor_met is set
    introduces: ["[[igor]]"]
    grants: [{ item: "[[wooden-axe]]", from: "[[igor]]" }]
---

Prose.
`;

/* What an external editor actually does: change the bytes, THEN the watcher
 * fires. Announcing without writing would test a state the app never reaches. */
async function externalEdit(root: string, path: string, text: string): Promise<void> {
    await platform.write(root, path, text);
    announce(root, { kind: 'change', path, text });
}

/** A loaded store over a fresh project with three pages and one beat. */
async function openProject() {
    const root = freshRoot();
    await platform.scaffold(root, [
        ...scaffoldProject('Test'),
        { path: 'entities/character/igor.md', text: IGOR },
        { path: 'entities/item/wooden-axe.md', text: AXE },
        { path: 'entities/location/cutters-hollow.md', text: HOLLOW },
        { path: 'progression/act-1.md', text: ACT },
    ]);
    const store = createStore();
    await store.openProject(root);
    return { store, root };
}

test('opening a project builds a clean index', async () => {
    const { store } = await openProject();
    const s = store.getState();
    assert.equal(s.problems.length, 0, JSON.stringify(s.problems));
    assert.ok(s.index!.nodes.has('igor'));
    assert.ok(s.index!.nodes.has('act_1#beat_01_03'));
    assert.equal(s.project!.templates.size, 3);
});

test('saving grows the generated blocks on every page the beat touches', async () => {
    const { store, root } = await openProject();
    await store.save();

    const axe = await platform.read(root, 'entities/item/wooden-axe.md');
    assert.match(axe!, /#### Available from\n\n- \*\*Given by\*\* \[\[igor\|Igor\]\]/);

    const igor = await platform.read(root, 'entities/character/igor.md');
    assert.match(igor!, /\*\*Grants\*\* \[\[wooden-axe\|Wooden Axe\]\]/);

    // Nobody typed a relation into either page; the beat is the only source.
    assert.match(axe!, /Blunt and heavy\./);
});

test('saving a second time changes nothing on disk', async () => {
    const { store, root } = await openProject();
    await store.save();
    const first = await platform.read(root, 'entities/item/wooden-axe.md');
    await store.save();
    assert.equal(await platform.read(root, 'entities/item/wooden-axe.md'), first);
});

test('an external edit to a clean document is taken silently and re-indexed', async () => {
    const { store, root } = await openProject();
    await externalEdit(root, 'entities/item/wooden-axe.md', AXE.replace('name: Wooden Axe', 'name: Rusted Axe'));

    const s = store.getState();
    assert.equal(s.index!.nodes.get('wooden-axe')!.name, 'Rusted Axe');
    assert.equal(s.docs.get('entities/item/wooden-axe.md')!.conflict, undefined);
    assert.equal(s.docs.get('entities/item/wooden-axe.md')!.buffer, undefined);
});

test('an external edit under an unsaved buffer raises a conflict and merges nothing', async () => {
    const { store, root } = await openProject();
    const path = 'entities/item/wooden-axe.md';

    store.setBuffer(path, AXE.replace('Blunt and heavy.', 'Mine: blunt, heavy, slow.'));
    await externalEdit(root, path, AXE.replace('Blunt and heavy.', 'Theirs: freshly ground.'));

    const doc = store.getState().docs.get(path)!;
    assert.match(doc.conflict!, /Theirs: freshly ground\./);
    assert.match(doc.buffer!, /Mine: blunt, heavy, slow\./);
    // Neither version has quietly won.
    assert.doesNotMatch(doc.buffer!, /Theirs/);
    assert.doesNotMatch(doc.conflict!, /Mine/);
});

test('taking theirs discards the buffer; keeping mine survives the reload', async () => {
    const path = 'entities/item/wooden-axe.md';

    const theirs = await openProject();
    theirs.store.setBuffer(path, AXE.replace('Blunt and heavy.', 'Mine.'));
    await externalEdit(theirs.root, path, AXE.replace('Blunt and heavy.', 'Theirs.'));
    theirs.store.resolveConflict(path, 'theirs');
    assert.match(theirs.store.textOf(path), /Theirs\./);
    assert.equal(theirs.store.getState().docs.get(path)!.buffer, undefined);

    const mine = await openProject();
    mine.store.setBuffer(path, AXE.replace('Blunt and heavy.', 'Mine.'));
    await externalEdit(mine.root, path, AXE.replace('Blunt and heavy.', 'Theirs.'));
    mine.store.resolveConflict(path, 'mine');
    assert.match(mine.store.textOf(path), /Mine\./);
});

test('editing a beat by hand moves the graph, which is what makes the sync two-way', async () => {
    const { store, root } = await openProject();
    assert.equal(store.getState().index!.byTo.get('wooden-axe')?.some((e) => e.rel === 'GRANTS'), true);

    // Remove the grant from the progression document, as a person would.
    await externalEdit(root, 'progression/act-1.md', ACT.replace('    grants: [{ item: "[[wooden-axe]]", from: "[[igor]]" }]\n', ''));

    const grants = store.getState().index!.byTo.get('wooden-axe')?.filter((e) => e.rel === 'GRANTS') ?? [];
    assert.equal(grants.length, 0, 'the claim should be gone from the graph immediately');

    await store.save();
    const axe = await platform.read(root, 'entities/item/wooden-axe.md');
    assert.match(axe!, /#### Available from\n\n_Nothing yet\._/);
});

test('a page whose managed markers are malformed is refused, not guessed at', async () => {
    const { store, root } = await openProject();
    const path = 'entities/item/wooden-axe.md';
    await externalEdit(root, path, `${AXE}\n<!-- basic:available-from -->\nhalf a block\n`);

    await store.save();

    const problems = store.getState().problems.filter((p) => p.rule.startsWith('block/'));
    assert.equal(problems.length, 1, JSON.stringify(store.getState().problems));
    assert.equal(problems[0]!.rule, 'block/unclosed');

    // The damaged file is left exactly as it was rather than being rewritten.
    const onDisk = await platform.read(root, path);
    assert.match(onDisk!, /half a block/);
});

test('deleting a file externally removes its node without taking anything else down', async () => {
    const { store, root } = await openProject();
    announce(root, { kind: 'unlink', path: 'entities/location/cutters-hollow.md' });

    const s = store.getState();
    assert.equal(s.index!.nodes.has('cutters-hollow'), false);
    assert.ok(s.index!.nodes.has('igor'), 'the rest of the project survives');
    // Igor still points at it, so the dangling reference is reported.
    assert.ok(s.problems.some((p) => p.rule === 'ref/unknown'));
});
