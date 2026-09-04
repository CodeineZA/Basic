/* The world as of a point in the progression.
 *
 * Every line here is derived by folding the beats up to the cursor. Nobody typed any of it,
 * and there is no per-phase table anywhere to fall out of date - which is the entire reason
 * the progression document is the authority rather than a description of one. */

import type { GraphIndex } from '../../core/index-graph.ts';
import type { Project } from '../../core/project.ts';
import { foldTo } from '../../core/fold.ts';

export interface WorldPanelProps {
    index: GraphIndex;
    project: Project;
    cursor: string | null;
    onOpenDoc: (path: string) => void;
}

export function WorldPanel({ index, project, cursor, onOpenDoc }: WorldPanelProps): React.JSX.Element {
    const world = foldTo(index, project, cursor);
    const name = (id: string): string => index.nodes.get(id)?.name ?? id;
    const pathOf = (id: string): string | null => {
        const node = index.nodes.get(id);
        return node && node.kind === 'object' ? node.path : null;
    };

    const Link = ({ id }: { id: string }): React.JSX.Element => {
        const path = pathOf(id);
        if (!path) return <>{name(id)}</>;
        return (
            <button type="button" className="link-btn" onClick={() => onOpenDoc(path)}>
                {name(id)}
            </button>
        );
    };

    const here = cursor ? (index.nodes.get(cursor)?.name ?? cursor) : null;
    const vendors = [...world.stock.entries()].sort((a, b) => name(a[0]).localeCompare(name(b[0])));
    const items = [...world.obtainable.entries()].sort((a, b) => name(a[0]).localeCompare(name(b[0])));

    return (
        <>
            <div className="panel-title">
                <span className="eyebrow">The world</span>
                <h2 className="heading">{here ? `As of ${here}` : 'Before anything happens'}</h2>
            </div>

            <p className="muted" style={{ marginTop: 0 }}>
                {world.elapsed.length} of {index.order.length} beats have happened.
            </p>

            {world.elapsed.length === 0 && (
                <p className="empty">Nothing exists yet. Pick a beat to fold the world up to it.</p>
            )}

            {world.introduced.size > 0 && (
                <div className="world-group">
                    <h4>Met so far</h4>
                    <ul className="world-list">
                        {[...world.introduced.entries()].map(([id, beat]) => (
                            <li key={id}>
                                <Link id={id} />
                                <span className="from"> · since {name(beat)}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {world.opened.size > 0 && (
                <div className="world-group">
                    <h4>Reachable</h4>
                    <ul className="world-list">
                        {[...world.opened.entries()].map(([id, beat]) => (
                            <li key={id}>
                                <Link id={id} />
                                <span className="from"> · since {name(beat)}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {vendors.length > 0 && (
                <div className="world-group">
                    <h4>Who sells what</h4>
                    <ul className="world-list">
                        {vendors.map(([vendor, stock]) => (
                            <li key={vendor}>
                                <Link id={vendor} />
                                <span className="from"> · {[...stock].map(name).sort().join(', ')}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {items.length > 0 && (
                <div className="world-group">
                    <h4>Obtainable</h4>
                    <ul className="world-list">
                        {items.map(([item, claims]) => (
                            <li key={item}>
                                <Link id={item} />
                                {/* Provenance again: which beat made this true. */}
                                <span className="from">
                                    {' · '}
                                    {claims.map((c) => `${name(c.from)} (${name(c.beat)})`).join(', ')}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </>
    );
}
