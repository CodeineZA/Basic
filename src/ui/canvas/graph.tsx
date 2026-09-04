/* The flow view of a progression document.
 *
 * Nothing here owns data. The cards and the lines are derived from the index
 * every render, so an edit in a Markdown tab moves the canvas without either
 * view knowing the other exists. Layout is computed, not stored - M1 tidies
 * with dagre; saved layouts arrive with canvas files in M2. */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Background, BackgroundVariant, Controls, MarkerType, ReactFlow, ReactFlowProvider,
    useEdgesState, useNodesState, useReactFlow,
    type Edge as FlowEdge, type Node as FlowNode,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import type { GraphIndex } from '../../core/index-graph.ts';
import { incoming, outgoing, resolveId } from '../../core/index-graph.ts';
import type { Project } from '../../core/project.ts';
import type { DocNode, Requirement } from '../../core/types.ts';
import { Card, type CardData, type CardField, type CardGate } from './card.tsx';
import { Edge, type EdgeData } from './edge.tsx';
import { boundsOf, NODE_W, pushBelow, tidy, viewportFor, type Bounds } from './tidy.ts';

const nodeTypes = { card: Card };
const edgeTypes = { link: Edge };

/** Flatten a requirement into the chips a collapsed card can show. */
export function gateChips(req: Requirement | undefined, index: GraphIndex): CardGate[] {
    const name = (ref: string): string => {
        const id = resolveId(index, ref);
        return id ? (index.nodes.get(id)?.name ?? ref) : ref;
    };
    const out: CardGate[] = [];

    const walk = (r: Requirement | undefined, negated = false): void => {
        if (!r || typeof r !== 'object') return;
        const lock = negated ? '⊘' : '🔒';
        if ('all' in r) { for (const sub of r.all) walk(sub, negated); return; }
        if ('any' in r) { for (const sub of r.any) walk(sub, negated); return; }
        if ('not' in r) { walk(r.not, !negated); return; }
        if ('flag' in r) { out.push({ icon: lock, text: `flag ${r.flag}` }); return; }
        if ('has' in r) { out.push({ icon: lock, text: `has ${name(r.has)}` }); return; }
        if ('done' in r) { out.push({ icon: lock, text: `after ${name(r.done)}` }); return; }
        if ('visited' in r) { out.push({ icon: lock, text: `visited ${name(r.visited)}` }); return; }
        if ('counter' in r) { out.push({ icon: lock, text: `${r.counter} ${r.op} ${r.n}` }); }
    };

    walk(req);
    return out;
}

/* One place that knows how tall a card is. Approximate by design: it only has
 * to be close enough that the layout breathes and the fit is sensible. */
const HEAD_H = 54;
const CHIP_H = 26;
const ROW_H = 22;

export function cardHeight(card: { gates: unknown[]; fields: unknown[]; status?: string }, open = false): number {
    const chips = Math.min(card.gates.length, 3);
    let h = HEAD_H + (chips > 0 ? chips * CHIP_H + 8 : 0);
    if (open) h += card.fields.length * ROW_H + (card.status ? 24 : 0) + 46;
    return h;
}

const asText = (v: unknown): string => {
    if (v === null || v === undefined || v === '') return '';
    if (Array.isArray(v)) return v.length === 0 ? '' : v.map(asText).filter(Boolean).join(', ');
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
};

function cardFields(node: DocNode, project: Project): CardField[] {
    if (node.kind === 'beat') {
        const beat = node.fields as Record<string, unknown>;
        return [
            { label: 'Verify', value: asText(beat['verify']), unset: !beat['verify'] },
            { label: 'Notes', value: asText(beat['text']), unset: !beat['text'] },
        ];
    }
    const template = project.templates.get(node.type);
    if (!template) return [];
    return template.fields.map((f) => {
        const value = asText(node.fields[f.key]);
        return { label: f.label, value, unset: value === '' };
    });
}

/** Which nodes belong on this act's canvas: its beats, and whatever they touch. */
export function subgraphFor(index: GraphIndex, actId: string): Set<string> {
    const ids = new Set<string>();
    for (const beat of index.order) {
        if (!beat.startsWith(`${actId}#`)) continue;
        ids.add(beat);
        for (const e of outgoing(index, beat)) ids.add(e.to);
        // A beat can assert an edge between two OTHER things (Igor sells the
        // axe), so those third parties belong on the canvas too.
        for (const e of index.edges) if (e.beat === beat) { ids.add(e.from); ids.add(e.to); }
    }
    return ids;
}

export interface GraphViewProps {
    index: GraphIndex;
    project: Project;
    actId: string;
    onOpenDoc: (path: string) => void;
    onSelectNode: (id: string | null) => void;
}

export function GraphView({ index, project, actId, onOpenDoc, onSelectNode }: GraphViewProps): React.JSX.Element {
    const [openId, setOpenId] = useState<string | null>(null);

    const { nodes, edges, bounds } = useMemo(() => {
        const ids = subgraphFor(index, actId);
        const members = [...ids].map((id) => index.nodes.get(id)).filter((n): n is DocNode => Boolean(n));

        const links = index.edges
            .filter((e) => ids.has(e.from) && ids.has(e.to) && e.rel !== 'MENTIONS')
            .map((e, i) => ({ ...e, key: `${e.from}|${e.rel}|${e.to}|${i}` }));

        const cards: CardData[] = members.map((node) => {
            const template = project.templates.get(node.type);
            const isBeat = node.kind === 'beat';
            const requires = isBeat
                ? (node.fields as Record<string, unknown>)['requires'] as Requirement | undefined
                : undefined;
            return {
                nodeId: node.id,
                name: node.name,
                typeLabel: isBeat ? 'Beat' : (template?.label ?? node.type),
                glyph: (isBeat ? 'B' : (template?.label ?? node.type)).charAt(0).toUpperCase(),
                color: isBeat ? 'var(--accent)' : (template?.color ?? 'var(--accent)'),
                ...(node.status === undefined ? {} : { status: node.status }),
                gates: gateChips(requires, index),
                fields: cardFields(node, project),
                // A beat lives inside its act's file, so the link opens that.
                docPath: node.path,
                open: openId === node.id,
                onToggle: (id: string) => setOpenId((current) => (current === id ? null : id)),
                onOpenDoc,
            };
        });

        const sizes = new Map(cards.map((c) => [c.nodeId, { width: NODE_W, height: cardHeight(c) }]));

        let placed = tidy(
            cards.map((c) => ({ id: c.nodeId, ...sizes.get(c.nodeId)! })),
            links.map((l) => ({ from: l.from, to: l.to })),
        );

        // An expanded card pushes its column down instead of covering it.
        if (openId) {
            const card = cards.find((c) => c.nodeId === openId);
            if (card) placed = pushBelow(placed, sizes, openId, cardHeight(card, true) - cardHeight(card));
        }

        const flowNodes: FlowNode[] = cards.map((c) => ({
            id: c.nodeId,
            type: 'card',
            position: placed.get(c.nodeId) ?? { x: 0, y: 0 },
            data: c as unknown as Record<string, unknown>,
            draggable: true,
            /* Dimensions up front. React Flow would otherwise hide each node
             * until its own observer measured it, and fit against nothing. The
             * same numbers drive dagre, so layout and render cannot disagree. */
            width: NODE_W,
            height: cardHeight(c, c.open),
            style: { width: NODE_W },
        }));

        const flowEdges: FlowEdge[] = links.map((l) => {
            const relation = project.relations.get(l.rel);
            const data: EdgeData = {
                label: relation?.label ?? l.rel,
                gated: l.rel === 'REQUIRES' || Boolean(l.requirement),
                sketch: false,
            };
            return {
                id: l.key,
                source: l.from,
                target: l.to,
                sourceHandle: 'r',
                targetHandle: 'l',
                type: 'link',
                data: data as unknown as Record<string, unknown>,
                markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: 'var(--edge)' },
            };
        });

        return { nodes: flowNodes, edges: flowEdges, bounds: boundsOf(placed, sizes) };
    }, [index, project, actId, openId, onOpenDoc]);

    return (
        <div className="canvas-wrap">
            <ReactFlowProvider>
                <Flow derivedNodes={nodes} derivedEdges={edges} bounds={bounds} fitKey={actId} onSelectNode={onSelectNode} />
            </ReactFlowProvider>
        </div>
    );
}

/* React Flow owns interaction state; derived data is pushed in when the index
 * changes. The viewport is set from the layout we computed rather than from
 * fitView, because every coordinate on this canvas is already known here - and
 * a fit that waits on the renderer to measure its way to the same answer is a
 * race we kept losing. */
function Flow({ derivedNodes, derivedEdges, bounds, fitKey, onSelectNode }: {
    derivedNodes: FlowNode[];
    derivedEdges: FlowEdge[];
    bounds: Bounds | null;
    fitKey: string;
    onSelectNode: (id: string | null) => void;
}): React.JSX.Element {
    const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(derivedNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>(derivedEdges);
    const { setViewport } = useReactFlow();
    const shell = useRef<HTMLDivElement>(null);
    /* Bounds move every time a card expands. Framing on that would yank the
     * view out from under the click, so the effect keys on the act alone and
     * reads the current bounds through a ref. */
    const latestBounds = useRef<Bounds | null>(bounds);
    latestBounds.current = bounds;

    useEffect(() => { setNodes(derivedNodes); }, [derivedNodes, setNodes]);
    useEffect(() => { setEdges(derivedEdges); }, [derivedEdges, setEdges]);

    useEffect(() => {
        const box = shell.current?.getBoundingClientRect();
        const b = latestBounds.current;
        if (!b || !box || box.width === 0 || box.height === 0) return;
        setViewport(viewportFor(b, { width: box.width, height: box.height }));
    }, [fitKey, setViewport]);

    return (
        <div className="flow-shell" ref={shell}>
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                snapToGrid
                snapGrid={[16, 16]}
                minZoom={0.2}
                maxZoom={1.6}
                onNodeClick={(_e, node) => onSelectNode(node.id)}
                onPaneClick={() => onSelectNode(null)}
            >
                <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="var(--canvas-dot)" />
                <Controls showInteractive={false} />
            </ReactFlow>
        </div>
    );
}

export { incoming, outgoing };
