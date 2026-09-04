/* Finding things by typing part of their name.
 *
 * Subsequence matching rather than substring, so "wax" finds "Wooden Axe" - which is what
 * people expect from a search box now and is the difference between a tool you skim and one
 * you navigate. The scoring exists so the obvious answer comes first: an exact name beats a
 * prefix beats letters scattered through the middle.
 *
 * Pure, so the ranking can be argued with in a test rather than by squinting at a list. */

import type { GraphIndex } from './index-graph.ts';
import type { Project } from './project.ts';
import type { DocNode } from './types.ts';

export interface Match {
    score: number;
    /** Indices in the haystack that matched, for highlighting. */
    positions: number[];
}

const WORD_START = /[\s\-_/.]/;

/* Bonuses, in the order they matter. Consecutive runs and word starts are what make a
 * fuzzy match feel deliberate rather than coincidental. */
const EXACT = 1000;
const PREFIX = 500;
const CONSECUTIVE = 12;
const WORD_BOUNDARY = 18;
const BASE = 4;
const GAP_PENALTY = 1;

/** Score `query` against `text`, or null when the letters are not all there in order. */
export function fuzzyScore(query: string, text: string): Match | null {
    const q = query.trim().toLowerCase();
    const t = text.toLowerCase();
    if (q.length === 0) return { score: 0, positions: [] };
    if (q.length > t.length) return null;

    if (t === q) return { score: EXACT, positions: [...t].map((_, i) => i) };
    if (t.startsWith(q)) {
        return { score: PREFIX + (t.length - q.length) * -0.1, positions: [...q].map((_, i) => i) };
    }

    const positions: number[] = [];
    let score = 0;
    let at = 0;
    let lastMatch = -2;

    for (const ch of q) {
        const found = t.indexOf(ch, at);
        if (found === -1) return null;

        score += BASE;
        if (found === lastMatch + 1) score += CONSECUTIVE;
        if (found === 0 || WORD_START.test(t[found - 1] ?? '')) score += WORD_BOUNDARY;
        // A long reach between letters is weaker evidence than a tight one.
        if (lastMatch >= 0) score -= Math.min(found - lastMatch - 1, 10) * GAP_PENALTY;

        positions.push(found);
        lastMatch = found;
        at = found + 1;
    }

    // All else equal, the shorter name is the better answer.
    return { score: score - t.length * 0.05, positions };
}

export interface Hit {
    node: DocNode;
    score: number;
    /** Which field produced the match, for showing why a result is in the list. */
    via: 'name' | 'id' | 'type' | 'tag';
    positions: number[];
}

/* Names first. An id or a tag matching is a weaker signal than the name matching, and
 * without that ordering a search for a common word returns everything at once. */
const VIA_WEIGHT: Record<Hit['via'], number> = { name: 1, id: 0.85, tag: 0.7, type: 0.5 };

export function searchProject(
    index: GraphIndex,
    project: Project,
    query: string,
    limit = 20,
): Hit[] {
    if (query.trim().length === 0) return [];
    const hits: Hit[] = [];

    for (const node of index.nodes.values()) {
        const candidates: Array<[Hit['via'], string]> = [
            ['name', node.name],
            ['id', node.locator ?? node.id],
        ];

        if (node.kind === 'object') {
            candidates.push(['type', project.templates.get(node.type)?.label ?? node.type]);
            const tags = (node.fields as Record<string, unknown>)['tags'];
            if (Array.isArray(tags)) {
                for (const tag of tags) if (typeof tag === 'string') candidates.push(['tag', tag]);
            }
        }

        let best: Hit | null = null;
        for (const [via, text] of candidates) {
            const match = fuzzyScore(query, text);
            if (!match) continue;
            const score = match.score * VIA_WEIGHT[via];
            if (!best || score > best.score) {
                best = { node, score, via, positions: via === 'name' ? match.positions : [] };
            }
        }
        if (best) hits.push(best);
    }

    return hits.sort((a, b) => b.score - a.score || a.node.name.localeCompare(b.node.name)).slice(0, limit);
}
