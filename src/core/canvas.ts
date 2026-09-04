/* A canvas document: where things sit, and the lines someone drew that are not yet facts.
 *
 * The rule that keeps a canvas and the files from disagreeing is that a canvas owns almost
 * nothing. It owns POSITIONS, and it owns edges that have not been promoted yet. Every real
 * relationship is read from the index, so a promoted edge is never stored twice and can
 * never drift from the file that asserts it.
 *
 * An entry in `edges` is therefore an annotation, not a claim. If the index already has that
 * relationship, the entry only contributes its requirement; if it does not, the entry draws
 * a sketch - a line someone meant, which has not been committed to yet. */

import type { Requirement } from './types.ts';
import type { GraphIndex } from './index-graph.ts';

export interface CanvasNode {
    /** An entity or beat id, or `note:<n>` for a sticky that refers to nothing. */
    ref: string;
    x: number;
    y: number;
    /** Only for a note. */
    text?: string;
}

export interface CanvasEdge {
    from: string;
    to: string;
    /** Absent means a sketch: a line drawn but not yet given a meaning. */
    rel?: string;
    requirement?: Requirement;
}

export interface CanvasDoc {
    id: string;
    name: string;
    nodes: CanvasNode[];
    edges: CanvasEdge[];
}

export const canvasPath = (id: string): string => `canvases/${id}.json`;

export function newCanvas(id: string, name: string): CanvasDoc {
    return { id, name, nodes: [], edges: [] };
}

/** Read a canvas file. A damaged one becomes an empty canvas rather than a crash. */
export function parseCanvas(id: string, text: string): CanvasDoc {
    try {
        const raw = JSON.parse(text) as Partial<CanvasDoc>;
        return {
            id: typeof raw.id === 'string' ? raw.id : id,
            name: typeof raw.name === 'string' ? raw.name : id,
            nodes: (Array.isArray(raw.nodes) ? raw.nodes : []).filter(
                (n): n is CanvasNode => Boolean(n) && typeof n.ref === 'string'
                    && Number.isFinite(n.x) && Number.isFinite(n.y),
            ),
            edges: (Array.isArray(raw.edges) ? raw.edges : []).filter(
                (e): e is CanvasEdge => Boolean(e) && typeof e.from === 'string' && typeof e.to === 'string',
            ),
        };
    } catch {
        return newCanvas(id, id);
    }
}

/* Written with sorted-ish stable ordering and two-space indent so a canvas produces a small,
 * readable diff when a card moves - a layout file that rewrites itself wholesale on every
 * nudge is a layout file nobody keeps in version control. */
export function serialiseCanvas(canvas: CanvasDoc): string {
    const nodes = [...canvas.nodes].sort((a, b) => a.ref.localeCompare(b.ref));
    const edges = [...canvas.edges].sort(
        (a, b) => (a.from + a.to + (a.rel ?? '')).localeCompare(b.from + b.to + (b.rel ?? '')),
    );
    return `${JSON.stringify({ ...canvas, nodes, edges }, null, 2)}\n`;
}

/* -- nodes ------------------------------------------------------------------ */

const GRID = 16;
const snap = (n: number): number => Math.round(n / GRID) * GRID;

export function placeNode(canvas: CanvasDoc, ref: string, x: number, y: number): CanvasDoc {
    if (canvas.nodes.some((n) => n.ref === ref)) return canvas;
    return { ...canvas, nodes: [...canvas.nodes, { ref, x: snap(x), y: snap(y) }] };
}

export function moveNode(canvas: CanvasDoc, ref: string, x: number, y: number): CanvasDoc {
    let moved = false;
    const nodes = canvas.nodes.map((n) => {
        if (n.ref !== ref) return n;
        const next = { ...n, x: snap(x), y: snap(y) };
        if (next.x !== n.x || next.y !== n.y) moved = true;
        return next;
    });
    return moved ? { ...canvas, nodes } : canvas;
}

/** Remove a card, and any edge that only existed because both ends were on the canvas. */
export function removeNode(canvas: CanvasDoc, ref: string): CanvasDoc {
    if (!canvas.nodes.some((n) => n.ref === ref)) return canvas;
    return {
        ...canvas,
        nodes: canvas.nodes.filter((n) => n.ref !== ref),
        edges: canvas.edges.filter((e) => e.from !== ref && e.to !== ref),
    };
}

/* -- edges ------------------------------------------------------------------ */

const sameEdge = (a: CanvasEdge, from: string, to: string, rel?: string): boolean =>
    a.from === from && a.to === to && (a.rel ?? null) === (rel ?? null);

export function addSketch(canvas: CanvasDoc, from: string, to: string): CanvasDoc {
    if (from === to) return canvas; // a card pointing at itself is a slip, not a relationship
    if (canvas.edges.some((e) => sameEdge(e, from, to))) return canvas;
    return { ...canvas, edges: [...canvas.edges, { from, to }] };
}

export function removeEdge(canvas: CanvasDoc, from: string, to: string, rel?: string): CanvasDoc {
    const edges = canvas.edges.filter((e) => !sameEdge(e, from, to, rel));
    return edges.length === canvas.edges.length ? canvas : { ...canvas, edges };
}

/** Attach or clear a requirement on an edge, creating the annotation if needed. */
export function setRequirement(
    canvas: CanvasDoc,
    from: string,
    to: string,
    rel: string | undefined,
    requirement: Requirement | null,
): CanvasDoc {
    const at = canvas.edges.findIndex((e) => sameEdge(e, from, to, rel));
    const edges = [...canvas.edges];

    if (at === -1) {
        if (!requirement) return canvas;
        edges.push({ from, to, ...(rel === undefined ? {} : { rel }), requirement });
        return { ...canvas, edges };
    }

    const existing = edges[at]!;
    if (requirement) edges[at] = { ...existing, requirement };
    else {
        const { requirement: _drop, ...rest } = existing;
        // An annotation with nothing left to say is removed rather than left as noise.
        if (rest.rel === undefined) edges.splice(at, 1);
        else edges[at] = rest;
    }
    return { ...canvas, edges };
}

/* -- what to draw ------------------------------------------------------------ */

export interface DrawnEdge {
    from: string;
    to: string;
    rel: string | null;
    /** A line drawn but not yet meaning anything, so not in any file but this one. */
    sketch: boolean;
    requirement?: Requirement;
    /** Where the real relationship is asserted, for a promoted edge. */
    source?: { file: string; locator?: string };
}

/* The canvas draws the union of what the files say and what someone has sketched. Doing it
 * in one place is what stops a promoted edge appearing twice - once from the index and once
 * from the annotation that created it. */
export function drawnEdges(canvas: CanvasDoc, index: GraphIndex): DrawnEdge[] {
    const present = new Set(canvas.nodes.map((n) => n.ref));
    const out: DrawnEdge[] = [];
    const claimed = new Set<string>();

    const key = (from: string, to: string, rel: string | null): string => `${from}|${rel ?? ''}|${to}`;

    for (const edge of index.edges) {
        if (edge.rel === 'MENTIONS') continue;
        if (!present.has(edge.from) || !present.has(edge.to)) continue;

        const annotation = canvas.edges.find((e) => sameEdge(e, edge.from, edge.to, edge.rel))
            ?? canvas.edges.find((e) => sameEdge(e, edge.from, edge.to));

        out.push({
            from: edge.from,
            to: edge.to,
            rel: edge.rel,
            sketch: false,
            ...(annotation?.requirement ? { requirement: annotation.requirement } : {}),
            source: { file: edge.source.file, ...(edge.source.locator === undefined ? {} : { locator: edge.source.locator }) },
        });
        claimed.add(key(edge.from, edge.to, edge.rel));
    }

    for (const edge of canvas.edges) {
        if (!present.has(edge.from) || !present.has(edge.to)) continue;
        // An annotation whose relationship the index already carries is not a separate line.
        if (claimed.has(key(edge.from, edge.to, edge.rel ?? null))) continue;
        if (edge.rel && claimed.has(key(edge.from, edge.to, edge.rel))) continue;
        if (!edge.rel && [...claimed].some((k) => k.startsWith(`${edge.from}|`) && k.endsWith(`|${edge.to}`))) continue;

        out.push({
            from: edge.from,
            to: edge.to,
            rel: edge.rel ?? null,
            sketch: true,
            ...(edge.requirement ? { requirement: edge.requirement } : {}),
        });
    }

    return out;
}
