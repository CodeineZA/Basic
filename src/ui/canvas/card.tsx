/* A card on the canvas.
 *
 * Collapsed it shows a name, a type in words, and the requirements that gate it
 * - nothing more, because a canvas of forty has to be scannable at a glance.
 * Left-click drops it down for the fields, the status and the link to its own
 * document.
 *
 * The click contract is the fiddly part, since select, drag, expand and connect
 * all live on one surface: a press that travels under 3px in under 400ms is a
 * click, anything further is a drag. Handles and the document link stop
 * propagation so they never toggle the card open by accident. */

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useRef } from 'react';
import type { Gate } from '../chips.ts';

export interface CardField { label: string; value: string; unset?: boolean; }
export type CardGate = Gate;

export interface CardData extends Record<string, unknown> {
    nodeId: string;
    name: string;
    typeLabel: string;
    glyph: string;
    color: string;
    status?: string;
    gates: CardGate[];
    fields: CardField[];
    docPath?: string;
    broken?: boolean;
    dimmed?: boolean;
    open: boolean;
    onToggle: (id: string) => void;
    onOpenDoc: (path: string) => void;
}

const CLICK_SLOP = 3;
const CLICK_MS = 400;
const MAX_CHIPS = 2;

const SIDES = [
    { id: 'l', position: Position.Left, type: 'target' as const },
    { id: 't', position: Position.Top, type: 'target' as const },
    { id: 'r', position: Position.Right, type: 'source' as const },
    { id: 'b', position: Position.Bottom, type: 'source' as const },
];

export function Card({ data, selected }: NodeProps): React.JSX.Element {
    const d = data as unknown as CardData;
    const press = useRef<{ x: number; y: number; t: number } | null>(null);

    const onPointerDown = (e: React.PointerEvent): void => {
        press.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    };

    const onPointerUp = (e: React.PointerEvent): void => {
        const start = press.current;
        press.current = null;
        if (!start) return;
        const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
        if (moved <= CLICK_SLOP && Date.now() - start.t <= CLICK_MS) d.onToggle(d.nodeId);
    };

    const chips = d.gates.slice(0, MAX_CHIPS);
    const hidden = d.gates.length - chips.length;

    const classes = [
        'card',
        selected ? 'is-selected' : '',
        d.open ? 'is-open' : '',
        d.dimmed ? 'is-dimmed' : '',
        d.broken ? 'is-broken' : '',
        d.status ? `status-${d.status}` : '',
    ].filter(Boolean).join(' ');

    return (
        <div className={classes} aria-expanded={d.open} style={{ '--card-accent': d.color } as React.CSSProperties}>
            {SIDES.map((s) => (
                <Handle key={s.id} id={s.id} type={s.type} position={s.position} className="nodrag nopan" />
            ))}

            <div
                className="card-head"
                role="button"
                tabIndex={0}
                aria-expanded={d.open}
                onPointerDown={onPointerDown}
                onPointerUp={onPointerUp}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); d.onToggle(d.nodeId); }
                }}
            >
                <span className="card-glyph" aria-hidden="true">{d.glyph}</span>
                <span className="card-ident">
                    <span className="card-name">{d.name}</span>
                    {/* The type is named in words; the accent colour is a second signal. */}
                    <span className="card-type">{d.typeLabel}</span>
                </span>
                <span className="card-chevron" aria-hidden="true">⌄</span>
            </div>

            {chips.length > 0 && (
                <div className="card-gates">
                    {chips.map((gate, i) => (
                        <span className="chip" key={i}>
                            <span className="chip-icon" aria-hidden="true">{gate.icon}</span>
                            <span className="chip-text">{gate.text}</span>
                        </span>
                    ))}
                    {hidden > 0 && <span className="chip chip-more">+{hidden} more</span>}
                </div>
            )}

            <div className="card-body">
                {d.fields.map((f) => (
                    <div className="field-row" key={f.label}>
                        <span className="field-label">{f.label}</span>
                        {/* An unset value says so with an em dash rather than showing nothing. */}
                        <span className={`field-value${f.unset ? ' is-unset' : ''}`}>
                            {f.unset ? '— not set' : f.value}
                        </span>
                    </div>
                ))}

                {d.status && (
                    <div className="status-row">
                        <span className="status-dot" aria-hidden="true" />
                        <span>{d.status.replace('-', ' ')}</span>
                    </div>
                )}

                {d.docPath ? (
                    <button
                        type="button"
                        className="card-link nodrag nopan"
                        onPointerDown={(e) => e.stopPropagation()}
                        onPointerUp={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); d.onOpenDoc(d.docPath!); }}
                    >
                        Open {d.docPath.split('/').pop()} ↗
                    </button>
                ) : (
                    <span className="card-link is-missing">No page yet</span>
                )}
            </div>
        </div>
    );
}
