/* Turning index queries into the generated blocks on a page.
 *
 * A section is declared on the template, not written in code, so "an item shows
 * where it can be obtained" is configuration. Rows are sorted before they are
 * rendered: unstable ordering would make every regeneration a change, and the
 * file would churn forever. */

import { incoming, outgoing, type GraphIndex } from './index-graph.ts';
import { relsFor, type Project } from './project.ts';
import type { Edge, SectionSpec } from './types.ts';
import type { Section } from './write-doc.ts';

/** A page with nothing to show says so, rather than rendering an empty list. */
export const EMPTY = '_Nothing yet._';

const link = (index: GraphIndex, id: string): string => {
    const node = index.nodes.get(id);
    if (!node) return `[[${id}]]`;
    return node.name === id ? `[[${id}]]` : `[[${id}|${node.name}]]`;
};

/** What to call an edge when you are reading it from the far end. */
function labelFor(project: Project, edge: Edge, direction: 'incoming' | 'outgoing'): string {
    const rel = project.relations.get(edge.rel);
    if (!rel) return edge.rel;
    return direction === 'incoming' ? (rel.inverseLabel ?? rel.inverse) : (rel.label ?? rel.id);
}

function renderRow(
    index: GraphIndex, project: Project, edge: Edge, direction: 'incoming' | 'outgoing',
): string {
    const other = direction === 'incoming' ? edge.from : edge.to;
    const parts = [`- **${labelFor(project, edge, direction)}** ${link(index, other)}`];
    // Provenance: the beat that claimed this, so the reader can go and read it.
    if (edge.beat && edge.beat !== other) parts.push(link(index, edge.beat));
    return parts.join(' · ');
}

export function renderSection(
    index: GraphIndex, project: Project, nodeId: string, spec: SectionSpec,
): Section {
    const direction = 'incoming' in spec.query ? 'incoming' : 'outgoing';
    const rels = relsFor(
        project,
        'incoming' in spec.query ? spec.query.incoming : spec.query.outgoing,
    );
    const edges = direction === 'incoming'
        ? incoming(index, nodeId, rels)
        : outgoing(index, nodeId, rels);

    const rows = edges
        .map((e) => renderRow(index, project, e, direction))
        .filter((row, i, all) => all.indexOf(row) === i)
        .sort();

    const body = rows.length > 0 ? rows.join('\n') : EMPTY;
    return { key: spec.key, content: `#### ${spec.title}\n\n${body}` };
}

/** Every generated block a page should carry. The COMPLETE set - see applyBlocks. */
export function renderSections(index: GraphIndex, project: Project, nodeId: string): Section[] {
    const node = index.nodes.get(nodeId);
    if (!node || node.kind !== 'object') return [];
    const specs = project.templates.get(node.type)?.sections ?? [];
    return specs.map((spec) => renderSection(index, project, nodeId, spec));
}
