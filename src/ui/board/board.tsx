/* Developer mode: the progression as work to be done.
 *
 * The script view answers "what happens". This answers "what is built", which is the
 * question someone implementing it has. Same beats, same data, grouped by status.
 *
 * Two rules are enforced here rather than merely displayed:
 *   - an act's status is DERIVED from its beats and cannot be set, so a green act can never
 *     sit on top of red work;
 *   - a beat cannot be marked complete without a `verify`, because "done" has to mean
 *     something a person could check. */

import { outgoing, type GraphIndex } from '../../core/index-graph.ts';
import type { Project } from '../../core/project.ts';
import type { DocNode } from '../../core/types.ts';
import { canComplete, COMPLETE, rollupOf } from '../../core/validate.ts';

export interface BoardProps {
    index: GraphIndex;
    project: Project;
    actId: string;
    selected: string | null;
    onSelect: (beatId: string) => void;
    onSetStatus: (beatLocator: string, status: string) => void;
    onOpenDoc: (path: string) => void;
}

/** A short account of what a beat actually changes, for a card too small for detail. */
function summarise(index: GraphIndex, beatId: string): string {
    const kinds = new Set<string>();
    for (const e of outgoing(index, beatId)) {
        if (e.rel === 'INTRODUCES') kinds.add('introduces');
        if (e.rel === 'OPENS') kinds.add('opens a place');
        if (e.rel === 'FEATURES') kinds.add('features');
    }
    for (const e of index.edges) {
        if (e.beat !== beatId || e.from === beatId) continue;
        if (e.rel === 'GRANTS') kinds.add('hands something over');
        if (e.rel === 'SELLS') kinds.add('puts something on sale');
        if (e.rel === 'DROPS') kinds.add('drops something');
    }
    return [...kinds].join(' · ');
}

export function Board({ index, project, actId, selected, onSelect, onSetStatus, onOpenDoc }: BoardProps): React.JSX.Element {
    const act = index.nodes.get(actId);
    const statuses = project.statuses;
    const roll = rollupOf(index, actId, statuses);

    const beats = index.order
        .filter((id) => id.startsWith(`${actId}#`))
        .map((id) => index.nodes.get(id))
        .filter((n): n is DocNode => Boolean(n));

    const numberOf = new Map(beats.map((b, i) => [b.id, i + 1]));
    const percent = roll.total === 0 ? 0 : Math.round((roll.complete / roll.total) * 100);

    return (
        <div className="board">
            <header className="board-head">
                <div className="panel-title">
                    <span className="eyebrow">Developer mode</span>
                    <h2 className="heading">{act?.name ?? actId}</h2>
                </div>

                <div className="rollup">
                    {/* Derived, never settable. The bar is a second reading of the number
                        beside it, not the only one. */}
                    <div className="rollup-bar" role="img" aria-label={`${roll.complete} of ${roll.total} beats complete`}>
                        {statuses.map((s) => {
                            const n = roll.counts[s] ?? 0;
                            if (n === 0) return null;
                            return (
                                <span
                                    key={s}
                                    className={`rollup-seg status-${s}`}
                                    style={{ flexGrow: n }}
                                    title={`${n} ${s.replace('-', ' ')}`}
                                />
                            );
                        })}
                        {roll.total === 0 && <span className="rollup-seg is-empty" style={{ flexGrow: 1 }} />}
                    </div>
                    <p className="rollup-text">
                        {roll.total === 0
                            ? 'No beats yet.'
                            : <>
                                <strong>{roll.complete} of {roll.total}</strong> complete ({percent}%)
                                {' · act is '}<strong>{roll.status.replace('-', ' ')}</strong>
                            </>}
                    </p>
                </div>
            </header>

            <div className="columns">
                {statuses.map((status) => {
                    const inColumn = beats.filter((b) => (b.status ?? statuses[0]) === status);
                    return (
                        <section className={`column status-${status}`} key={status}>
                            <h3 className="column-head">
                                <span className="status-dot" aria-hidden="true" />
                                <span>{status.replace('-', ' ')}</span>
                                <span className="column-count">{inColumn.length}</span>
                            </h3>

                            <ul className="column-list">
                                {inColumn.length === 0 && <li className="empty">Nothing here.</li>}
                                {inColumn.map((beat) => {
                                    const at = statuses.indexOf(status);
                                    const verified = canComplete(beat);
                                    const summary = summarise(index, beat.id);

                                    /* The one thing the board will not let you do. Disabled
                                       with a reason, not hidden - hiding it would look like
                                       a bug rather than a rule. */
                                    const nextIs = statuses[at + 1];
                                    const blocked = nextIs === COMPLETE && !verified;

                                    return (
                                        <li
                                            key={beat.id}
                                            className={`ticket${selected === beat.id ? ' is-selected' : ''}`}
                                            onClick={() => onSelect(beat.id)}
                                        >
                                            <div className="ticket-head">
                                                <span className="beat-no">{numberOf.get(beat.id)}</span>
                                                <span className="ticket-title">{beat.name}</span>
                                            </div>

                                            {summary && <p className="ticket-summary">{summary}</p>}

                                            <p className={`ticket-verify${verified ? '' : ' is-unset'}`}>
                                                {verified
                                                    ? String((beat.fields as Record<string, unknown>)['verify'])
                                                    : '— no verify, so this cannot be marked complete'}
                                            </p>

                                            <div className="ticket-foot" onClick={(e) => e.stopPropagation()}>
                                                <button
                                                    type="button" className="icon-btn" title="Move back"
                                                    disabled={at === 0}
                                                    onClick={() => onSetStatus(beat.locator!, statuses[at - 1]!)}
                                                >‹</button>
                                                <button
                                                    type="button" className="icon-btn"
                                                    title={blocked
                                                        ? 'Give this beat a verify before marking it complete'
                                                        : 'Move forward'}
                                                    disabled={at === statuses.length - 1 || blocked}
                                                    onClick={() => onSetStatus(beat.locator!, nextIs!)}
                                                >›</button>
                                                <button
                                                    type="button" className="link-btn"
                                                    onClick={() => act && onOpenDoc(act.path)}
                                                >open act</button>
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        </section>
                    );
                })}
            </div>
        </div>
    );
}
