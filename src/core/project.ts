/* The project's schema: what kinds of thing exist, and what a link between two
 * of them means.
 *
 * Templates do double duty. They describe the form you fill in AND they declare
 * which relation each ref field emits, so filling in a field IS asserting an
 * edge. There is no separate place to teach the graph about a new field. */

import { parse } from 'yaml';
import type { Relation, Template } from './types.ts';

export interface Project {
    name: string;
    templates: Map<string, Template>;
    relations: Map<string, Relation>;
    /** Relation ids grouped by their `group`, for section queries. */
    groups: Map<string, string[]>;
}

/* Beats are not user-templated - they are the fixed vocabulary of the
 * progression document. These are the simple list-shaped emitters; `grants` and
 * `sells` name a third party and are handled in the indexer. */
export const BEAT_EMITTERS: ReadonlyArray<{ key: string; rel: string }> = [
    { key: 'introduces', rel: 'INTRODUCES' },
    { key: 'features', rel: 'FEATURES' },
    { key: 'opens', rel: 'OPENS' },
];

/** Frontmatter keys that belong to Basic, not to a template. */
export const RESERVED = new Set(['id', 'type', 'name', 'status', 'beats']);

export const DEFAULT_RELATIONS: Relation[] = [
    { id: 'SELLS', label: 'Sells', inverse: 'SOLD_BY', inverseLabel: 'Sold by', group: 'obtain' },
    { id: 'GRANTS', label: 'Grants', inverse: 'GRANTED_BY', inverseLabel: 'Given by', group: 'obtain' },
    { id: 'DROPS', label: 'Drops', inverse: 'DROPPED_BY', inverseLabel: 'Dropped by', group: 'obtain' },
    { id: 'CRAFTED_FROM', label: 'Crafted from', inverse: 'USED_IN', inverseLabel: 'Used in', group: 'craft' },
    { id: 'LOCATED_IN', label: 'Located in', inverse: 'CONTAINS', inverseLabel: 'Contains' },
    { id: 'INTRODUCES', label: 'Introduces', inverse: 'INTRODUCED_IN', inverseLabel: 'Introduced in', group: 'story' },
    { id: 'FEATURES', label: 'Features', inverse: 'APPEARS_IN', inverseLabel: 'Appears in', group: 'story' },
    { id: 'OPENS', label: 'Opens', inverse: 'OPENED_BY', inverseLabel: 'Opened by', group: 'story' },
    { id: 'REQUIRES', label: 'Requires', inverse: 'GATES', inverseLabel: 'Gates' },
    { id: 'MENTIONS', label: 'Mentions', inverse: 'MENTIONED_BY', inverseLabel: 'Mentioned by' },
];

export function makeProject(
    name: string,
    templates: Template[],
    relations: Relation[] = DEFAULT_RELATIONS,
): Project {
    const groups = new Map<string, string[]>();
    for (const r of relations) {
        if (!r.group) continue;
        const list = groups.get(r.group) ?? [];
        list.push(r.id);
        groups.set(r.group, list);
    }
    return {
        name,
        templates: new Map(templates.map((t) => [t.id, t])),
        relations: new Map(relations.map((r) => [r.id, r])),
        groups,
    };
}

export const parseTemplate = (text: string): Template => parse(text) as Template;

/** Resolve a section query's relation list, expanding `{ group }` shorthand. */
export function relsFor(project: Project, spec: string[] | { group: string }): string[] {
    return Array.isArray(spec) ? spec : (project.groups.get(spec.group) ?? []);
}
