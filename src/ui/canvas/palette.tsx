/* The right-hand palette: things to drag onto a canvas.
 *
 * Two halves, because there are two things someone reaches for. The top makes a NEW thing of
 * a kind and drops it on; the bottom drops something that already exists. Both are drags, so
 * the gesture is the same either way. */

import { useMemo, useState } from 'react';
import type { GraphIndex } from '../../core/index-graph.ts';
import type { Project } from '../../core/project.ts';
import { searchProject } from '../../core/search.ts';
import { DRAG_TYPE } from './authored.tsx';

/** Marks a drag as "make one of these first". */
export const NEW_PREFIX = 'new:';

export interface PaletteProps {
    index: GraphIndex;
    project: Project;
    /** Refs already on the canvas, so they are not offered twice. */
    present: Set<string>;
}

export function Palette({ index, project, present }: PaletteProps): React.JSX.Element {
    const [query, setQuery] = useState('');

    const existing = useMemo(() => {
        if (query.trim()) return searchProject(index, project, query, 20).map((h) => h.node);
        return [...index.nodes.values()]
            .filter((n) => n.kind !== 'act')
            .sort((a, b) => a.name.localeCompare(b.name))
            .slice(0, 40);
    }, [index, project, query]);

    const drag = (payload: string) => (e: React.DragEvent): void => {
        e.dataTransfer.setData(DRAG_TYPE, payload);
        e.dataTransfer.effectAllowed = 'copy';
    };

    return (
        <>
            <div className="panel-title">
                <span className="eyebrow">Palette</span>
                <h2 className="heading">Drag onto the canvas</h2>
            </div>

            <p className="tree-group">Make something new</p>
            <ul className="tree">
                {[...project.templates.values()].map((t) => (
                    <li key={t.id}>
                        <span
                            className="tree-item is-draggable"
                            draggable
                            onDragStart={drag(`${NEW_PREFIX}${t.id}`)}
                            title={`Drag to add a new ${t.label.toLowerCase()}`}
                        >
                            <span className="swatch" style={{ '--card-accent': t.color ?? 'var(--accent)' } as React.CSSProperties} />
                            <span>New {t.label.toLowerCase()}</span>
                            <span className="grip" aria-hidden="true">⠿</span>
                        </span>
                    </li>
                ))}
            </ul>

            <p className="tree-group">Something that exists</p>
            <div className="search">
                <input
                    type="search"
                    value={query}
                    placeholder="Find…"
                    aria-label="Find something to drag on"
                    onChange={(e) => setQuery(e.target.value)}
                />
            </div>

            <ul className="tree">
                {existing.length === 0 && <li className="empty">Nothing matches.</li>}
                {existing.map((node) => {
                    const on = present.has(node.id);
                    const template = project.templates.get(node.type);
                    return (
                        <li key={node.id}>
                            <span
                                className={`tree-item${on ? ' is-placed' : ' is-draggable'}`}
                                draggable={!on}
                                onDragStart={on ? undefined : drag(node.id)}
                                title={on ? 'Already on this canvas' : `Drag ${node.name} onto the canvas`}
                            >
                                <span
                                    className="swatch"
                                    style={{ '--card-accent': node.kind === 'beat' ? 'var(--accent)' : (template?.color ?? 'var(--accent)') } as React.CSSProperties}
                                />
                                <span>{node.name}</span>
                                {/* Already-placed says so rather than silently refusing the drag. */}
                                <span className="grip" aria-hidden="true">{on ? '✓' : '⠿'}</span>
                            </span>
                        </li>
                    );
                })}
            </ul>
        </>
    );
}
