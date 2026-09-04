/* Every thing of one kind, side by side.
 *
 * Balancing is comparing numbers and nudging them, which is not something you do by opening
 * thirty files. So the scalar fields are editable in place and the reference fields are
 * shown but not: a link is an assertion about the graph and belongs where it is asserted,
 * not in a spreadsheet cell that would quietly rewrite someone's frontmatter. */

import { useMemo, useState } from 'react';
import type { GraphIndex } from '../../core/index-graph.ts';
import type { Project } from '../../core/project.ts';
import type { DocNode, Template, TemplateField } from '../../core/types.ts';

export interface TableViewProps {
    index: GraphIndex;
    project: Project;
    type: string;
    onOpenDoc: (path: string) => void;
    onSetField: (path: string, key: string, value: unknown) => void;
}

const EDITABLE = new Set(['text', 'number', 'bool', 'enum']);
const isRef = (f: TemplateField): boolean =>
    f.type === 'ref' || f.type === 'refList' || f.type === 'refQty';

const asText = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    if (Array.isArray(v)) return v.map(asText).filter(Boolean).join(', ');
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
};

export function TableView({ index, project, type, onOpenDoc, onSetField }: TableViewProps): React.JSX.Element {
    const template = project.templates.get(type);
    const [sortBy, setSortBy] = useState<string>('name');
    const [descending, setDescending] = useState(false);

    const rows = useMemo(() => {
        const all = [...index.nodes.values()].filter((n) => n.kind === 'object' && n.type === type);
        const value = (n: DocNode): unknown => (sortBy === 'name' ? n.name : n.fields[sortBy]);

        return all.sort((a, b) => {
            const x = value(a);
            const y = value(b);
            // Numbers compare as numbers; everything else compares as words. Sorting 9
            // above 10 is the classic way a balancing table lies to you.
            const cmp = typeof x === 'number' && typeof y === 'number'
                ? x - y
                : asText(x).localeCompare(asText(y), undefined, { numeric: true });
            return descending ? -cmp : cmp;
        });
    }, [index, type, sortBy, descending]);

    if (!template) return <p className="empty" style={{ padding: 'var(--s-6)' }}>No template for “{type}”.</p>;

    const sort = (key: string): void => {
        if (sortBy === key) setDescending((d) => !d);
        else { setSortBy(key); setDescending(false); }
    };

    const header = (key: string, label: string): React.JSX.Element => (
        <th key={key} scope="col">
            <button type="button" className="th-sort" onClick={() => sort(key)}>
                {label}
                {/* An arrow AND the aria-sort, so the direction is not carried by a glyph alone. */}
                <span aria-hidden="true">{sortBy === key ? (descending ? ' ↓' : ' ↑') : ''}</span>
            </button>
        </th>
    );

    return (
        <div className="table-view">
            <header className="schema-head">
                <div className="panel-title">
                    <span className="eyebrow">Balancing</span>
                    <h2 className="heading">Every {template.label.toLowerCase()}</h2>
                </div>
                <p className="muted">
                    {rows.length} {rows.length === 1 ? 'entry' : 'entries'} · sorted by{' '}
                    {sortBy === 'name' ? 'name' : template.fields.find((f) => f.key === sortBy)?.label ?? sortBy}
                </p>
            </header>

            {rows.length === 0 ? (
                <p className="empty">Nothing of this kind yet.</p>
            ) : (
                <div className="table-scroll">
                    <table className="grid">
                        <thead>
                            <tr>
                                {header('name', 'Name')}
                                {template.fields.map((f) => header(f.key, f.label))}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((node) => (
                                <tr key={node.id}>
                                    <th scope="row">
                                        <button type="button" className="link-btn" onClick={() => onOpenDoc(node.path)}>
                                            {node.name}
                                        </button>
                                    </th>
                                    {template.fields.map((field) => (
                                        <td key={field.key} className={isRef(field) ? 'is-readonly' : ''}>
                                            <Cell
                                                field={field}
                                                value={node.fields[field.key]}
                                                onChange={(v) => onSetField(node.path, field.key, v)}
                                            />
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

function Cell({ field, value, onChange }: {
    field: TemplateField;
    value: unknown;
    onChange: (value: unknown) => void;
}): React.JSX.Element {
    if (!EDITABLE.has(field.type)) {
        const text = asText(value);
        /* Shown, never edited here. A reference is an assertion and belongs where it is
         * asserted; an em dash says "nothing" rather than leaving a cell ambiguously blank. */
        return <span className={text ? '' : 'is-unset'}>{text || '—'}</span>;
    }

    if (field.type === 'bool') {
        return (
            <input
                type="checkbox"
                checked={value === true}
                aria-label={field.label}
                onChange={(e) => onChange(e.target.checked ? true : null)}
            />
        );
    }

    if (field.type === 'enum') {
        return (
            <select
                value={asText(value)}
                aria-label={field.label}
                onChange={(e) => onChange(e.target.value || null)}
            >
                <option value="">—</option>
                {(field.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
        );
    }

    return (
        <input
            type={field.type === 'number' ? 'number' : 'text'}
            value={asText(value)}
            aria-label={field.label}
            onChange={(e) => {
                const raw = e.target.value;
                if (raw === '') { onChange(null); return; }
                onChange(field.type === 'number' ? Number(raw) : raw);
            }}
        />
    );
}
