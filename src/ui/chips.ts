/* Turning a requirement expression into something readable at a glance.
 *
 * Shared by the canvas and the script view, because a gate should read identically wherever
 * it appears - two phrasings for one condition is two things to learn. */

import { resolveId, type GraphIndex } from '../core/index-graph.ts';
import type { Requirement } from '../core/types.ts';

export interface Gate {
    icon: string;
    text: string;
}

/** Flatten a requirement into chips. Colour is never the only signal, so each carries words. */
export function gateChips(req: Requirement | undefined, index: GraphIndex): Gate[] {
    const name = (ref: string): string => {
        const id = resolveId(index, ref);
        return id ? (index.nodes.get(id)?.name ?? ref) : ref;
    };
    const out: Gate[] = [];

    const walk = (r: Requirement | undefined, negated = false): void => {
        if (!r || typeof r !== 'object') return;
        const lock = negated ? '⊘' : '🔒';
        if ('all' in r) { for (const sub of r.all) walk(sub, negated); return; }
        if ('any' in r) { for (const sub of r.any) walk(sub, negated); return; }
        if ('not' in r) { walk(r.not, !negated); return; }
        if ('flag' in r) { out.push({ icon: lock, text: `flag ${r.flag}` }); return; }
        if ('has' in r) { out.push({ icon: lock, text: `has ${name(r.has)}` }); return; }
        if ('done' in r) { out.push({ icon: lock, text: `after ${name(r.done)}` }); return; }
        if ('visited' in r) { out.push({ icon: lock, text: `visited ${name(r.visited)}` }); return; }
        if ('counter' in r) { out.push({ icon: lock, text: `${r.counter} ${r.op} ${r.n}` }); }
    };

    walk(req);
    return out;
}
