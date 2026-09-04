/* The right-hand panel: the palette until something is selected, the inspector
 * after that.
 *
 * Every relation row names the file and field that claimed it. That provenance
 * is the point of the whole design - a link you cannot trace back to a source
 * is a link you cannot correct. */

import type { GraphIndex } from '../../core/index-graph.ts';
import { incoming, outgoing } from '../../core/index-graph.ts';
import type { Project } from '../../core/project.ts';
import type { Edge } from '../../core/types.ts';

export interface InspectorProps {
    index: GraphIndex;
    project: Project;
    selected: string | null;
    onOpenDoc: (path: string) => void;
}

function sourceLabel(edge: Edge): string {
    const file = edge.source.file.split('/').pop() ?? edge.source.file;
    return edge.source.locator ? `${file} · ${edge.source.locator}` : file;
}

export function Inspector({ index, project, selected, onOpenDoc }: InspectorProps): React.JSX.Element {
    const node = selected ? index.nodes.get(selected) : null;

    if (!node) {
        return (
            <>
                <div className="panel-title">
                    <span className="eyebrow">Palette</span>
                    <h2 className="heading">Add to canvas</h2>
                </div>
                <ul className="tree">
                    {[...project.templates.values()].map((t) => (
                        <li key={t.id}>
                            <span className="tree-item">
                                <span className="swatch" style={{ '--card-accent': t.color ?? 'var(--accent)' } as React.CSSProperties} />
                                <span>{t.label}</span>
                            </span>
                        </li>
                    ))}
                </ul>
                <p className="empty">Select a card to inspect it.</p>
            </>
        );
    }

    const out = outgoing(index, node.id).filter((e) => e.rel !== 'MENTIONS');
    const inc = incoming(index, node.id).filter((e) => e.rel !== 'MENTIONS');
    const name = (id: string): string => index.nodes.get(id)?.name ?? id;

    const rows = (edges: Edge[], direction: 'in' | 'out'): React.JSX.Element => (
        <ul className="rel-list">
            {edges.length === 0 && <li className="empty">Nothing yet.</li>}
            {edges.map((e, i) => {
                const rel = project.relations.get(e.rel);
                const label = direction === 'out' ? (rel?.label ?? e.rel) : (rel?.inverseLabel ?? rel?.inverse ?? e.rel);
                const other = direction === 'out' ? e.to : e.from;
                return (
                    <li key={i}>
                        <span className="rel-name">{label} {name(other)}</span>
                        <span className="rel-source">{sourceLabel(e)}</span>
                    </li>
                );
            })}
        </ul>
    );

    return (
        <>
            <div className="panel-title">
                <span className="eyebrow">{node.kind === 'beat' ? 'Beat' : (project.templates.get(node.type)?.label ?? node.type)}</span>
                <h2 className="heading">{node.name}</h2>
            </div>

            {node.kind === 'object' && (
                <div className="btn-row" style={{ marginBottom: 'var(--s-5)' }}>
                    <button type="button" className="btn" onClick={() => onOpenDoc(node.path)}>
                        Open {node.path.split('/').pop()}
                    </button>
                </div>
            )}

            <div className="inspector-field">
                <span className="label">Asserts</span>
                {rows(out, 'out')}
            </div>

            <div className="inspector-field">
                <span className="label">Claimed by</span>
                {rows(inc, 'in')}
            </div>
        </>
    );
}
