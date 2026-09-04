/* Reading a document.
 *
 * One link syntax everywhere: [[id]] works in frontmatter and in prose, so this
 * is the only link parser in the app. A second one would be a second mental
 * model, and they would drift. */

import { parseDocument } from 'yaml';

export interface WikiLink {
    /** The target id, e.g. 'igor' or 'act_1#beat_01_03'. */
    id: string;
    /** Display text after a pipe, if the author wrote one. */
    alias?: string;
    /** Byte offset in the text this was scanned from. */
    index: number;
}

export interface SplitDoc {
    /** Raw YAML text between the fences, or null when there is no frontmatter. */
    frontmatter: string | null;
    body: string;
    /** Offset of `body` within the original text, so link positions stay true. */
    bodyOffset: number;
}

const FENCE = /^---\r?\n/;

/** Split a Markdown file into its YAML frontmatter and its body. */
export function splitFrontmatter(text: string): SplitDoc {
    if (!FENCE.test(text)) return { frontmatter: null, body: text, bodyOffset: 0 };

    const openLen = text.match(FENCE)![0].length;
    const close = text.slice(openLen).search(/^---[ \t]*(\r?\n|$)/m);
    if (close === -1) return { frontmatter: null, body: text, bodyOffset: 0 };

    const fmEnd = openLen + close;
    const afterClose = text.slice(fmEnd).match(/^---[ \t]*(\r?\n|$)/m)![0].length;
    const bodyOffset = fmEnd + afterClose;

    return {
        frontmatter: text.slice(openLen, fmEnd),
        body: text.slice(bodyOffset),
        bodyOffset,
    };
}

/* Deliberately permissive: [[id]], [[id#beat]], [[id|Display]].
 * A '#' selects a sub-document node, a '|' is display text only. */
const WIKILINK = /\[\[([^\]|\n]+?)(?:\|([^\]\n]*?))?\]\]/g;

/** Every [[link]] in a chunk of text, with true offsets. */
export function scanWikilinks(text: string, offset = 0): WikiLink[] {
    const out: WikiLink[] = [];
    for (const m of text.matchAll(WIKILINK)) {
        const id = m[1]!.trim();
        if (!id) continue;
        const alias = m[2]?.trim();
        out.push(alias ? { id, alias, index: m.index + offset } : { id, index: m.index + offset });
    }
    return out;
}

/** The bare id inside a single [[link]], or null if the value is not a link. */
export function asRef(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const m = value.trim().match(/^\[\[([^\]|\n]+?)(?:\|[^\]\n]*?)?\]\]$/);
    return m ? m[1]!.trim() : null;
}

/* Field values are shaped by the author, not by us: a ref is a string, a refList
 * an array, a refQty an array of objects. Rather than branch per field type at
 * every call site, walk whatever is there and collect the links. */
export function collectRefs(value: unknown): string[] {
    const out: string[] = [];
    const walk = (v: unknown): void => {
        if (typeof v === 'string') {
            for (const link of scanWikilinks(v)) out.push(link.id);
            return;
        }
        if (Array.isArray(v)) { for (const item of v) walk(item); return; }
        if (v && typeof v === 'object') { for (const item of Object.values(v)) walk(item); }
    };
    walk(value);
    return out;
}

export interface ParsedDoc {
    path: string;
    data: Record<string, unknown>;
    body: string;
    bodyOffset: number;
    /** Links found in the prose body only - frontmatter links are read per field. */
    proseLinks: WikiLink[];
    /** Frontmatter that would not parse. The file is kept, the problem surfaced. */
    error?: string;
}

/** Parse one Markdown document. Never throws: a broken file becomes a problem. */
export function parseDoc(path: string, text: string): ParsedDoc {
    const split = splitFrontmatter(text);
    const base = {
        path,
        body: split.body,
        bodyOffset: split.bodyOffset,
        proseLinks: scanWikilinks(split.body, split.bodyOffset),
    };

    if (split.frontmatter === null) return { ...base, data: {} };

    const doc = parseDocument(split.frontmatter);
    if (doc.errors.length > 0) {
        return { ...base, data: {}, error: doc.errors[0]!.message };
    }
    const data = doc.toJS() as unknown;
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        return { ...base, data: {}, error: 'frontmatter is not a mapping' };
    }
    return { ...base, data: data as Record<string, unknown> };
}
