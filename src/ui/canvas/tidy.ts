/* Auto-layout. Hand-arranging forty beats is not a design.
 *
 * Layered left-to-right with generous separation, because the thing the user
 * asked for is elements connected gracefully with room between them - and no
 * amount of edge styling rescues a layout where the cards are touching. */

import dagre from '@dagrejs/dagre';

export interface Box { id: string; width: number; height: number; }
export interface Placed { id: string; x: number; y: number; }

export const NODE_W = 240;
const NODE_SEP = 80;
const RANK_SEP = 140;
const GRID = 16;

const snap = (n: number): number => Math.round(n / GRID) * GRID;

export function tidy(
    boxes: Box[],
    links: Array<{ from: string; to: string }>,
    direction: 'LR' | 'TB' = 'LR',
): Map<string, Placed> {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: direction, nodesep: NODE_SEP, ranksep: RANK_SEP, marginx: 48, marginy: 48 });
    g.setDefaultEdgeLabel(() => ({}));

    for (const box of boxes) g.setNode(box.id, { width: box.width, height: box.height });
    for (const link of links) {
        // dagre throws on an edge to a node it has never seen.
        if (g.hasNode(link.from) && g.hasNode(link.to)) g.setEdge(link.from, link.to);
    }

    dagre.layout(g);

    const out = new Map<string, Placed>();
    for (const box of boxes) {
        const node = g.node(box.id) as { x: number; y: number } | undefined;
        if (!node) continue;
        // dagre centres nodes; React Flow positions by top-left corner.
        out.set(box.id, {
            id: box.id,
            x: snap(node.x - box.width / 2),
            y: snap(node.y - box.height / 2),
        });
    }
    return out;
}

/* When a card expands it must not land on top of its neighbours. Push down only
 * the cards whose horizontal span actually overlaps it, so unrelated columns
 * stay where the user left them. Collapsing restores everything, because the
 * shift is derived rather than written back into the layout. */
export function pushBelow(
    placed: Map<string, Placed>,
    sizes: Map<string, { width: number; height: number }>,
    openId: string,
    extraHeight: number,
): Map<string, Placed> {
    const anchor = placed.get(openId);
    if (!anchor || extraHeight <= 0) return placed;

    const anchorW = sizes.get(openId)?.width ?? NODE_W;
    const left = anchor.x;
    const right = anchor.x + anchorW;

    const out = new Map(placed);
    for (const [id, pos] of placed) {
        if (id === openId || pos.y <= anchor.y) continue;
        const width = sizes.get(id)?.width ?? NODE_W;
        const overlaps = pos.x < right && pos.x + width > left;
        if (overlaps) out.set(id, { ...pos, y: pos.y + extraHeight });
    }
    return out;
}

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number; }

export function boundsOf(
    placed: Map<string, Placed>,
    sizes: Map<string, { width: number; height: number }>,
): Bounds | null {
    if (placed.size === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [id, pos] of placed) {
        const size = sizes.get(id) ?? { width: NODE_W, height: 0 };
        minX = Math.min(minX, pos.x);
        minY = Math.min(minY, pos.y);
        maxX = Math.max(maxX, pos.x + size.width);
        maxY = Math.max(maxY, pos.y + size.height);
    }
    return { minX, minY, maxX, maxY };
}

/* Every position and size on this canvas is computed here, so the viewport can
 * be computed too rather than asking the renderer to measure its way to the
 * same answer. Exact, synchronous, and testable without a DOM. */
export function viewportFor(
    bounds: Bounds,
    pane: { width: number; height: number },
    padding = 0.12,
    limits = { min: 0.2, max: 1 },
): { x: number; y: number; zoom: number } {
    const w = Math.max(bounds.maxX - bounds.minX, 1);
    const h = Math.max(bounds.maxY - bounds.minY, 1);
    const raw = Math.min(pane.width / w, pane.height / h) * (1 - padding);
    const zoom = Math.min(limits.max, Math.max(limits.min, raw));
    return {
        x: pane.width / 2 - ((bounds.minX + bounds.maxX) / 2) * zoom,
        y: pane.height / 2 - ((bounds.minY + bounds.maxY) / 2) * zoom,
        zoom,
    };
}
