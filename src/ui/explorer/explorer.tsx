/* The project explorer: everything in the project, grouped by what it is. */

import type { GraphIndex } from '../../core/index-graph.ts';
import type { Project } from '../../core/project.ts';
import type { DocNode } from '../../core/types.ts';

export interface ExplorerProps {
    index: GraphIndex;
    project: Project;
    currentTab: string | null;
    onOpenAct: (actId: string) => void;
    onOpenDoc: (path: string) => void;
}

export function Explorer({ index, project, currentTab, onOpenAct, onOpenDoc }: ExplorerProps): React.JSX.Element {
    const acts = [...index.nodes.values()].filter((n) => n.kind === 'act');

    const byType = new Map<string, DocNode[]>();
    for (const node of index.nodes.values()) {
        if (node.kind !== 'object') continue;
        const list = byType.get(node.type) ?? [];
        list.push(node);
        byType.set(node.type, list);
    }

    return (
        <>
            <div className="panel-title">
                <span className="eyebrow">Project</span>
                <h2 className="heading">{project.name}</h2>
            </div>

            <p className="tree-group">Progression</p>
            <ul className="tree">
                {acts.length === 0 && <li className="empty">No acts yet.</li>}
                {acts.map((act) => (
                    <li key={act.id}>
                        <button
                            type="button"
                            className="tree-item"
                            aria-current={currentTab === `act:${act.id}`}
                            onClick={() => onOpenAct(act.id)}
                        >
                            <span className="swatch" style={{ '--card-accent': 'var(--accent)' } as React.CSSProperties} />
                            <span>{act.name}</span>
                        </button>
                    </li>
                ))}
            </ul>

            {[...byType.entries()].sort().map(([type, list]) => {
                const template = project.templates.get(type);
                return (
                    <div key={type}>
                        <p className="tree-group">{template?.label ?? type}</p>
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
        </>
    );
}
