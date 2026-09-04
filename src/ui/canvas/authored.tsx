/* A canvas you build on.
 *
 * The act's Flow view is a picture of what the files already say, tidied automatically. This
 * is the other thing: a document where YOU decide what is on it and where, and where drawing
 * a line is the first half of making a relationship real.
 *
 * Sketch freely, promote deliberately. A line drawn here means nothing until it is given a
 * relation - at which point it stops living in this file and is written into the document
 * that should own it, and this canvas reads it back from the index like any other fact. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Background, BackgroundVariant, Controls, MarkerType, ReactFlow, ReactFlowProvider,
    useEdgesState, useNodesState, useReactFlow,
    type Connection, type Edge as FlowEdge, type Node as FlowNode, type NodeChange, type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { drawnEdges, type CanvasDoc, type DrawnEdge } from '../../core/canvas.ts';
import type { GraphIndex } from '../../core/index-graph.ts';
import type { Project } from '../../core/project.ts';
import type { DocNode, Requirement } from '../../core/types.ts';
import { Card, type CardData, type CardField } from './card.tsx';
import { Edge, type EdgeData } from './edge.tsx';
import { gateChips } from '../chips.ts';
import { NODE_W } from './tidy.ts';
import { cardHeight } from './graph.tsx';

const nodeTypes = { card: Card };
const edgeTypes = { link: Edge };

/** What the palette hands over when something is dragged onto the canvas. */
export const DRAG_TYPE = 'application/basic-ref';

export interface AuthoredCanvasProps {
    index: GraphIndex;
    project: Project;
    canvas: CanvasDoc;
    selectedEdge: DrawnEdge | null;
    onMoveNode: (ref: string, x: number, y: number) => void;
    onPlaceNode: (ref: string, x: number, y: number) => void;
    onRemoveNode: (ref: string) => void;
    onConnect: (from: string, to: string) => void;
    onSelectEdge: (edge: DrawnEdge | null) => void;
    onOpenDoc: (path: string) => void;
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

export function AuthoredCanvas(props: AuthoredCanvasProps): React.JSX.Element {
    return (
        <div className="canvas-wrap">
            <ReactFlowProvider>
                <Surface {...props} />
            </ReactFlowProvider>
        </div>
    );
}

function Surface({
    index, project, canvas, selectedEdge,
    onMoveNode, onPlaceNode, onRemoveNode, onConnect, onSelectEdge, onOpenDoc,
}: AuthoredCanvasProps): React.JSX.Element {
    const [openId, setOpenId] = useState<string | null>(null);
    const [viewport, setViewport] = useState<Viewport>({ x: 32, y: 32, zoom: 1 });
    const { screenToFlowPosition } = useReactFlow();
    const shell = useRef<HTMLDivElement>(null);

    const canvasKey = JSON.stringify(canvas);

    const derived = useMemo(() => {
        const cards: CardData[] = [];
        for (const node of canvas.nodes) {
            const entity = index.nodes.get(node.ref);
            const template = entity ? project.templates.get(entity.type) : undefined;
            const isBeat = entity?.kind === 'beat';

            cards.push({
                nodeId: node.ref,
                name: entity?.name ?? node.ref,
                typeLabel: !entity ? 'missing' : isBeat ? 'Beat' : (template?.label ?? entity.type),
                glyph: (entity ? (isBeat ? 'B' : template?.label ?? entity.type) : '?').charAt(0).toUpperCase(),
                color: isBeat ? 'var(--accent)' : (template?.color ?? 'var(--accent)'),
                ...(entity?.status === undefined ? {} : { status: entity.status }),
                gates: isBeat
                    ? gateChips((entity.fields as Record<string, unknown>)['requires'] as Requirement | undefined, index)
                    : [],
                fields: entity ? cardFields(entity, project) : [],
                // A card whose thing has been deleted says so rather than vanishing.
                ...(entity ? { docPath: entity.path } : { broken: true }),
                open: openId === node.ref,
                onToggle: (id: string) => setOpenId((current) => (current === id ? null : id)),
                onOpenDoc,
            });
        }

        const positions = new Map(canvas.nodes.map((n) => [n.ref, n]));
        const flowNodes: FlowNode[] = cards.map((c) => ({
            id: c.nodeId,
            type: 'card',
            position: { x: positions.get(c.nodeId)?.x ?? 0, y: positions.get(c.nodeId)?.y ?? 0 },
            data: c as unknown as Record<string, unknown>,
            draggable: true,
            /* Width AND height. React Flow will not draw an edge to a node it has not
             * measured, and it does not reliably measure here - the same trap the act's
             * flow view hit. Supplying both means it never has to. */
            width: NODE_W,
            height: cardHeight(c, c.open),
        }));

        const lines = drawnEdges(canvas, index);
        const flowEdges: FlowEdge[] = lines.map((line) => {
            const relation = line.rel ? project.relations.get(line.rel) : null;
            const data: EdgeData = {
                label: line.rel ? (relation?.label ?? line.rel) : 'sketch',
                gated: Boolean(line.requirement),
                sketch: line.sketch,
            };
            return {
                id: `${line.from}|${line.rel ?? ''}|${line.to}`,
                source: line.from,
                target: line.to,
                sourceHandle: 'r',
                targetHandle: 'l',
                type: 'link',
                className: line.sketch ? 'is-sketch' : '',
                data: data as unknown as Record<string, unknown>,
                markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: 'var(--edge)' },
            };
        });

        return { nodes: flowNodes, edges: flowEdges, lines };
        /* Keyed on the canvas's CONTENT, not its identity: the store parses a fresh object
         * every render, so depending on identity recomputes - and re-sets React Flow's
         * state - on every keystroke anywhere in the app. */
    }, [canvasKey, canvas, index, project, openId, onOpenDoc]);

    const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(derived.nodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>(derived.edges);

    /* Derived data wins whenever the files or the canvas change underneath. useEffect, not
     * useMemo: setting state during render is not a side effect React promises to keep, and
     * doing it that way silently dropped every edge after the first interaction. */
    useEffect(() => { setNodes(derived.nodes); }, [derived.nodes, setNodes]);
    useEffect(() => { setEdges(derived.edges); }, [derived.edges, setEdges]);


    (globalThis as Record<string, unknown>)['__cv'] = {
        canvasNodes: canvas.nodes.map((n) => n.ref),
        indexEdges: index.edges.length,
        lines: derived.lines.map((l) => `${l.from}|${l.rel}|${l.to}`),
        derivedEdges: derived.edges.length,
        stateEdges: edges.length,
    };

    /* Positions are written when the drag ENDS, not on every frame. Persisting mid-drag
     * would put a hundred rewrites of the layout file through the buffer for one gesture. */
    const handleNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
        onNodesChange(changes);
        for (const change of changes) {
            if (change.type === 'position' && change.dragging === false && change.position) {
                onMoveNode(change.id, change.position.x, change.position.y);
            }
            if (change.type === 'remove') onRemoveNode(change.id);
        }
    }, [onNodesChange, onMoveNode, onRemoveNode]);

    const handleConnect = useCallback((c: Connection) => {
        if (c.source && c.target) onConnect(c.source, c.target);
    }, [onConnect]);

    const handleDrop = useCallback((event: React.DragEvent): void => {
        event.preventDefault();
        const ref = event.dataTransfer.getData(DRAG_TYPE);
        if (!ref) return;
        const at = screenToFlowPosition({ x: event.clientX, y: event.clientY });
        // Dropped where the pointer is, less half a card, so it lands under the cursor.
        onPlaceNode(ref, at.x - NODE_W / 2, at.y - 20);
    }, [screenToFlowPosition, onPlaceNode]);

    return (
        <div
            className="flow-shell"
            ref={shell}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
            onDrop={handleDrop}
        >
            {canvas.nodes.length === 0 && (
                <p className="canvas-empty">
                    Empty. Drag anything from the palette on the right onto here, then drag from
                    the edge of one card to another to draw a line between them.
                </p>
            )}

            <ReactFlow
                nodes={nodes}
                edges={edges}
                viewport={viewport}
                onViewportChange={setViewport}
                onNodesChange={handleNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={handleConnect}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                snapToGrid
                snapGrid={[16, 16]}
                minZoom={0.2}
                maxZoom={1.6}
                deleteKeyCode={['Backspace', 'Delete']}
                onEdgeClick={(_e, edge) => {
                    const found = derived.lines.find(
                        (l) => `${l.from}|${l.rel ?? ''}|${l.to}` === edge.id,
                    );
                    onSelectEdge(found ?? null);
                }}
                onPaneClick={() => onSelectEdge(null)}
            >
                <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="var(--canvas-dot)" />
                <Controls showInteractive={false} />
            </ReactFlow>

            {selectedEdge && <span className="sr-only">Edge selected</span>}
        </div>
    );
}
