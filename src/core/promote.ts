/* Turning a line someone drew into something a file actually says.
 *
 * Sketch freely, promote deliberately. A line on a canvas means nothing until it is given a
 * relation, and the moment it is, the claim belongs in the document that owns it - the
 * character's own page, or the beat where it happens. The canvas then stops storing it and
 * simply reads it back from the index, so there is only ever one copy.
 *
 * A promotion that cannot be written is REFUSED WITH THE FIX, not silently dropped. If no
 * field on the Character template emits SELLS then that is the thing to go and add, and
 * saying so is more use than a disabled menu item. */

import { setFrontmatterField, updateBeat, type EditResult } from './edit-doc.ts';
import type { GraphIndex } from './index-graph.ts';
import type { Project } from './project.ts';
import type { DocNode, TemplateField } from './types.ts';

/** Beat fields that carry a plain list of targets. Grants and sells name a third party. */
const BEAT_FIELD: Record<string, string> = {
    INTRODUCES: 'introduces',
    OPENS: 'opens',
    FEATURES: 'features',
};

export interface Promotion {
    /** The file that will carry the assertion. */
    path: string;
    /** What will be written, in words, so it can be read before it happens. */
    describe: string;
    edit: (text: string, file: string) => EditResult;
}

export type PromoteResult =
    | { ok: true; promotion: Promotion }
    | { ok: false; reason: string };

const link = (id: string): string => `[[${id}]]`;

const asList = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

const isRefField = (f: TemplateField): boolean =>
    f.type === 'ref' || f.type === 'refList' || f.type === 'refQty';

/** Where a relationship between these two would be written, and what it would say. */
export function planPromotion(
    index: GraphIndex,
    project: Project,
    fromId: string,
    toId: string,
    rel: string,
): PromoteResult {
    const from = index.nodes.get(fromId);
    const to = index.nodes.get(toId);
    if (!from) return { ok: false, reason: `'${fromId}' is not something this project knows about.` };
    if (!to) return { ok: false, reason: `'${toId}' is not something this project knows about.` };

    const relation = project.relations.get(rel);
    const relLabel = relation?.label ?? rel;

    /* -- a beat asserting something about one other thing -------------------- */

    if (from.kind === 'beat') {
        const key = BEAT_FIELD[rel];
        if (!key) {
            return {
                ok: false,
                reason: `A beat cannot simply "${relLabel.toLowerCase()}" something. `
                    + 'Grants and sales name whoever hands the thing over, so add those in the script view.',
            };
        }
        const current = asList((from.fields as Record<string, unknown>)[key]);
        if (current.some((v) => v.includes(toId))) {
            return { ok: false, reason: `'${from.name}' already ${key} '${to.name}'.` };
        }
        const next = [...current, link(toId)];
        return {
            ok: true,
            promotion: {
                path: from.path,
                describe: `${from.name} ${key} ${to.name}`,
                edit: (text, file) => updateBeat(text, from.locator!, { [key]: next }, file),
            },
        };
    }

    /* -- an object asserting something on its own page ----------------------- */

    if (from.kind !== 'object') {
        return { ok: false, reason: 'An act does not assert relationships; its beats do.' };
    }

    const template = project.templates.get(from.type);
    if (!template) return { ok: false, reason: `'${from.type}' has no template.` };

    const field = template.fields.find((f) => f.rel === rel && isRefField(f));
    if (!field) {
        /* The fix is a schema change, and naming it is the point - this is the moment
         * someone discovers their template is missing something. */
        return {
            ok: false,
            reason: `No field on the ${template.label} template means "${relLabel}". `
                + `Add one in the ${template.label} template, then draw this again.`,
        };
    }

    if (field.to?.length && to.kind === 'object' && !field.to.includes(to.type)) {
        const allowed = field.to
            .map((t) => project.templates.get(t)?.label ?? t)
            .join(' or ');
        return {
            ok: false,
            reason: `'${field.label}' points at ${allowed}, and '${to.name}' is not one.`,
        };
    }

    const current = from.fields[field.key];
    if (field.type === 'ref') {
        if (typeof current === 'string' && current.includes(toId)) {
            return { ok: false, reason: `'${from.name}' already has '${to.name}' as its ${field.label.toLowerCase()}.` };
        }
        return {
            ok: true,
            promotion: {
                path: from.path,
                describe: `${from.name} · ${field.label} → ${to.name}`,
                edit: (text, file) => setFrontmatterField(text, field.key, link(toId), file),
            },
        };
    }

    const list = asList(current);
    if (list.some((v) => v.includes(toId))) {
        return { ok: false, reason: `'${to.name}' is already in ${from.name}'s ${field.label.toLowerCase()}.` };
    }
    const next = [...list, link(toId)];
    return {
        ok: true,
        promotion: {
            path: from.path,
            describe: `${from.name} · ${field.label} → ${to.name}`,
            edit: (text, file) => setFrontmatterField(text, field.key, next, file),
        },
    };
}

/** Which relations this pair could actually take, for the picker. */
export function promotableRelations(
    index: GraphIndex,
    project: Project,
    fromId: string,
    toId: string,
): string[] {
    return [...project.relations.keys()].filter(
        (rel) => planPromotion(index, project, fromId, toId, rel).ok,
    );
}

/** Where a promoted relationship lives, so "unlink" can take it back out again. */
export function planDemotion(
    index: GraphIndex,
    project: Project,
    fromId: string,
    toId: string,
    rel: string,
): PromoteResult {
    const from = index.nodes.get(fromId);
    const to = index.nodes.get(toId);
    if (!from || !to) return { ok: false, reason: 'One end of this link no longer exists.' };

    const without = (value: unknown): string[] =>
        asList(value).filter((v) => !v.includes(toId));

    if (from.kind === 'beat') {
        const key = BEAT_FIELD[rel];
        if (!key) return { ok: false, reason: 'This link is asserted somewhere the canvas cannot edit; open the script view.' };
        const next = without((from.fields as Record<string, unknown>)[key]);
        return {
            ok: true,
            promotion: {
                path: from.path,
                describe: `${from.name} no longer ${key} ${to.name}`,
                edit: (text, file) => updateBeat(text, from.locator!, { [key]: next.length ? next : null }, file),
            },
        };
    }

    if (from.kind !== 'object') return { ok: false, reason: 'Nothing here to unlink.' };
    const template = project.templates.get(from.type);
    const field = template?.fields.find((f) => f.rel === rel && isRefField(f));
    if (!field) return { ok: false, reason: 'This link is not asserted by a field, so it cannot be removed here.' };

    const next = field.type === 'ref' ? null : without(from.fields[field.key]);
    return {
        ok: true,
        promotion: {
            path: from.path,
            describe: `${from.name} · ${field.label} no longer includes ${to.name}`,
            edit: (text, file) => setFrontmatterField(
                text, field.key, Array.isArray(next) && next.length === 0 ? null : next, file,
            ),
        },
    };
}
