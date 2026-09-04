/* Everything Basic can tell you is wrong, in one place.
 *
 * Two kinds of finding. Referential mistakes - a link to nothing - come out of the indexer,
 * because that is where references are resolved. The interesting ones are here: they need
 * the ORDER of the progression, which is the one thing a wiki does not have and the reason
 * this tool can say something a pile of Markdown cannot.
 *
 * Errors block. Warnings inform. Nothing here guesses: every finding names the document and
 * the field it came from, so it can be gone and looked at rather than argued with. */

import { foldTo, findAnachronisms, existsAt } from './fold.ts';
import { outgoing, requirementRefs, type GraphIndex } from './index-graph.ts';
import { relsFor, type Project } from './project.ts';
import type { DocNode, Problem, Requirement } from './types.ts';

export const COMPLETE = 'complete';

/** A beat's own text, whatever shape it is in. */
const fieldsOf = (node: DocNode): Record<string, unknown> => node.fields as Record<string, unknown>;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/* "Done" has to mean something a person could check. A beat marked complete with no way to
 * tell whether it works is a claim, not a fact - so the app refuses to record it. */
export function canComplete(beat: DocNode): boolean {
    return str(fieldsOf(beat)['verify']).length > 0;
}

export interface Rollup {
    /** How many beats sit in each status. */
    counts: Record<string, number>;
    total: number;
    complete: number;
    /** The act's status, DERIVED. Never read from the file, never settable. */
    status: string;
}

/* An act's status is computed from its beats and cannot be typed in.
 *
 * A green act sitting on top of red beats is exactly the fabricated metric the house rules
 * forbid, and the only reliable way to prevent it is to make the number underivable from
 * anything but the work itself. */
export function rollupOf(index: GraphIndex, actId: string, statuses: string[]): Rollup {
    const counts: Record<string, number> = Object.fromEntries(statuses.map((s) => [s, 0]));
    let total = 0;

    for (const id of index.order) {
        if (!id.startsWith(`${actId}#`)) continue;
        const status = index.nodes.get(id)?.status ?? statuses[0] ?? 'pending';
        counts[status] = (counts[status] ?? 0) + 1;
        total++;
    }

    const complete = counts[COMPLETE] ?? 0;
    const first = statuses[0] ?? 'pending';
    const status = total === 0 ? first
        : complete === total ? COMPLETE
            : complete === 0 && (counts[first] ?? 0) === total ? first
                : 'in-progress';

    return { counts, total, complete, status };
}

const problem = (
    severity: Problem['severity'],
    rule: string,
    message: string,
    file?: string,
    locator?: string,
): Problem => ({
    severity, rule, message,
    ...(file === undefined ? {} : { file }),
    ...(locator === undefined ? {} : { locator }),
});

/** Everything wrong with the project, most serious first. */
export function validateProject(index: GraphIndex, project: Project): Problem[] {
    const out: Problem[] = [...index.problems];
    const position = new Map(index.order.map((id, at) => [id, at]));

    /* -- a beat cannot be done if done was never defined ------------------- */

    for (const id of index.order) {
        const beat = index.nodes.get(id);
        if (!beat || beat.status !== COMPLETE || canComplete(beat)) continue;
        out.push(problem(
            'error', 'beat/complete-without-verify',
            `'${beat.name}' is marked complete but has no 'verify', so there is no way to tell whether it works`,
            beat.path, beat.locator,
        ));
    }

    /* -- content that can never be reached --------------------------------- */

    for (const id of index.order) {
        const beat = index.nodes.get(id);
        if (!beat) continue;
        const at = position.get(id)!;

        for (const ref of requirementRefs(fieldsOf(beat)['requires'] as Requirement | undefined)) {
            const target = index.nodes.has(ref) ? ref : index.order.find((b) => index.nodes.get(b)?.locator === ref);
            if (!target) continue; // an unknown reference is the indexer's finding, not ours
            const targetAt = position.get(target);
            if (targetAt === undefined || targetAt < at) continue;

            out.push(problem(
                'error', 'beat/unreachable',
                targetAt === at
                    ? `'${beat.name}' requires itself, so it can never be reached`
                    : `'${beat.name}' requires '${index.nodes.get(target)?.name ?? target}', which happens later - this beat can never be reached`,
                beat.path, beat.locator,
            ));
        }
    }

    /* -- using something before it exists ----------------------------------- */

    for (const a of findAnachronisms(index, project)) {
        const beat = index.nodes.get(a.beat);
        const entity = index.nodes.get(a.entity);
        const after = a.introducedBy ? index.nodes.get(a.introducedBy)?.name ?? a.introducedBy : null;
        out.push(problem(
            'error', 'beat/anachronism',
            after
                ? `'${beat?.name ?? a.beat}' uses '${entity?.name ?? a.entity}' before '${after}' introduces them`
                : `'${beat?.name ?? a.beat}' uses '${entity?.name ?? a.entity}', which no beat ever introduces`,
            beat?.path, `${beat?.locator ?? ''}.${a.via}`,
        ));
    }

    /* -- things nobody can get, and things nothing points at ---------------- */

    const obtainRels = relsFor(project, { group: 'obtain' });
    const world = foldTo(index, project, index.order.at(-1) ?? null);

    for (const node of index.nodes.values()) {
        if (node.kind !== 'object') continue;

        const incoming = index.byTo.get(node.id) ?? [];
        const placed = incoming.filter((e) => e.rel !== 'MENTIONS');
        if (placed.length === 0) {
            out.push(problem(
                'warning', 'object/orphan',
                `nothing in the design places '${node.name}' in the world`,
                node.path,
            ));
            continue;
        }

        /* Only complain about obtainability for types that say they care - the template
         * declaring an "obtain" section IS the statement that this kind of thing is got
         * somehow. A location has no business having a source. */
        const wantsSource = (project.templates.get(node.type)?.sections ?? []).some(
            (s) => 'incoming' in s.query && !Array.isArray(s.query.incoming) && s.query.incoming.group === 'obtain',
        );
        if (!wantsSource) continue;

        if (!incoming.some((e) => obtainRels.includes(e.rel))) {
            out.push(problem(
                'warning', 'item/no-source',
                `'${node.name}' cannot be obtained anywhere - no beat grants, sells or drops it`,
                node.path,
            ));
        } else if (!existsAt(world, node.id)) {
            out.push(problem(
                'warning', 'item/never-available',
                `'${node.name}' has a source, but no beat makes it available`,
                node.path,
            ));
        }
    }

    /* -- a beat that does nothing ------------------------------------------- */

    for (const id of index.order) {
        const beat = index.nodes.get(id);
        if (!beat) continue;
        const asserts = outgoing(index, id).some((e) => e.rel !== 'REQUIRES' && e.rel !== 'MENTIONS');
        const brokers = index.edges.some((e) => e.beat === id && e.from !== id);
        if (asserts || brokers) continue;
        out.push(problem(
            'warning', 'beat/asserts-nothing',
            `'${beat.name}' does not change anything - no one is introduced, nothing opens or changes hands`,
            beat.path, beat.locator,
        ));
    }

    const rank = { error: 0, warning: 1 };
    return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
