/* The project explorer: everything in the project, grouped by what it is - and a search box
 * that replaces the tree while you are typing, because a filtered tree and a result list are
 * two ways of showing the same thing and only one of them can rank. */

import { useMemo, useState } from 'react';
import type { GraphIndex } from '../../core/index-graph.ts';
import type { Project } from '../../core/project.ts';
import type { DocNode } from '../../core/types.ts';
import { rollupOf } from '../../core/validate.ts';
import { searchProject, type Hit } from '../../core/search.ts';
import { fieldKey } from '../../core/edit-schema.ts';

export interface ExplorerProps {
    index: GraphIndex;
    project: Project;
    currentTab: string | null;
    onOpenAct: (actId: string) => void;
    onOpenDoc: (path: string) => void;
    onOpenRef: (id: string) => void;
    onOpenTemplate: (id: string) => void;
    onOpenRelations: () => void;
    onOpenTable: (type: string) => void;
    onCreateTemplate: (id: string, label: string) => void;
}

/** Show which letters matched, so a fuzzy result does not look like a random one. */
function Highlight({ text, positions }: { text: string; positions: number[] }): React.JSX.Element {
    if (positions.length === 0) return <>{text}</>;
    const set = new Set(positions);
    return (
        <span>
            {[...text].map((ch, i) => (set.has(i) ? <mark key={i}>{ch}</mark> : <span key={i}>{ch}</span>))}
        </span>
    );
}

export function Explorer(props: ExplorerProps): React.JSX.Element {
    const { index, project, currentTab, onOpenAct, onOpenDoc, onOpenRef } = props;
    const [newType, setNewType] = useState('');
    const [query, setQuery] = useState('');

    const hits = useMemo(
        () => searchProject(index, project, query, 25),
        [index, project, query],
    );

    const acts = [...index.nodes.values()].filter((n) => n.kind === 'act');

    const byType = new Map<string, DocNode[]>();
    for (const node of index.nodes.values()) {
        if (node.kind !== 'object') continue;
        const list = byType.get(node.type) ?? [];
        list.push(node);
        byType.set(node.type, list);
    }

    const kindOf = (hit: Hit): string => {
        if (hit.node.kind === 'act') return 'act';
        if (hit.node.kind === 'beat') return 'beat';
        return project.templates.get(hit.node.type)?.label ?? hit.node.type;
    };

    return (
        <>
            <div className="panel-title">
                <span className="eyebrow">Project</span>
                <h2 className="heading">{project.name}</h2>
            </div>

            <div className="search">
                <input
                    type="search"
                    value={query}
                    placeholder="Search…"
                    aria-label="Search the project"
                    onChange={(e) => setQuery(e.target.value)}
                />
            </div>

            {query.trim().length > 0 ? (
                <ul className="search-results">
                    {hits.length === 0 && (
                        <li className="empty search-empty">Nothing matches “{query.trim()}”.</li>
                    )}
                    {hits.map((hit) => (
                        <li key={hit.node.id}>
                            <button
                                type="button"
                                className="search-hit"
                                onClick={() => { onOpenRef(hit.node.id); setQuery(''); }}
                            >
                                <Highlight text={hit.node.name} positions={hit.positions} />
                                {/* Say why this is in the list when the name was not the match. */}
                                <span className="via">
                                    {hit.via === 'name' ? kindOf(hit) : `${kindOf(hit)} · ${hit.via}`}
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            ) : (
                <>
                    <p className="tree-group">Progression</p>
                    <ul className="tree">
                        {acts.length === 0 && <li className="empty">No acts yet.</li>}
                        {acts.map((act) => {
                            /* Derived from the act's beats, so the project picture here can
                             * never disagree with the board. */
                            const roll = rollupOf(index, act.id, project.statuses);
                            return (
                                <li key={act.id}>
                                    <button
                                        type="button"
                                        className="tree-item"
                                        aria-current={currentTab === `act:${act.id}`}
                                        title={roll.total === 0
                                            ? 'No beats yet'
                                            : `${roll.complete} of ${roll.total} beats complete`}
                                        onClick={() => onOpenAct(act.id)}
                                    >
                                        <span className="swatch" style={{ '--card-accent': 'var(--accent)' } as React.CSSProperties} />
                                        <span>{act.name}</span>
                                        {roll.total > 0 && (
                                            <span className="mini-bar" aria-hidden="true">
                                                {project.statuses.map((s) => {
                                                    const n = roll.counts[s] ?? 0;
                                                    return n === 0 ? null : (
                                                        <span key={s} className={`mini-seg status-${s}`} style={{ flexGrow: n }} />
                                                    );
                                                })}
                                            </span>
                                        )}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>

                    {[...byType.entries()].sort().map(([type, list]) => {
                        const template = project.templates.get(type);
                        return (
                            <div key={type}>
                                <p className="tree-group with-action">
                                    <span>{template?.label ?? type}</span>
                                    {/* Balancing wants every one of them side by side. */}
                                    <button
                                        type="button"
                                        className="link-btn"
                                        title={`See every ${(template?.label ?? type).toLowerCase()} in a table`}
                                        onClick={() => props.onOpenTable(type)}
                                    >table</button>
                                </p>
                                <ul className="tree">
                                    {list.sort((a, b) => a.name.localeCompare(b.name)).map((node) => (
                                        <li key={node.id}>
                                            <button
                                                type="button"
                                                className="tree-item"
                                                aria-current={currentTab === `doc:${node.path}`}
                                                onClick={() => onOpenDoc(node.path)}
                                            >
                                                <span
                                                    className="swatch"
                                                    style={{ '--card-accent': template?.color ?? 'var(--accent)' } as React.CSSProperties}
                                                />
                                                <span>{node.name}</span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        );
                    })}

                    <p className="tree-group">Schema</p>
                    <ul className="tree">
                        {[...project.templates.values()].map((t) => (
                            <li key={t.id}>
                                <button
                                    type="button"
                                    className="tree-item"
                                    aria-current={currentTab === `tpl:${t.id}`}
                                    onClick={() => props.onOpenTemplate(t.id)}
                                >
                                    <span
                                        className="swatch"
                                        style={{ '--card-accent': t.color ?? 'var(--accent)' } as React.CSSProperties}
                                    />
                                    <span>{t.label} template</span>
                                    <span className="muted count">{t.fields.length}</span>
                                </button>
                            </li>
                        ))}
                        <li>
                            <button
                                type="button"
                                className="tree-item"
                                aria-current={currentTab === 'relations'}
                                onClick={props.onOpenRelations}
                            >
                                <span className="swatch" style={{ '--card-accent': 'var(--ink-3)' } as React.CSSProperties} />
                                <span>Relations</span>
                                <span className="muted count">{project.relations.size}</span>
                            </button>
                        </li>
                    </ul>

                    <div className="field-add" style={{ marginBottom: 'var(--s-5)' }}>
                        <input
                            value={newType}
                            placeholder="New kind of thing…"
                            aria-label="Name a new kind of thing"
                            onChange={(e) => setNewType(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key !== 'Enter') return;
                                const label = newType.trim();
                                const id = fieldKey(label);
                                if (!label || !id || project.templates.has(id)) return;
                                props.onCreateTemplate(id, label);
                                setNewType('');
                            }}
                        />
                    </div>
                </>
            )}
        </>
    );
}
