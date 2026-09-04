/* A page, read rather than edited.
 *
 * This is the half of Basic that is meant to feel like a wiki: prose, links that take you
 * everywhere, and underneath it a list of everything that points back - each row naming the
 * document and field that claimed it, because a link you cannot trace is a link you cannot
 * correct.
 *
 * A link pointing at nothing is not hidden or silently dropped. It is marked, and clicking
 * it offers to make the page, which is how a wiki grows. */

import { useMemo, useState } from 'react';
import { renderPage, unresolvedLinks } from '../../core/render.ts';
import { incoming, outgoing, type GraphIndex } from '../../core/index-graph.ts';
import type { Project } from '../../core/project.ts';
import type { Edge } from '../../core/types.ts';

export interface PageProps {
    index: GraphIndex;
    project: Project;
    path: string;
    text: string;
    onOpenDoc: (path: string) => void;
    onOpenRef: (id: string) => void;
    onCreate: (type: string, id: string) => void;
}

/** A tidy label for an edge seen from the far end. */
function label(project: Project, edge: Edge, direction: 'in' | 'out'): string {
    const rel = project.relations.get(edge.rel);
    if (!rel) return edge.rel;
    return direction === 'in' ? (rel.inverseLabel ?? rel.inverse) : (rel.label ?? rel.id);
}

export function Page({ index, project, path, text, onOpenDoc, onOpenRef, onCreate }: PageProps): React.JSX.Element {
    const [creating, setCreating] = useState<string | null>(null);

    const node = useMemo(
        () => [...index.nodes.values()].find((n) => n.path === path && n.kind !== 'beat'),
        [index, path],
    );

    const rendered = useMemo(() => renderPage(text, {
        exists: (id) => index.nodes.has(id) || index.order.some((b) => index.nodes.get(b)?.locator === id),
        displayName: (id) => index.nodes.get(id)?.name ?? id,
    }), [text, index]);

    const dead = useMemo(
        () => unresolvedLinks(text, (id) => index.nodes.has(id)
            || index.order.some((b) => index.nodes.get(b)?.locator === id)),
        [text, index],
    );

    /* One handler for the whole rendered body. Individual links are produced by markdown-it
     * and have no React identity to attach to. */
    const onClick = (e: React.MouseEvent<HTMLDivElement>): void => {
        const anchor = (e.target as HTMLElement).closest('a');
        if (!anchor) return;
        const ref = anchor.getAttribute('data-ref');
        if (!ref) return; // an ordinary external link; let it be
        e.preventDefault();
        if (anchor.classList.contains('is-missing')) setCreating(ref);
        else onOpenRef(ref);
    };

    const inbound = node ? incoming(index, node.id) : [];
    const outbound = node ? outgoing(index, node.id) : [];
    const name = (id: string): string => index.nodes.get(id)?.name ?? id;

    const Rows = ({ edges, direction }: { edges: Edge[]; direction: 'in' | 'out' }): React.JSX.Element => (
        <ul className="backlinks">
            {edges.length === 0 && <li className="empty">Nothing yet.</li>}
            {edges.map((e, i) => (
                <li key={i}>
                    <span className="backlink-rel">{label(project, e, direction)}</span>
                    <button type="button" className="link-btn" onClick={() => onOpenRef(direction === 'in' ? e.from : e.to)}>
                        {name(direction === 'in' ? e.from : e.to)}
                    </button>
                    {/* Provenance. Which file, and which field in it, made this claim. */}
                    <button
                        type="button"
                        className="backlink-source"
                        title="Open the document that claims this"
                        onClick={() => onOpenDoc(e.source.file)}
                    >
                        {e.source.file.split('/').pop()}
                        {e.source.locator ? ` · ${e.source.locator}` : ''}
                    </button>
                </li>
            ))}
        </ul>
    );

    return (
        <div className="page">
            <article className="page-body" onClick={onClick}>
                {node && (
                    <div className="panel-title">
                        <span className="eyebrow">{project.templates.get(node.type)?.label ?? node.type}</span>
                        <h1 className="heading page-title">{node.name}</h1>
                    </div>
                )}

                {rendered.parts.length === 0 && (
                    <p className="empty">This page has no prose yet.</p>
                )}

                {rendered.parts.map((part, i) => (
                    part.kind === 'prose'
                        ? <div key={i} className="prose" dangerouslySetInnerHTML={{ __html: part.html }} />
                        : (
                            <section key={i} className="page-generated">
                                <span className="page-generated-tag">maintained by Basic</span>
                                <div className="prose" dangerouslySetInnerHTML={{ __html: part.html }} />
                            </section>
                        )
                ))}

                {creating && (
                    <div className="notice" role="dialog" aria-label={`Create a page for ${creating}`}>
                        <p style={{ margin: '0 0 var(--s-3)' }}>
                            <strong>{creating}</strong> has no page yet. What kind of thing is it?
                        </p>
                        <div className="btn-row">
                            {[...project.templates.values()].map((t) => (
                                <button
                                    key={t.id}
                                    type="button"
                                    className="btn"
                                    onClick={() => { onCreate(t.id, creating); setCreating(null); }}
                                >
                                    {t.label}
                                </button>
                            ))}
                            <button type="button" className="link-btn" onClick={() => setCreating(null)}>
                                Cancel
                            </button>
                        </div>
                    </div>
                )}

                {dead.length > 0 && !creating && (
                    <p className="muted page-dead">
                        {dead.length === 1 ? 'One link on this page points' : `${dead.length} links on this page point`}
                        {' at nothing yet: '}
                        {dead.map((id, i) => (
                            <span key={id}>
                                {i > 0 && ', '}
                                <button type="button" className="link-btn" onClick={() => setCreating(id)}>{id}</button>
                            </span>
                        ))}
                    </p>
                )}
            </article>

            <aside className="page-side">
                <h3 className="tree-group">Linked from</h3>
                <Rows edges={inbound} direction="in" />
                <h3 className="tree-group">Links to</h3>
                <Rows edges={outbound} direction="out" />
            </aside>
        </div>
    );
}
