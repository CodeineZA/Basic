/* Editing the project's own schema.
 *
 * A template usually carries a comment saying why a field exists - the reasoning is the
 * expensive part, not the field. So the same rule as beats applies: edit the document, never
 * rebuild it from parsed values. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'yaml';
import {
    addRelation, addTemplateField, addTemplateSection, editYaml, fieldKey, moveTemplateField,
    newTemplateFile, relationId, removeRelation, removeTemplateField, removeTemplateSection,
    setTemplateMeta, updateRelation, updateTemplateField,
} from '../src/core/edit-schema.ts';
import { setFrontmatterField } from '../src/core/edit-doc.ts';
import type { Relation, Template } from '../src/core/types.ts';

const TEMPLATE = `id: character
label: Character
color: "#7c9cbf"

# Faction drives the shop prices, so it is not just flavour.
fields:
  - key: role
    label: Role
    type: text
  - key: home
    label: Home
    type: ref
    to: [location]
    rel: LOCATED_IN
  - key: faction
    label: Faction
    type: text

sections:
  - key: appears-in
    title: Appears in
    query: { incoming: [INTRODUCES] }
`;

const RELATIONS = `# Inverses matter: a backlink is the inverse read from the far end.
- id: SELLS
  label: Sells
  inverse: SOLD_BY
  inverseLabel: Sold by
  group: obtain
- id: DROPS
  label: Drops
  inverse: DROPPED_BY
  inverseLabel: Dropped by
  group: obtain
`;

const ok = (r: ReturnType<typeof addTemplateField>): string => {
    assert.equal(r.ok, true, r.ok ? '' : `refused: ${r.problem.rule} — ${r.problem.message}`);
    return r.ok ? r.text : '';
};

const template = (text: string): Template => parse(text) as Template;
const keys = (text: string): string[] => (template(text).fields ?? []).map((f) => f.key);

/* -- fields ----------------------------------------------------------------- */

test('a field is appended, and only the keys that mean something are written', () => {
    const out = ok(addTemplateField(TEMPLATE, {
        key: 'disposition', label: 'Disposition', type: 'enum', options: ['friendly', 'wary'],
    }));
    assert.deepEqual(keys(out), ['role', 'home', 'faction', 'disposition']);

    const added = template(out).fields.at(-1)!;
    assert.deepEqual(added.options, ['friendly', 'wary']);
    assert.equal('to' in added, false, 'an enum has no ref target');
    assert.equal('rel' in added, false, 'and emits no relation');
});

test('a ref field keeps its target and relation', () => {
    const out = ok(addTemplateField(TEMPLATE, {
        key: 'sells', label: 'Sells', type: 'refList', to: ['item'], rel: 'SELLS',
    }));
    const added = template(out).fields.at(-1)!;
    assert.deepEqual(added.to, ['item']);
    assert.equal(added.rel, 'SELLS');
});

test('a field can be inserted after a named one', () => {
    const out = ok(addTemplateField(TEMPLATE, { key: 'age', label: 'Age', type: 'number' }, 'role'));
    assert.deepEqual(keys(out), ['role', 'age', 'home', 'faction']);
});

test('adding a field that is already there changes nothing', () => {
    const r = addTemplateField(TEMPLATE, { key: 'role', label: 'Role', type: 'text' });
    assert.equal(r.ok && r.changed, false);
    assert.equal(r.ok && r.text, TEMPLATE);
});

test('comments in the template survive every edit', () => {
    const out = ok(moveTemplateField(ok(addTemplateField(TEMPLATE, { key: 'age', label: 'Age', type: 'number' })), 'faction', -1));
    assert.match(out, /# Faction drives the shop prices/);
});

test('a field can be reordered, and the ends clamp rather than fail', () => {
    assert.deepEqual(keys(ok(moveTemplateField(TEMPLATE, 'faction', -1))), ['role', 'faction', 'home']);

    const noop = moveTemplateField(TEMPLATE, 'role', -1);
    assert.equal(noop.ok && noop.changed, false);
    assert.equal(noop.ok && noop.text, TEMPLATE);
});

test('a field is removed without taking its neighbours', () => {
    assert.deepEqual(keys(ok(removeTemplateField(TEMPLATE, 'home'))), ['role', 'faction']);
});

/* The bit that would otherwise leave a lie in the file. */
test('changing a ref field to a plain one clears the target and relation it can no longer carry', () => {
    const out = ok(updateTemplateField(TEMPLATE, 'home', { type: 'text' }));
    const home = template(out).fields.find((f) => f.key === 'home')!;
    assert.equal(home.type, 'text');
    assert.equal('to' in home, false, 'a text field points at no type');
    assert.equal('rel' in home, false, 'and asserts no relation');
});

test('changing away from an enum clears its options', () => {
    const withEnum = ok(addTemplateField(TEMPLATE, {
        key: 'mood', label: 'Mood', type: 'enum', options: ['calm', 'cross'],
    }));
    const out = ok(updateTemplateField(withEnum, 'mood', { type: 'text' }));
    assert.equal('options' in template(out).fields.find((f) => f.key === 'mood')!, false);
});

test('a label can be changed without disturbing the rest of the field', () => {
    const out = ok(updateTemplateField(TEMPLATE, 'home', { label: 'Lives in' }));
    const home = template(out).fields.find((f) => f.key === 'home')!;
    assert.equal(home.label, 'Lives in');
    assert.equal(home.rel, 'LOCATED_IN', 'the relation is untouched');
});

/* -- template meta and sections ---------------------------------------------- */

test('template meta is set in place', () => {
    const out = ok(setTemplateMeta(TEMPLATE, { label: 'Person', color: '#aa3344' }));
    const t = template(out);
    assert.equal(t.label, 'Person');
    assert.equal(t.color, '#aa3344');
    assert.equal(t.id, 'character', 'the id is not something a rename should touch');
});

test('sections are added and removed by key', () => {
    const added = ok(addTemplateSection(TEMPLATE, {
        key: 'available-from', title: 'Available from', query: { incoming: { group: 'obtain' } },
    }));
    assert.deepEqual(template(added).sections!.map((s) => s.key), ['appears-in', 'available-from']);

    const removed = ok(removeTemplateSection(added, 'appears-in'));
    assert.deepEqual(template(removed).sections!.map((s) => s.key), ['available-from']);
});

test('a brand new template file parses and starts empty', () => {
    const t = template(newTemplateFile('mob', 'Mob'));
    assert.equal(t.id, 'mob');
    assert.equal(t.label, 'Mob');
    assert.deepEqual(t.fields, []);
    assert.deepEqual(t.sections, []);

    // And it accepts its first field.
    assert.deepEqual(keys(ok(addTemplateField(newTemplateFile('mob', 'Mob'), {
        key: 'hp', label: 'Hit points', type: 'number',
    }))), ['hp']);
});

/* -- relations --------------------------------------------------------------- */

const relations = (text: string): Relation[] => parse(text) as Relation[];

test('a relation is added to the list', () => {
    const out = ok(addRelation(RELATIONS, {
        id: 'GUARDS', label: 'Guards', inverse: 'GUARDED_BY', inverseLabel: 'Guarded by',
    }));
    assert.deepEqual(relations(out).map((r) => r.id), ['SELLS', 'DROPS', 'GUARDS']);
    assert.match(out, /# Inverses matter/, 'the comment survives');
});

test('a relation is updated and removed by id', () => {
    const updated = ok(updateRelation(RELATIONS, 'DROPS', { inverseLabel: 'Dropped from' }));
    assert.equal(relations(updated).find((r) => r.id === 'DROPS')!.inverseLabel, 'Dropped from');

    const removed = ok(removeRelation(RELATIONS, 'SELLS'));
    assert.deepEqual(relations(removed).map((r) => r.id), ['DROPS']);
});

test('adding a relation that already exists changes nothing', () => {
    const r = addRelation(RELATIONS, { id: 'SELLS', inverse: 'SOLD_BY' });
    assert.equal(r.ok && r.changed, false);
});

/* -- ids in the house style --------------------------------------------------- */

test('an id is derived from a label in the shape each kind of thing uses', () => {
    assert.equal(relationId('Guarded by'), 'GUARDED_BY');
    assert.equal(relationId('  is  friends with '), 'IS_FRIENDS_WITH');
    assert.equal(fieldKey('Hit Points'), 'hit_points');
    assert.equal(fieldKey('Sell value ($)'), 'sell_value');
});

/* -- refusals ----------------------------------------------------------------- */

test('a file that will not parse is refused rather than rewritten', () => {
    const r = addTemplateField('fields: [unclosed\n', { key: 'x', label: 'X', type: 'text' }, undefined, 'bad.yaml');
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.problem.rule, 'schema/parse');
    assert.equal(!r.ok && r.problem.file, 'bad.yaml');
});

test('a fields key of the wrong shape is refused rather than replaced', () => {
    const r = addTemplateField('id: x\nfields: not-a-list\n', { key: 'a', label: 'A', type: 'text' });
    assert.equal(r.ok && r.changed, false, 'refuse to guess what was meant');
});

test('editYaml returns the input untouched when the mutation does nothing', () => {
    const r = editYaml(TEMPLATE, () => false);
    assert.equal(r.ok && r.changed, false);
    assert.equal(r.ok && r.text, TEMPLATE);
});

/* -- object fields, for the table view ------------------------------------------ */

const PAGE = '---\nid: axe\ntype: item\nname: Wooden Axe\nvalue: 12\n---\n\nBlunt and heavy.\n';

test('a field on an object page is set, and the prose is untouched', () => {
    const r = setFrontmatterField(PAGE, 'value', 18);
    assert.equal(r.ok, true);
    const out = r.ok ? r.text : '';
    assert.match(out, /value: 18/);
    assert.match(out, /Blunt and heavy\./);
});

test('clearing a field removes the key rather than writing an empty string', () => {
    const r = setFrontmatterField(PAGE, 'value', '');
    const out = r.ok ? r.text : '';
    assert.doesNotMatch(out, /value:/);
});

test('writing the value that is already there is not a change', () => {
    const r = setFrontmatterField(PAGE, 'value', 12);
    assert.equal(r.ok && r.changed, false);
    assert.equal(r.ok && r.text, PAGE);
});
