/* What a link between two things means, and how it reads from the other end.
 *
 * Every relation needs an inverse, because a backlink is the inverse read backwards - Igor
 * SELLS the axe, so the axe's page says "sold by Igor". Without one there is no phrasing for
 * the far end, which is why a missing inverse is an error rather than a shrug. */

import { useState } from 'react';
import type { Project } from '../../core/project.ts';
import type { Relation } from '../../core/types.ts';
import { relationId } from '../../core/edit-schema.ts';

export interface RelationsEditorProps {
    project: Project;
    onAdd: (relation: Relation) => void;
    onUpdate: (id: string, patch: Partial<Relation>) => void;
    onRemove: (id: string) => void;
}

export function RelationsEditor({ project, onAdd, onUpdate, onRemove }: RelationsEditorProps): React.JSX.Element {
    const [label, setLabel] = useState('');
    const [inverseLabel, setInverseLabel] = useState('');

    const relations = [...project.relations.values()];
    const groups = [...new Set(relations.map((r) => r.group).filter(Boolean))] as string[];

    const add = (): void => {
        const forward = label.trim();
        const back = inverseLabel.trim();
        if (!forward || !back) return;
        const id = relationId(forward);
        if (!id || project.relations.has(id)) return;
        onAdd({ id, label: forward, inverse: relationId(back), inverseLabel: back });
        setLabel('');
        setInverseLabel('');
    };

    return (
        <div className="schema">
            <div className="panel-title">
                <span className="eyebrow">Schema</span>
                <h2 className="heading">Relations</h2>
            </div>
            <p className="muted" style={{ maxWidth: '62ch' }}>
                A relation is what a link <em>means</em>. Templates emit them, and each one is
                read back the other way to phrase a backlink.
            </p>

            <ul className="field-list">
                {relations.map((rel) => (
                    <li className="field-row-edit" key={rel.id}>
                        <div className="field-line">
                            <code className="rule rel-id">{rel.id}</code>
                            <button
                                type="button" className="icon-btn is-danger" title={`Remove ${rel.id}`}
                                onClick={() => onRemove(rel.id)}
                            >×</button>
                        </div>

                        <div className="field-extra">
                            <label>
                                <span className="label">Reads as</span>
                                <input
                                    value={rel.label ?? ''}
                                    placeholder={rel.id}
                                    aria-label={`Label for ${rel.id}`}
                                    onChange={(e) => onUpdate(rel.id, { label: e.target.value })}
                                />
                            </label>
                            <label>
                                <span className="label">From the other end</span>
                                <input
                                    value={rel.inverseLabel ?? ''}
                                    placeholder={rel.inverse}
                                    aria-label={`Inverse label for ${rel.id}`}
                                    onChange={(e) => onUpdate(rel.id, { inverseLabel: e.target.value })}
                                />
                            </label>
                            <label>
                                <span className="label">Group</span>
                                <input
                                    list="relation-groups"
                                    value={rel.group ?? ''}
                                    placeholder="none"
                                    aria-label={`Group for ${rel.id}`}
                                    onChange={(e) => onUpdate(rel.id, { group: e.target.value })}
                                />
                            </label>
                        </div>

                        {/* Stated plainly, because the inverse is the half people forget. */}
                        <p className="field-hint">
                            {rel.inverse
                                ? <>A page it points at will say “{rel.inverseLabel ?? rel.inverse}”.</>
                                : <span className="is-warn">No inverse — nothing can phrase this from the other end.</span>}
                        </p>
                    </li>
                ))}
            </ul>

            <datalist id="relation-groups">
                {groups.map((g) => <option key={g} value={g} />)}
            </datalist>

            <div className="field-add is-pair">
                <input
                    value={label}
                    placeholder="Add a relation — e.g. Guards"
                    aria-label="New relation label"
                    onChange={(e) => setLabel(e.target.value)}
                />
                <input
                    value={inverseLabel}
                    placeholder="…and from the other end — e.g. Guarded by"
                    aria-label="New relation inverse label"
                    onChange={(e) => setInverseLabel(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
                />
                <button
                    type="button" className="btn btn-primary"
                    onClick={add}
                    disabled={!label.trim() || !inverseLabel.trim()}
                    title={!inverseLabel.trim() ? 'A relation needs both readings' : undefined}
                >
                    Add relation
                </button>
            </div>
        </div>
    );
}
