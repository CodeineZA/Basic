/* The script view: a progression document read top to bottom.
 *
 * The canvas answers "how does this fit together". This answers "what happens, in order" -
 * which is the question a developer building the thing actually has. So it reads as a
 * document, not a form: the beat's title, what it makes true, and how you would know it
 * worked.
 *
 * Everything shown here is derived. What a beat asserts comes from the index, not from
 * re-reading the file, so a hand edit in another tab moves this view too. */

import { outgoing, type GraphIndex } from '../../core/index-graph.ts';
import type { Project } from '../../core/project.ts';
import type { DocNode, Edge, Requirement } from '../../core/types.ts';
import { gateChips } from '../chips.ts';

export interface ScriptViewProps {
    index: GraphIndex;
    project: Project;
    actId: string;
    /** The beat the world is being shown as of, if any. */
    cursor: string | null;
    selected: string | null;
    onSetCursor: (beatId: string | null) => void;
    onSelect: (beatId: string) => void;
    onOpenDoc: (path: string) => void;
    onMove: (beatId: string, delta: number) => void;
    onAdd: (afterBeatId?: string) => void;
    onRemove: (beatId: string) => void;
    onUpdate: (beatId: string, patch: Record<string, unknown>) => void;
}

/** What a beat asserts, grouped the way a reader thinks about it. */
function assertions(index: GraphIndex, beatId: string): Array<{ label: string; edges: Edge[] }> {
    const own = outgoing(index, beatId).filter((e) => e.rel !== 'REQUIRES' && e.rel !== 'MENTIONS');
    // Edges a beat asserts BETWEEN other things - Igor sells the axe - are not outgoing
    // from the beat, so they have to be found by provenance.
    const brokered = index.edges.filter((e) => e.beat === beatId && e.from !== beatId);

    const groups: Array<{ label: string; rels: string[]; source: Edge[] }> = [
        { label: 'Introduces', rels: ['INTRODUCES'], source: own },
        { label: 'Opens', rels: ['OPENS'], source: own },
        { label: 'Features', rels: ['FEATURES'], source: own },
        { label: 'Grants', rels: ['GRANTS'], source: brokered },
        { label: 'Puts on sale', rels: ['SELLS'], source: brokered },
        { label: 'Drops', rels: ['DROPS'], source: brokered },
    ];

    return groups
        .map((g) => ({ label: g.label, edges: g.source.filter((e) => g.rels.includes(e.rel)) }))
        .filter((g) => g.edges.length > 0);
}

export function ScriptView(props: ScriptViewProps): React.JSX.Element {
    const { index, project, actId, cursor, selected } = props;
    const act = index.nodes.get(actId);
    const beats = index.order
        .filter((id) => id.startsWith(`${actId}#`))
        .map((id) => index.nodes.get(id))
        .filter((n): n is DocNode => Boolean(n));

    const name = (id: string): string => index.nodes.get(id)?.name ?? id;
    const pathOf = (id: string): string | null => {
        const node = index.nodes.get(id);
        return node && node.kind === 'object' ? node.path : null;
    };

    const cursorAt = cursor ? beats.findIndex((b) => b.id === cursor) : -1;

    return (
        <div className="script">
            <header className="script-head">
                <div className="panel-title">
                    <span className="eyebrow">Progression</span>
                    <h2 className="heading">{act?.name ?? actId}</h2>
                </div>
                <button type="button" className="btn btn-primary" onClick={() => props.onAdd()}>
                    Add beat
                </button>
            </header>

            {beats.length === 0 && (
                <p className="empty">
                    No beats yet. A beat is a moment where something becomes true — a character
                    arrives, a place opens, an item changes hands.
                </p>
            )}

            <ol className="beats">
                {beats.map((beat, i) => {
                    const fields = beat.fields as Record<string, unknown>;
                    const gates = gateChips(fields['requires'] as Requirement | undefined, index);
                    const verify = typeof fields['verify'] === 'string' ? fields['verify'] : '';
                    const prose = typeof fields['text'] === 'string' ? fields['text'] : '';
                    const status = beat.status ?? 'pending';
                    const isCursor = cursor === beat.id;
                    // Past the cursor is design that has not happened yet at this point in time.
                    const ahead = cursorAt !== -1 && i > cursorAt;

                    return (
                        <li
                            key={beat.id}
                            className={[
                                'beat',
                                `status-${status}`,
                                selected === beat.id ? 'is-selected' : '',
                                isCursor ? 'is-cursor' : '',
                                ahead ? 'is-ahead' : '',
                            ].filter(Boolean).join(' ')}
                            onClick={() => props.onSelect(beat.id)}
                        >
                            <div className="beat-head">
                                <span className="beat-no">{i + 1}</span>
                                <span className="beat-title">{beat.name}</span>

                                <label className="beat-status">
                                    <span className="status-dot" aria-hidden="true" />
                                    <select
                                        value={status}
                                        aria-label={`Status of ${beat.name}`}
                                        onClick={(e) => e.stopPropagation()}
                                        onChange={(e) => props.onUpdate(beat.locator!, { status: e.target.value })}
                                    >
                                        {project.statuses.map((s) => (
                                            <option key={s} value={s}>{s.replace('-', ' ')}</option>
                                        ))}
                                    </select>
                                </label>

                                <span className="beat-controls" onClick={(e) => e.stopPropagation()}>
                                    <button
                                        type="button" className="icon-btn" title="Move earlier"
                                        disabled={i === 0}
                                        onClick={() => props.onMove(beat.locator!, -1)}
                                    >↑</button>
                                    <button
                                        type="button" className="icon-btn" title="Move later"
                                        disabled={i === beats.length - 1}
                                        onClick={() => props.onMove(beat.locator!, 1)}
                                    >↓</button>
                                    <button
                                        type="button" className="icon-btn" title="Add a beat after this one"
                                        onClick={() => props.onAdd(beat.locator!)}
                                    >+</button>
                                    <button
                                        type="button" className="icon-btn is-danger" title="Remove this beat"
                                        onClick={() => props.onRemove(beat.locator!)}
                                    >×</button>
                                </span>
                            </div>

                            {gates.length > 0 && (
                                <div className="beat-gates">
                                    {gates.map((gate, g) => (
                                        <span className="chip" key={g}>
                                            <span className="chip-icon" aria-hidden="true">{gate.icon}</span>
                                            <span className="chip-text">{gate.text}</span>
                                        </span>
                                    ))}
                                </div>
                            )}

                            {prose && <p className="beat-prose">{prose}</p>}

                            {assertions(index, beat.id).map((group) => (
                                <div className="beat-row" key={group.label}>
                                    <span className="beat-row-label">{group.label}</span>
                                    <span className="beat-row-value">
                                        {group.edges.map((e, k) => {
                                            const target = e.to;
                                            const path = pathOf(target);
                                            return (
                                                <span key={`${target}-${k}`}>
                                                    {k > 0 && ', '}
                                                    {path ? (
                                                        <button
                                                            type="button" className="link-btn"
                                                            onClick={(ev) => { ev.stopPropagation(); props.onOpenDoc(path); }}
                                                        >{name(target)}</button>
                                                    ) : name(target)}
                                                    {/* Who brokers it matters: Igor sells the axe, the beat does not. */}
                                                    {e.from !== beat.id && <span className="muted"> from {name(e.from)}</span>}
                                                </span>
                                            );
                                        })}
                                    </span>
                                </div>
                            ))}

                            <div className="beat-row">
                                <span className="beat-row-label">Verify</span>
                                {/* A beat cannot be complete without this, so an empty one is stated. */}
                                <span className={`beat-row-value${verify ? '' : ' is-unset'}`}>
                                    {verify || '— not set'}
                                </span>
                            </div>

                            <div className="beat-foot" onClick={(e) => e.stopPropagation()}>
                                <button
                                    type="button"
                                    className={`link-btn${isCursor ? ' is-on' : ''}`}
                                    onClick={() => props.onSetCursor(isCursor ? null : beat.id)}
                                >
                                    {isCursor ? 'Showing the world here' : 'Show the world here'}
                                </button>
                            </div>
                        </li>
                    );
                })}
            </ol>
        </div>
    );
}
