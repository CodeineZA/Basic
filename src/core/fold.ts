/* The fold: what the world looks like at a given point in the progression.
 *
 * This is why nothing is typed twice. Beats are ordered and each one asserts what becomes
 * true, so walking them up to any point and accumulating DERIVES what every vendor stocks,
 * where everything is, and how each item can be obtained. Nobody maintains a per-phase table
 * by hand, and there is no second copy of the truth to drift.
 *
 * Pure and synchronous. A few thousand beats is nothing, so it is recomputed rather than
 * cached - a stale fold would be a fabricated answer, which is worse than a slow one. */

import { incoming, type GraphIndex } from './index-graph.ts';
import { relsFor, type Project } from './project.ts';
import type { Edge } from './types.ts';

/** One way a thing can be had, and the beat that made it so. */
export interface Claim {
    /** Who provides it - a character, a mob - or the beat itself when nobody does. */
    from: string;
    rel: string;
    beat: string;
}

export interface WorldState {
    /** The beat this is as of. Null means "before anything has happened". */
    cursor: string | null;
    /** Beat ids up to and including the cursor, in order. */
    elapsed: string[];
    /** entity id -> the beat that introduced it. */
    introduced: Map<string, string>;
    /** location id -> the beat that opened it. */
    opened: Map<string, string>;
    /** item id -> every way it can be obtained by now. */
    obtainable: Map<string, Claim[]>;
    /** vendor id -> what they stock by now. */
    stock: Map<string, Set<string>>;
}

const empty = (cursor: string | null): WorldState => ({
    cursor,
    elapsed: [],
    introduced: new Map(),
    opened: new Map(),
    obtainable: new Map(),
    stock: new Map(),
});

/** Beats up to and including `cursor`. A cursor of null is the start of the game. */
export function elapsedTo(index: GraphIndex, cursor: string | null): string[] {
    if (cursor === null) return [];
    const at = index.order.indexOf(cursor);
    // An unknown cursor means the whole progression rather than none of it: a beat that was
    // deleted should not silently empty the world.
    return at === -1 ? [...index.order] : index.order.slice(0, at + 1);
}

export function foldTo(index: GraphIndex, project: Project, cursor: string | null): WorldState {
    const state = empty(cursor);
    state.elapsed = elapsedTo(index, cursor);
    if (state.elapsed.length === 0) return state;

    const reached = new Set(state.elapsed);
    const obtainRels = new Set(relsFor(project, { group: 'obtain' }));

    const add = (map: Map<string, Claim[]>, key: string, claim: Claim): void => {
        const list = map.get(key);
        if (list) list.push(claim); else map.set(key, [claim]);
    };

    /* One pass over the edges rather than a pass per beat: an edge already knows which beat
     * asserted it, so the ordering work is a set membership test. */
    for (const edge of index.edges) {
        if (!edge.beat || !reached.has(edge.beat)) continue;

        if (edge.rel === 'INTRODUCES' && !state.introduced.has(edge.to)) {
            state.introduced.set(edge.to, edge.beat);
        }
        if (edge.rel === 'OPENS' && !state.opened.has(edge.to)) {
            state.opened.set(edge.to, edge.beat);
        }
        if (obtainRels.has(edge.rel)) {
            add(state.obtainable, edge.to, { from: edge.from, rel: edge.rel, beat: edge.beat });
        }
        if (edge.rel === 'SELLS') {
            const items = state.stock.get(edge.from) ?? new Set<string>();
            items.add(edge.to);
            state.stock.set(edge.from, items);
        }
    }

    return state;
}

/** Has this thing appeared in the world by the cursor? */
export function existsAt(state: WorldState, id: string): boolean {
    return state.introduced.has(id) || state.opened.has(id) || state.obtainable.has(id);
}

/* Anything a beat references that no earlier beat has introduced is a content ordering
 * mistake - the player would be sent to a place, or handed a thing, that does not exist yet.
 * Only this tool can see it, because only this tool knows the order. */
export interface Anachronism {
    beat: string;
    entity: string;
    /** Where the reference was made, e.g. 'grants' or 'requires'. */
    via: string;
    /** The beat that does introduce it, when one does at all. */
    introducedBy?: string;
}

const IGNORE_REL = new Set(['INTRODUCES', 'OPENS', 'FEATURES', 'MENTIONS']);

export function findAnachronisms(index: GraphIndex, project: Project): Anachronism[] {
    const out: Anachronism[] = [];
    // Where each entity first appears, across the whole progression.
    const firstSeen = new Map<string, number>();
    index.order.forEach((beat, at) => {
        for (const edge of index.edges) {
            if (edge.beat !== beat) continue;
            if (edge.rel !== 'INTRODUCES' && edge.rel !== 'OPENS') continue;
            if (!firstSeen.has(edge.to)) firstSeen.set(edge.to, at);
        }
    });

    index.order.forEach((beat, at) => {
        const world = foldTo(index, project, beat);
        for (const edge of index.edges) {
            if (edge.beat !== beat || IGNORE_REL.has(edge.rel)) continue;

            // The subject of a claim matters too: a vendor selling something before anyone
            // has met them is the same mistake as the item not existing.
            for (const [id, via] of [[edge.from, edge.rel], [edge.to, edge.rel]] as const) {
                if (id === beat || !index.nodes.has(id)) continue;
                if (index.nodes.get(id)?.kind !== 'object') continue;
                if (existsAt(world, id)) continue;
                const introducedAt = firstSeen.get(id);
                if (introducedAt !== undefined && introducedAt <= at) continue;
                out.push({
                    beat,
                    entity: id,
                    via,
                    ...(introducedAt === undefined ? {} : { introducedBy: index.order[introducedAt]! }),
                });
            }
        }
    });

    // Same entity flagged twice by one beat helps nobody.
    const seen = new Set<string>();
    return out.filter((a) => {
        const key = `${a.beat}|${a.entity}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/** Everything the fold knows about one entity, for a page or an inspector. */
export function claimsFor(index: GraphIndex, project: Project, id: string): Claim[] {
    const rels = relsFor(project, { group: 'obtain' });
    return incoming(index, id, rels).map((e: Edge) => ({
        from: e.from,
        rel: e.rel,
        beat: e.beat ?? '',
    }));
}
