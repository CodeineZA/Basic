/* The flow view of a progression document.
 *
 * Nothing here owns data. The cards and the lines are derived from the index
 * every render, so an edit in a Markdown tab moves the canvas without either
 * view knowing the other exists. Layout is computed, not stored - M1 tidies
 * with dagre; saved layouts arrive with canvas files in M2. */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Background, BackgroundVariant, Controls, MarkerType, ReactFlow, ReactFlowProvider,
    useEdgesState, useNodesState,
    type Edge as FlowEdge, type Node as FlowNode, type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import type { GraphIndex } from '../../core/index-graph.ts';
import { incoming, outgoing } from '../../core/index-graph.ts';
import { gateChips } from '../chips.ts';
import { existsAt, foldTo } from '../../core/fold.ts';
import type { Project } from '../../core/project.ts';
import type { DocNode, Requirement } from '../../core/types.ts';
import { Card, type CardData, type CardField } from './card.tsx';
import { Edge, type EdgeData } from './edge.tsx';
import { boundsOf, NODE_W, pushBelow, tidy, viewportFor, type Bounds } from './tidy.ts';

const nodeTypes = { card: Card };
const edgeTypes = { link: Edge };

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
    /** Show the act as of this beat: later beats, and things not yet introduced, dim. */
    cursor?: string | null;
    onOpenDoc: (path: string) => void;
    onSelectNode: (id: string | null) => void;
}

export function GraphView({ index, project, actId, cursor = null, onOpenDoc, onSelectNode }: GraphViewProps): React.JSX.Element {
    const [openId, setOpenId] = useState<string | null>(null);

    const { nodes, edges, bounds } = useMemo(() => {
        const ids = subgraphFor(index, actId);
        const members = [...ids].map((id) => index.nodes.get(id)).filter((n): n is DocNode => Boolean(n));

        const links = index.edges
            .filter((e) => ids.has(e.from) && ids.has(e.to) && e.rel !== 'MENTIONS')
            .map((e, i) => ({ ...e, key: `${e.from}|${e.rel}|${e.to}|${i}` }));

        /* With a cursor set, the canvas shows the act as of that moment: beats that have
         * not happened and things nobody has met yet are dimmed rather than hidden, so the
         * shape of what is coming stays visible. */
        const world = cursor === null ? null : foldTo(index, project, cursor);
        const reached = new Set(world?.elapsed ?? []);
        const isDim = (node: DocNode): boolean => {
            if (!world) return false;
            if (node.kind === 'beat') return !reached.has(node.id);
            return !existsAt(world, node.id);
        };

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
                dimmed: isDim(node),
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
    }, [index, project, actId, cursor, openId, onOpenDoc]);

    return (
        <div className="canvas-wrap">
            <ReactFlowProvider>
                <Flow derivedNodes={nodes} derivedEdges={edges} bounds={bounds} fitKey={actId} onSelectNode={onSelectNode} />
            </ReactFlowProvider>
        </div>
    );
}

/* React Flow owns interaction state; derived data is pushed in when the index changes.
 *
 * The viewport is CONTROLLED and computed from the layout we already know, rather than
 * asked for imperatively. Every attempt to request a fit - fitView, setViewport in an
 * effect, inside requestAnimationFrame, gated on onInit - lost a race with something:
 * measurement that had not happened, an instance that was not ready, or a frame callback
 * that never fires because the window is not being composited. Passing the viewport as a
 * value has no lifecycle to lose a race with. */
function Flow({ derivedNodes, derivedEdges, bounds, fitKey, onSelectNode }: {
    derivedNodes: FlowNode[];
    derivedEdges: FlowEdge[];
    bounds: Bounds | null;
    fitKey: string;
    onSelectNode: (id: string | null) => void;
}): React.JSX.Element {
    const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(derivedNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>(derivedEdges);
    const shell = useRef<HTMLDivElement>(null);
    const boundsRef = useRef<Bounds | null>(bounds);
    boundsRef.current = bounds;
    const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
    /** Which act the current framing was computed for, so panning is not undone. */
    const framed = useRef<string | null>(null);

    useEffect(() => { setNodes(derivedNodes); }, [derivedNodes, setNodes]);
    useEffect(() => { setEdges(derivedEdges); }, [derivedEdges, setEdges]);

    /* Measured synchronously with getBoundingClientRect, deliberately.
     *
     * requestAnimationFrame and ResizeObserver are both callback-driven, and neither fires
     * in a window that is not being composited - hidden, minimised, occluded. Framing the
     * canvas is not optional decoration, so it must not depend on the compositor running.
     * By the time an effect runs the DOM is committed, so the measurement is already good. */
    useEffect(() => {
        if (!bounds || framed.current === fitKey) return;
        const box = shell.current?.getBoundingClientRect();
        if (!box || box.width === 0 || box.height === 0) return;
        framed.current = fitKey;
        setViewport(viewportFor(bounds, { width: box.width, height: box.height }));
    }, [bounds, fitKey]);

    /* A window resize is a real event and always fires; re-frame so a graph does not end up
     * stranded off-screen after the window changes shape. */
    useEffect(() => {
        const onResize = (): void => {
            const box = shell.current?.getBoundingClientRect();
            const b = boundsRef.current;
            if (!b || !box || box.width === 0 || box.height === 0) return;
            setViewport(viewportFor(b, { width: box.width, height: box.height }));
        };
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    return (
        <div className="flow-shell" ref={shell}>
            <ReactFlow
                nodes={nodes}
                edges={edges}
                viewport={viewport}
                onViewportChange={setViewport}
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
