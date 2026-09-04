/* The shared vocabulary of the whole app.
 *
 * Everything Basic knows is either a node (a thing) or an edge (a link between
 * two things). Views never invent their own shapes - they query these. */

export type NodeKind = 'object' | 'act' | 'beat';

export interface DocNode {
    /** 'igor', or 'act_1#beat_01_03' for a beat living inside an act file. */
    id: string;
    kind: NodeKind;
    /** Template id for objects; 'act' or 'beat' otherwise. */
    type: string;
    name: string;
    /** Project-relative path of the file this node lives in. */
    path: string;
    /** Beat id, when the node is a sub-document node. */
    locator?: string;
    status?: string;
    fields: Record<string, unknown>;
}

/* Provenance. Every edge remembers who claimed it, because "linked across many
 * sources" is only useful if you can get back to the source. */
export interface EdgeSource {
    file: string;
    kind: 'frontmatter' | 'prose' | 'beat' | 'canvas';
    /** Field key, or beat id, depending on kind. */
    locator?: string;
}

export interface Edge {
    from: string;
    to: string;
    rel: string;
    /** The beat that asserted this, when it came from a progression document. */
    beat?: string;
    requirement?: Requirement;
    source: EdgeSource;
}

export type CounterOp = 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'ne';

export type Requirement =
    | { all: Requirement[] }
    | { any: Requirement[] }
    | { not: Requirement }
    | { flag: string }
    | { has: string }
    | { done: string }
    | { visited: string }
    | { counter: string; op: CounterOp; n: number };

export type FieldType =
    | 'text' | 'longtext' | 'number' | 'bool' | 'enum'
    | 'tags' | 'ref' | 'refList' | 'refQty' | 'image';

export interface TemplateField {
    key: string;
    label: string;
    type: FieldType;
    /** Which node types a ref may point at. */
    to?: string[];
    /** The relation this field emits into the graph. */
    rel?: string;
    options?: string[];
}

export type SectionQuery =
    | { incoming: string[] | { group: string } }
    | { outgoing: string[] | { group: string } };

export interface SectionSpec {
    key: string;
    title: string;
    query: SectionQuery;
}

export interface Template {
    id: string;
    label: string;
    icon?: string;
    color?: string;
    fields: TemplateField[];
    sections?: SectionSpec[];
}

export interface Relation {
    id: string;
    label?: string;
    inverse: string;
    inverseLabel?: string;
    group?: string;
}

/** A validation finding. Errors block, warnings inform. */
export interface Problem {
    severity: 'error' | 'warning';
    rule: string;
    message: string;
    file?: string;
    locator?: string;
}
