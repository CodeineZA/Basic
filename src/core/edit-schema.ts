/* Editing the project's own schema - what kinds of thing exist and what a link between two
 * of them means.
 *
 * This is the feature the whole app was asked for: not every character has the same
 * properties, so the shape of a character is the user's to decide and to reuse. Templates
 * are plain YAML files, so they go through the Document API for the same reason beats do -
 * a template usually carries a comment explaining why a field exists, and parse-then-dump
 * would take it away without saying so.
 *
 * Reports rather than throws. A schema file we cannot make sense of is a problem to show,
 * not an exception to unwind the world with. */

import { isMap, isSeq, parseDocument, type Document, type YAMLMap, type YAMLSeq } from 'yaml';
import type { Problem, Relation, SectionSpec, TemplateField } from './types.ts';

export type SchemaResult =
    | { ok: true; text: string; changed: boolean }
    | { ok: false; problem: Problem };

const fail = (rule: string, message: string, file?: string): SchemaResult => ({
    ok: false,
    problem: { severity: 'error', rule, message, ...(file === undefined ? {} : { file }) },
});

/** Apply a mutation to a whole YAML document, keeping its comments and formatting. */
export function editYaml(
    text: string,
    mutate: (doc: Document) => boolean,
    file?: string,
): SchemaResult {
    const doc = parseDocument(text);
    if (doc.errors.length > 0) {
        return fail('schema/parse', `will not parse: ${doc.errors[0]!.message}`, file);
    }
    if (!mutate(doc)) return { ok: true, text, changed: false };

    let out = doc.toString({ lineWidth: 0 });
    if (!out.endsWith('\n')) out += '\n';
    return { ok: true, text: out, changed: true };
}

/* -- generic list helpers --------------------------------------------------- */

/** A sequence at `path`, created as empty if it is absent. */
function seqAt(doc: Document, path: string, create: boolean): YAMLSeq | null {
    const found = doc.get(path);
    if (isSeq(found)) return found;
    if (found !== undefined && found !== null) return null; // wrong shape; refuse to guess
    if (!create) return null;
    doc.set(path, doc.createNode([]));
    const made = doc.get(path);
    return isSeq(made) ? made : null;
}

const indexBy = (seq: YAMLSeq, field: string, value: string): number =>
    seq.items.findIndex((item) => isMap(item) && item.get(field) === value);

/** Set the keys in `patch`; a null value removes the key rather than writing a null. */
function applyPatch(doc: Document, map: YAMLMap, patch: Record<string, unknown>): boolean {
    let changed = false;
    for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === '') {
            if (map.has(key)) { map.delete(key); changed = true; }
            continue;
        }
        if (JSON.stringify(map.toJSON()?.[key]) === JSON.stringify(value)) continue;
        map.set(key, doc.createNode(value));
        changed = true;
    }
    return changed;
}

/* -- templates -------------------------------------------------------------- */

/** A fresh template file. Deliberately minimal: fields are added deliberately, not guessed. */
export function newTemplateFile(id: string, label: string, color = '#7c9cbf'): string {
    return `id: ${id}
label: ${label}
color: "${color}"

# What a ${label.toLowerCase()} is made of. A field with a 'rel' emits that relation into
# the graph, so filling it in IS asserting a link.
fields: []

# Sections written into the page automatically. Each one is a query over the graph.
sections: []
`;
}

export function setTemplateMeta(
    text: string,
    patch: { label?: string; icon?: string; color?: string },
    file?: string,
): SchemaResult {
    return editYaml(text, (doc) => applyPatch(doc, doc.contents as YAMLMap, patch), file);
}

export function addTemplateField(
    text: string,
    field: TemplateField,
    afterKey?: string,
    file?: string,
): SchemaResult {
    return editYaml(text, (doc) => {
        const fields = seqAt(doc, 'fields', true);
        if (!fields) return false;
        if (indexBy(fields, 'key', field.key) !== -1) return false; // already there

        const node = doc.createNode(pruneField(field));
        const at = afterKey ? indexBy(fields, 'key', afterKey) : -1;
        if (at === -1) fields.items.push(node);
        else fields.items.splice(at + 1, 0, node);
        return true;
    }, file);
}

/* Only write the keys that mean something for this field type. A `to` on a number field or
 * an `options` on a text field is noise that later reads as intent. */
function pruneField(field: TemplateField): Record<string, unknown> {
    const out: Record<string, unknown> = { key: field.key, label: field.label, type: field.type };
    const isRef = field.type === 'ref' || field.type === 'refList' || field.type === 'refQty';
    if (isRef && field.to?.length) out['to'] = field.to;
    if (isRef && field.rel) out['rel'] = field.rel;
    if (field.type === 'enum' && field.options?.length) out['options'] = field.options;
    return out;
}

export function updateTemplateField(
    text: string,
    key: string,
    patch: Partial<TemplateField>,
    file?: string,
): SchemaResult {
    return editYaml(text, (doc) => {
        const fields = seqAt(doc, 'fields', false);
        if (!fields) return false;
        const at = indexBy(fields, 'key', key);
        if (at === -1) return false;

        const map = fields.items[at] as YAMLMap;
        let changed = applyPatch(doc, map, patch as Record<string, unknown>);

        /* Changing a field away from a ref type leaves `to` and `rel` behind, still claiming
         * a relation the field can no longer carry. Clear them with the change. */
        const type = (patch.type ?? map.get('type')) as string | undefined;
        const isRef = type === 'ref' || type === 'refList' || type === 'refQty';
        if (!isRef) {
            for (const dead of ['to', 'rel']) {
                if (map.has(dead)) { map.delete(dead); changed = true; }
            }
        }
        if (type !== 'enum' && map.has('options')) { map.delete('options'); changed = true; }
        return changed;
    }, file);
}

export function removeTemplateField(text: string, key: string, file?: string): SchemaResult {
    return editYaml(text, (doc) => {
        const fields = seqAt(doc, 'fields', false);
        if (!fields) return false;
        const at = indexBy(fields, 'key', key);
        if (at === -1) return false;
        fields.items.splice(at, 1);
        return true;
    }, file);
}

export function moveTemplateField(text: string, key: string, delta: number, file?: string): SchemaResult {
    return editYaml(text, (doc) => {
        const fields = seqAt(doc, 'fields', false);
        if (!fields) return false;
        const from = indexBy(fields, 'key', key);
        if (from === -1) return false;
        const to = from + delta;
        if (to < 0 || to >= fields.items.length) return false;
        const [item] = fields.items.splice(from, 1);
        fields.items.splice(to, 0, item);
        return true;
    }, file);
}

export function addTemplateSection(text: string, spec: SectionSpec, file?: string): SchemaResult {
    return editYaml(text, (doc) => {
        const sections = seqAt(doc, 'sections', true);
        if (!sections) return false;
        if (indexBy(sections, 'key', spec.key) !== -1) return false;
        sections.items.push(doc.createNode(spec));
        return true;
    }, file);
}

export function removeTemplateSection(text: string, key: string, file?: string): SchemaResult {
    return editYaml(text, (doc) => {
        const sections = seqAt(doc, 'sections', false);
        if (!sections) return false;
        const at = indexBy(sections, 'key', key);
        if (at === -1) return false;
        sections.items.splice(at, 1);
        return true;
    }, file);
}

/* -- relations -------------------------------------------------------------- */

/* relations.yaml is a bare sequence rather than a mapping, so the document's contents ARE
 * the list. */
function relationSeq(doc: Document): YAMLSeq | null {
    return isSeq(doc.contents) ? doc.contents : null;
}

export function addRelation(text: string, relation: Relation, file?: string): SchemaResult {
    return editYaml(text, (doc) => {
        const seq = relationSeq(doc);
        if (!seq) return false;
        if (indexBy(seq, 'id', relation.id) !== -1) return false;
        seq.items.push(doc.createNode(relation));
        return true;
    }, file);
}

export function updateRelation(
    text: string,
    id: string,
    patch: Partial<Relation>,
    file?: string,
): SchemaResult {
    return editYaml(text, (doc) => {
        const seq = relationSeq(doc);
        if (!seq) return false;
        const at = indexBy(seq, 'id', id);
        if (at === -1) return false;
        return applyPatch(doc, seq.items[at] as YAMLMap, patch as Record<string, unknown>);
    }, file);
}

export function removeRelation(text: string, id: string, file?: string): SchemaResult {
    return editYaml(text, (doc) => {
        const seq = relationSeq(doc);
        if (!seq) return false;
        const at = indexBy(seq, 'id', id);
        if (at === -1) return false;
        seq.items.splice(at, 1);
        return true;
    }, file);
}

/** A relation id in the house style: SCREAMING_SNAKE, since that is how edges read. */
export const relationId = (label: string): string =>
    label.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/** A field key in the house style: lower snake, since that is how frontmatter reads. */
export const fieldKey = (label: string): string =>
    label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
