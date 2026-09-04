/* What a line means, and what it would take to make it true.
 *
 * A refusal here is the useful part. "No field on the Character template means Drops" tells
 * someone their schema is missing something; a relation quietly absent from a dropdown tells
 * them nothing at all. So every relation is listed, and the ones that will not work say why. */

import { useState } from 'react';
import type { DrawnEdge } from '../../core/canvas.ts';
import type { GraphIndex } from '../../core/index-graph.ts';
import type { Project } from '../../core/project.ts';
import type { Requirement } from '../../core/types.ts';
import { planDemotion, planPromotion } from '../../core/promote.ts';

export interface EdgeInspectorProps {
    index: GraphIndex;
    project: Project;
    edge: DrawnEdge;
    onPromote: (rel: string) => void;
    onDemote: () => void;
    onRemoveSketch: () => void;
    onSetRequirement: (requirement: Requirement | null) => void;
    onOpenDoc: (path: string) => void;
}

/** The gate forms people actually reach for. Anything richer is edited in the file. */
type GateKind = 'none' | 'flag' | 'has' | 'done';

function readGate(req: Requirement | undefined): { kind: GateKind; value: string } {
    if (!req) return { kind: 'none', value: '' };
    if ('flag' in req) return { kind: 'flag', value: req.flag };
    if ('has' in req) return { kind: 'has', value: req.has };
    if ('done' in req) return { kind: 'done', value: req.done };
    return { kind: 'none', value: '' };
}

export function EdgeInspector(props: EdgeInspectorProps): React.JSX.Element {
    const { index, project, edge } = props;
    const name = (id: string): string => index.nodes.get(id)?.name ?? id;

    const initial = readGate(edge.requirement);
    const [gateKind, setGateKind] = useState<GateKind>(initial.kind);
    const [gateValue, setGateValue] = useState(initial.value);

    const applyGate = (kind: GateKind, value: string): void => {
        setGateKind(kind);
        setGateValue(value);
        if (kind === 'none' || !value.trim()) { props.onSetRequirement(null); return; }
        const v = value.trim();
        props.onSetRequirement(kind === 'flag' ? { flag: v } : kind === 'has' ? { has: v } : { done: v });
    };

    const candidates = [...project.relations.values()].map((rel) => ({
        rel,
        plan: planPromotion(index, project, edge.from, edge.to, rel.id),
    }));
    const possible = candidates.filter((c) => c.plan.ok);
    const impossible = candidates.filter((c) => !c.plan.ok);

    const demotion = edge.rel ? planDemotion(index, project, edge.from, edge.to, edge.rel) : null;

    return (
        <>
            <div className="panel-title">
                <span className="eyebrow">{edge.sketch ? 'Sketch' : 'Relationship'}</span>
                <h2 className="heading">{name(edge.from)} → {name(edge.to)}</h2>
            </div>

            {edge.sketch ? (
                <>
                    <p className="muted">
                        A line, not yet a fact. Give it a meaning and it gets written into the
                        document that should own it.
                    </p>

                    {possible.length === 0 && (
                        <p className="notice" role="status">
                            Nothing on these two can carry a link yet. Add a field that emits a
                            relation to the{' '}
                            <strong>{project.templates.get(index.nodes.get(edge.from)?.type ?? '')?.label ?? 'source'}</strong>{' '}
                            template.
                        </p>
                    )}

                    <ul className="promote-list">
                        {possible.map(({ rel, plan }) => (
                            <li key={rel.id}>
                                <button type="button" className="btn" onClick={() => props.onPromote(rel.id)}>
                                    {rel.label ?? rel.id}
                                </button>
                                {/* Say what will be written before it is written. */}
                                <span className="promote-what">
                                    {plan.ok ? plan.promotion.describe : ''}
                                </span>
                            </li>
                        ))}
                    </ul>

                    {impossible.length > 0 && (
                        <details className="promote-why">
                            <summary>Why not the others?</summary>
                            <ul>
                                {impossible.map(({ rel, plan }) => (
                                    <li key={rel.id}>
                                        <strong>{rel.label ?? rel.id}</strong> — {plan.ok ? '' : plan.reason}
                                    </li>
                                ))}
                            </ul>
                        </details>
                    )}

                    <div className="btn-row" style={{ marginTop: 'var(--s-5)' }}>
                        <button type="button" className="link-btn" onClick={props.onRemoveSketch}>
                            Remove this line
                        </button>
                    </div>
                </>
            ) : (
                <>
                    <p className="muted">
                        {project.relations.get(edge.rel ?? '')?.label ?? edge.rel}, asserted in a
                        document — the canvas only shows it.
                    </p>

                    {edge.source && (
                        <button
                            type="button"
                            className="btn"
                            onClick={() => props.onOpenDoc(edge.source!.file)}
                        >
                            Open {edge.source.file.split('/').pop()}
                            {edge.source.locator ? ` · ${edge.source.locator}` : ''}
                        </button>
                    )}

                    <div className="btn-row" style={{ marginTop: 'var(--s-5)' }}>
                        <button
                            type="button"
                            className="link-btn"
                            title={demotion?.ok ? demotion.promotion.describe : (demotion && !demotion.ok ? demotion.reason : '')}
                            disabled={!demotion?.ok}
                            onClick={props.onDemote}
                        >
                            Unlink
                        </button>
                    </div>
                    {demotion && !demotion.ok && <p className="field-hint">{demotion.reason}</p>}
                </>
            )}

            <div className="inspector-field" style={{ marginTop: 'var(--s-6)' }}>
                <span className="label">Gated by</span>
                <div className="gate-row">
                    <select value={gateKind} onChange={(e) => applyGate(e.target.value as GateKind, gateValue)}>
                        <option value="none">nothing</option>
                        <option value="flag">a flag</option>
                        <option value="has">holding an item</option>
                        <option value="done">a beat being done</option>
                    </select>
                    {gateKind !== 'none' && (
                        <input
                            value={gateValue}
                            placeholder={gateKind === 'flag' ? 'flag_name' : 'id'}
                            aria-label="What gates this"
                            onChange={(e) => applyGate(gateKind, e.target.value)}
                        />
                    )}
                </div>
                <p className="field-hint">
                    A gate lives on the canvas, not in the files — it describes this line rather
                    than the fact underneath it.
                </p>
            </div>
        </>
    );
}
