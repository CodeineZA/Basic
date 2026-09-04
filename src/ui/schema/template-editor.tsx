/* Deciding what a kind of thing is made of.
 *
 * This is the feature the brief actually asked for: not every character has the same
 * properties, so the shape of a character is yours to set once and reuse. A field is not
 * just a form input - a field with a relation IS an assertion about the graph, so the editor
 * says so rather than hiding it behind a dropdown labelled "advanced". */

import { useState } from 'react';
import type { Project } from '../../core/project.ts';
import type { FieldType, Template, TemplateField } from '../../core/types.ts';
import { fieldKey } from '../../core/edit-schema.ts';

const FIELD_TYPES: Array<{ value: FieldType; label: string; hint: string }> = [
    { value: 'text', label: 'Text', hint: 'A line of words.' },
    { value: 'longtext', label: 'Long text', hint: 'A paragraph or more.' },
    { value: 'number', label: 'Number', hint: 'A value you can compare and balance.' },
    { value: 'bool', label: 'Yes or no', hint: 'A flag.' },
    { value: 'enum', label: 'One of a list', hint: 'A fixed set of choices.' },
    { value: 'tags', label: 'Tags', hint: 'Free labels, searchable.' },
    { value: 'ref', label: 'Link to one thing', hint: 'Emits a relation into the graph.' },
    { value: 'refList', label: 'Link to several', hint: 'Emits a relation for each.' },
    { value: 'refQty', label: 'Several, with amounts', hint: 'For crafting components.' },
    { value: 'image', label: 'Image', hint: 'A path to a picture.' },
];

const isRefType = (t: FieldType): boolean => t === 'ref' || t === 'refList' || t === 'refQty';

export interface TemplateEditorProps {
    project: Project;
    template: Template;
    onSetMeta: (patch: { label?: string; color?: string }) => void;
    onAddField: (field: TemplateField) => void;
    onUpdateField: (key: string, patch: Partial<TemplateField>) => void;
    onMoveField: (key: string, delta: number) => void;
    onRemoveField: (key: string) => void;
    onRemoveSection: (key: string) => void;
}

export function TemplateEditor(props: TemplateEditorProps): React.JSX.Element {
    const { project, template } = props;
    const [newLabel, setNewLabel] = useState('');

    const types = [...project.templates.values()];
    const relations = [...project.relations.values()];

    const add = (): void => {
        const label = newLabel.trim();
        if (!label) return;
        const key = fieldKey(label);
        if (!key || template.fields.some((f) => f.key === key)) return;
        props.onAddField({ key, label, type: 'text' });
        setNewLabel('');
    };

    return (
        <div className="schema">
            <header className="schema-head">
                <div className="panel-title">
                    <span className="eyebrow">Template</span>
                    <h2 className="heading">{template.label}</h2>
                </div>
                <label className="schema-meta">
                    <span className="label">Name</span>
                    <input
                        value={template.label}
                        aria-label="Template name"
                        onChange={(e) => props.onSetMeta({ label: e.target.value })}
                    />
                </label>
                <label className="schema-meta">
                    <span className="label">Colour</span>
                    <input
                        type="color"
                        value={template.color ?? '#7c9cbf'}
                        aria-label="Template colour"
                        onChange={(e) => props.onSetMeta({ color: e.target.value })}
                    />
                </label>
            </header>

            <p className="tree-group">Fields</p>
            {template.fields.length === 0 && (
                <p className="empty">
                    No fields yet. Add the things you would want to know about every{' '}
                    {template.label.toLowerCase()}.
                </p>
            )}

            <ul className="field-list">
                {template.fields.map((field, i) => {
                    const ref = isRefType(field.type);
                    return (
                        <li className="field-row-edit" key={field.key}>
                            <div className="field-line">
                                <input
                                    className="field-label-input"
                                    value={field.label}
                                    aria-label={`Label for ${field.key}`}
                                    onChange={(e) => props.onUpdateField(field.key, { label: e.target.value })}
                                />

                                <select
                                    value={field.type}
                                    aria-label={`Type of ${field.label}`}
                                    onChange={(e) => props.onUpdateField(field.key, { type: e.target.value as FieldType })}
                                >
                                    {FIELD_TYPES.map((t) => (
                                        <option key={t.value} value={t.value}>{t.label}</option>
                                    ))}
                                </select>

                                <span className="field-controls">
                                    <button
                                        type="button" className="icon-btn" title="Move up"
                                        disabled={i === 0}
                                        onClick={() => props.onMoveField(field.key, -1)}
                                    >↑</button>
                                    <button
                                        type="button" className="icon-btn" title="Move down"
                                        disabled={i === template.fields.length - 1}
                                        onClick={() => props.onMoveField(field.key, 1)}
                                    >↓</button>
                                    <button
                                        type="button" className="icon-btn is-danger" title="Remove this field"
                                        onClick={() => props.onRemoveField(field.key)}
                                    >×</button>
                                </span>
                            </div>

                            <p className="field-hint">
                                <code className="rule">{field.key}</code>
                                {' · '}
                                {FIELD_TYPES.find((t) => t.value === field.type)?.hint}
                            </p>

                            {ref && (
                                <div className="field-extra">
                                    <label>
                                        <span className="label">Points at</span>
                                        <select
                                            value={field.to?.[0] ?? ''}
                                            aria-label={`What ${field.label} points at`}
                                            onChange={(e) => props.onUpdateField(field.key, {
                                                to: e.target.value ? [e.target.value] : [],
                                            })}
                                        >
                                            <option value="">anything</option>
                                            {types.map((t) => (
                                                <option key={t.id} value={t.id}>{t.label}</option>
                                            ))}
                                        </select>
                                    </label>

                                    <label>
                                        {/* Named plainly: this is the whole reason ref fields exist. */}
                                        <span className="label">Filling this in means</span>
                                        <select
                                            value={field.rel ?? ''}
                                            aria-label={`Relation emitted by ${field.label}`}
                                            onChange={(e) => props.onUpdateField(field.key, { rel: e.target.value })}
                                        >
                                            <option value="">— nothing, it links nowhere —</option>
                                            {relations.map((r) => (
                                                <option key={r.id} value={r.id}>
                                                    {template.label} {(r.label ?? r.id).toLowerCase()} it
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                </div>
                            )}

                            {field.type === 'enum' && (
                                <div className="field-extra">
                                    <label style={{ flex: 1 }}>
                                        <span className="label">Choices, comma separated</span>
                                        <input
                                            value={(field.options ?? []).join(', ')}
                                            aria-label={`Choices for ${field.label}`}
                                            onChange={(e) => props.onUpdateField(field.key, {
                                                options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                                            })}
                                        />
                                    </label>
                                </div>
                            )}
                        </li>
                    );
                })}
            </ul>

            <div className="field-add">
                <input
                    value={newLabel}
                    placeholder="Add a field — e.g. Faction"
                    aria-label="New field name"
                    onChange={(e) => setNewLabel(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
                />
                <button type="button" className="btn btn-primary" onClick={add} disabled={!newLabel.trim()}>
                    Add field
                </button>
            </div>

            <p className="tree-group">Sections written into every page</p>
            <ul className="field-list">
                {(template.sections ?? []).length === 0 && (
                    <li className="empty">None. Pages of this kind get no generated sections.</li>
                )}
                {(template.sections ?? []).map((section) => {
                    const query = 'incoming' in section.query ? section.query.incoming : section.query.outgoing;
                    const direction = 'incoming' in section.query ? 'things pointing here' : 'things this points at';
                    const what = Array.isArray(query) ? query.join(', ') : `anything in the "${query.group}" group`;
                    return (
                        <li className="field-row-edit" key={section.key}>
                            <div className="field-line">
                                <span className="field-label-input as-text">{section.title}</span>
                                <button
                                    type="button" className="icon-btn is-danger" title="Remove this section"
                                    onClick={() => props.onRemoveSection(section.key)}
                                >×</button>
                            </div>
                            <p className="field-hint">Lists {direction}: {what}</p>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
