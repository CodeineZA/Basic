/* The graph index. Every view in the app is a query over this.
 *
 * One pass builds nodes, a second emits edges - two passes because an edge can
 * only report an unknown target once every node is known. Edges are stored in
 * one direction only; the inverse is a lookup, not a second row, so a relation
 * can never half-exist. */

import type { ParsedDoc } from './parse-doc.ts';
import { asRef, collectRefs, scanWikilinks } from './parse-doc.ts';
import { BEAT_EMITTERS, RESERVED, type Project } from './project.ts';
import type { DocNode, Edge, Problem, Requirement } from './types.ts';

export interface GraphIndex {
    nodes: Map<string, DocNode>;
    edges: Edge[];
    byFrom: Map<string, Edge[]>;
    byTo: Map<string, Edge[]>;
    /** Beat ids in progression order. This is what makes the fold possible. */
    order: string[];
    problems: Problem[];
}

export const beatId = (act: string, beat: string): string => `${act}#${beat}`;

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** Every entity or beat a requirement expression points at. */
export function requirementRefs(req: Requirement | undefined): string[] {
    if (!req || typeof req !== 'object') return [];
    if ('all' in req) return req.all.flatMap(requirementRefs);
    if ('any' in req) return req.any.flatMap(requirementRefs);
    if ('not' in req) return requirementRefs(req.not);
    for (const key of ['has', 'done', 'visited'] as const) {
        if (key in req) {
            const s = str((req as Record<string, unknown>)[key]);
            if (s) return [asRef(s) ?? s];
        }
    }
    return [];
}

export function buildIndex(docs: ParsedDoc[], project: Project): GraphIndex {
    const nodes = new Map<string, DocNode>();
    const problems: Problem[] = [];
    const order: string[] = [];
    /** Bare beat id -> qualified id, so `done: beat_01_01` resolves. */
    const beatAlias = new Map<string, string>();

    const fail = (rule: string, message: string, file?: string, locator?: string): void => {
        problems.push({
            severity: 'error', rule, message,
            ...(file === undefined ? {} : { file }),
            ...(locator === undefined ? {} : { locator }),
        });
    };

    /* -- pass 1: nodes --------------------------------------------------- */

    const acts: Array<{ doc: ParsedDoc; id: string }> = [];

    for (const doc of docs) {
        if (doc.error) {
            fail('doc/frontmatter', `frontmatter will not parse: ${doc.error}`, doc.path);
            continue;
        }
        const id = str(doc.data['id']);
        const type = str(doc.data['type']);
        if (!id) { fail('doc/no-id', 'document has no id', doc.path); continue; }
        if (!type) { fail('doc/no-type', `'${id}' has no type`, doc.path); continue; }
        if (nodes.has(id)) { fail('doc/duplicate-id', `id '${id}' is used more than once`, doc.path); continue; }

        const name = str(doc.data['name']) ?? id;
        const status = str(doc.data['status']);
        const base = { id, name, path: doc.path, ...(status === undefined ? {} : { status }) };

        if (type === 'act') {
            nodes.set(id, { ...base, kind: 'act', type: 'act', fields: doc.data });
            acts.push({ doc, id });
            continue;
        }
        if (!project.templates.has(type)) {
            fail('doc/unknown-type', `'${id}' has type '${type}', which has no template`, doc.path);
            continue;
        }
        const fields: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(doc.data)) if (!RESERVED.has(k)) fields[k] = v;
        nodes.set(id, { ...base, kind: 'object', type, fields });
    }

    // Beats, after every act exists, so ordering is stable and ids are known.
    for (const { doc, id: actId } of acts) {
        const beats = doc.data['beats'];
        if (beats === undefined) continue;
        if (!Array.isArray(beats)) {
            fail('act/beats-shape', `'${actId}' has a 'beats' that is not a list`, doc.path);
            continue;
        }

        for (const raw of beats) {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
                fail('act/beat-shape', `'${actId}' has a beat that is not a mapping`, doc.path);
                continue;
            }
            const beat = raw as Record<string, unknown>;
            const bare = str(beat['id']);
            if (!bare) { fail('beat/no-id', `a beat in '${actId}' has no id`, doc.path); continue; }
            const qualified = beatId(actId, bare);
            if (nodes.has(qualified)) {
                fail('beat/duplicate-id', `beat '${bare}' appears twice in '${actId}'`, doc.path);
                continue;
            }

            const bStatus = str(beat['status']);
            nodes.set(qualified, {
                id: qualified,
                kind: 'beat',
                type: 'beat',
                name: str(beat['title']) ?? bare,
                path: doc.path,
                locator: bare,
                ...(bStatus === undefined ? {} : { status: bStatus }),
                fields: beat,
            });
            if (!beatAlias.has(bare)) beatAlias.set(bare, qualified);
            order.push(qualified);
        }
    }

    /* -- pass 2: edges --------------------------------------------------- */

    const edges: Edge[] = [];

    const resolve = (ref: string, file: string, locator: string): string | null => {
        const id = asRef(ref) ?? ref;
        if (nodes.has(id)) return id;
        const aliased = beatAlias.get(id);
        if (aliased) return aliased;
        fail('ref/unknown', `'${id}' is referenced but no document defines it`, file, locator);
        return null;
    };

    const emit = (
        from: string, to: string, rel: string,
        source: Edge['source'], extra: Partial<Edge> = {},
    ): void => {
        edges.push({ from, to, rel, source, ...extra });
    };

    for (const node of nodes.values()) {
        if (node.kind === 'object') {
            const template = project.templates.get(node.type)!;
            for (const field of template.fields) {
                if (!field.rel) continue;
                for (const ref of collectRefs(node.fields[field.key])) {
                    const to = resolve(ref, node.path, field.key);
                    if (to) emit(node.id, to, field.rel, { file: node.path, kind: 'frontmatter', locator: field.key });
                }
            }
        }

        if (node.kind !== 'beat') continue;

        const beat = node.fields as Record<string, unknown>;
        const src: Edge['source'] = { file: node.path, kind: 'beat', locator: node.locator! };

        for (const { key, rel } of BEAT_EMITTERS) {
            for (const ref of collectRefs(beat[key])) {
                const to = resolve(ref, node.path, `${node.locator}.${key}`);
                if (to) emit(node.id, to, rel, src, { beat: node.id });
            }
        }

        /* `grants` and `sells` name a third party: the beat asserts that IGOR
         * sells the axe, so the edge runs Igor -> axe and remembers the beat
         * that said so. That provenance is the whole point. */
        const grants = beat['grants'];
        if (Array.isArray(grants)) {
            for (const g of grants) {
                if (!g || typeof g !== 'object') continue;
                const row = g as Record<string, unknown>;
                const item = collectRefs(row['item'])[0];
                if (!item) continue;
                const to = resolve(item, node.path, `${node.locator}.grants`);
                if (!to) continue;
                const giver = collectRefs(row['from'])[0];
                const from = giver ? resolve(giver, node.path, `${node.locator}.grants.from`) : node.id;
                if (from) emit(from, to, 'GRANTS', src, { beat: node.id });
            }
        }

        const sells = beat['sells'];
        if (Array.isArray(sells)) {
            for (const s of sells) {
                if (!s || typeof s !== 'object') continue;
                const row = s as Record<string, unknown>;
                const vendorRef = collectRefs(row['vendor'])[0];
                if (!vendorRef) continue;
                const vendor = resolve(vendorRef, node.path, `${node.locator}.sells.vendor`);
                if (!vendor) continue;
                for (const ref of collectRefs(row['items'])) {
                    const to = resolve(ref, node.path, `${node.locator}.sells.items`);
                    if (to) emit(vendor, to, 'SELLS', src, { beat: node.id });
                }
            }
        }

        for (const ref of requirementRefs(beat['requires'] as Requirement | undefined)) {
            const to = resolve(ref, node.path, `${node.locator}.requires`);
            if (to) emit(node.id, to, 'REQUIRES', src, { beat: node.id });
        }
    }

    /* Prose links are soft: a mention is not an assertion, but it is still a way
     * one page reaches another, so the wiki must know about it. */
    for (const doc of docs) {
        const id = str(doc.data['id']);
        if (!id || !nodes.has(id)) continue;
        const seen = new Set<string>();
        for (const link of scanWikilinks(doc.body)) {
            const target = nodes.has(link.id) ? link.id : beatAlias.get(link.id);
            if (!target || target === id || seen.has(target)) continue;
            seen.add(target);
            edges.push({ from: id, to: target, rel: 'MENTIONS', source: { file: doc.path, kind: 'prose' } });
        }
    }

    const byFrom = new Map<string, Edge[]>();
    const byTo = new Map<string, Edge[]>();
    const push = (m: Map<string, Edge[]>, k: string, e: Edge): void => {
        const list = m.get(k);
        if (list) list.push(e); else m.set(k, [e]);
    };
    for (const e of edges) { push(byFrom, e.from, e); push(byTo, e.to, e); }

    return { nodes, edges, byFrom, byTo, order, problems };
}

/* Bare beat ids appear all over the place - `done: beat_01_01` in a requirement,
 * a wikilink someone typed by hand. Display code has to resolve them exactly as
 * the indexer did, or a card shows a raw id where a title belongs. */
export function resolveId(index: GraphIndex, ref: string): string | null {
    if (index.nodes.has(ref)) return ref;
    for (const [id, node] of index.nodes) if (node.locator === ref) return id;
    return null;
}

export const incoming = (index: GraphIndex, id: string, rels?: string[]): Edge[] =>
    (index.byTo.get(id) ?? []).filter((e) => !rels || rels.includes(e.rel));

export const outgoing = (index: GraphIndex, id: string, rels?: string[]): Edge[] =>
    (index.byFrom.get(id) ?? []).filter((e) => !rels || rels.includes(e.rel));
