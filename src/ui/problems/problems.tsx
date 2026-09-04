/* Everything Basic thinks is wrong, in one list.
 *
 * Each finding names the document and the field it came from and can be opened, because a
 * complaint you cannot navigate to is just nagging. Nothing here is phrased as a verdict on
 * the design - "no beat grants this" is a fact; "this is bad" would not be. */

import type { Problem } from '../../core/types.ts';

export interface ProblemsProps {
    problems: Problem[];
    onOpenDoc: (path: string) => void;
}

/** What each rule is actually telling you, in one line. */
const EXPLAIN: Record<string, string> = {
    'beat/complete-without-verify': 'Done has to mean something a person could check.',
    'beat/unreachable': 'Ordering: this beat depends on something that has not happened yet.',
    'beat/anachronism': 'Ordering: something is used before the beat that introduces it.',
    'beat/asserts-nothing': 'A beat with no effect will not show up anywhere else.',
    'object/orphan': 'Nothing in the design places this in the world.',
    'item/no-source': 'No beat grants, sells or drops this.',
    'item/never-available': 'It has a source, but no beat makes it available.',
    'ref/unknown': 'A link that points at no document.',
};

export function Problems({ problems, onOpenDoc }: ProblemsProps): React.JSX.Element {
    const errors = problems.filter((p) => p.severity === 'error');
    const warnings = problems.filter((p) => p.severity === 'warning');

    const List = ({ items }: { items: Problem[] }): React.JSX.Element => (
        <ul className="problem-list">
            {items.map((p, i) => (
                <li className={`problem-row is-${p.severity}`} key={`${p.rule}-${i}`}>
                    <div className="problem-main">
                        <span className="problem-message">{p.message}</span>
                        <span className="rule">{p.rule}</span>
                    </div>
                    <div className="problem-meta">
                        {EXPLAIN[p.rule] && <span className="muted">{EXPLAIN[p.rule]}</span>}
                        {p.file && (
                            <button type="button" className="link-btn" onClick={() => onOpenDoc(p.file!)}>
                                {p.file}{p.locator ? ` · ${p.locator}` : ''}
                            </button>
                        )}
                    </div>
                </li>
            ))}
        </ul>
    );

    return (
        <div className="problems">
            <div className="panel-title">
                <span className="eyebrow">Problems</span>
                {/* A count, never a verdict. "Looks good" is not something this can know. */}
                <h2 className="heading">
                    {errors.length} {errors.length === 1 ? 'error' : 'errors'}
                    {' · '}
                    {warnings.length} {warnings.length === 1 ? 'warning' : 'warnings'}
                </h2>
            </div>

            {problems.length === 0 && (
                <p className="empty">
                    Nothing to report. That means every reference resolves and the ordering
                    holds — not that the design is finished.
                </p>
            )}

            {errors.length > 0 && (
                <>
                    <p className="tree-group">Errors</p>
                    <List items={errors} />
                </>
            )}

            {warnings.length > 0 && (
                <>
                    <p className="tree-group">Warnings</p>
                    <List items={warnings} />
                </>
            )}
        </div>
    );
}
