/* Turning a page into something you read rather than edit.
 *
 * Wikilinks are parsed by a markdown-it inline rule, NOT by rewriting the text first. A
 * regex pass over the source would happily rewrite `[[this]]` inside a code fence, where it
 * is meant to be shown rather than followed. An inline rule only runs where inline markup
 * runs, which is exactly the distinction we want.
 *
 * Generated blocks are rendered as their own sections with their markers stripped, so the
 * reader sees the finished page and not the plumbing - but they stay labelled, because a
 * section you cannot edit should say so before you try. */

import MarkdownIt from 'markdown-it';
import { splitFrontmatter } from './parse-doc.ts';
import { findBlocks } from './write-doc.ts';

export interface RenderOptions {
    /** Whether a wikilink target resolves, so a dead one can be styled and offered. */
    exists: (id: string) => boolean;
    /** What to call a target when the author gave no display text. */
    displayName: (id: string) => string;
}

export interface RenderedPart {
    kind: 'prose' | 'generated';
    /** The managed block's key, for a generated part. */
    key?: string;
    html: string;
}

/* Only these schemes survive. markdown-it blocks javascript: by default; this is narrower
 * still, because a page is someone's file and there is no reason for it to reach anywhere
 * but the web or another page in the project. */
const SAFE_LINK = /^(https?:|mailto:|basic:|#)/i;

function wikilinkPlugin(md: MarkdownIt, opts: RenderOptions): void {
    md.inline.ruler.before('link', 'wikilink', (state, silent) => {
        const start = state.pos;
        if (state.src.charCodeAt(start) !== 0x5B) return false;       // [
        if (state.src.charCodeAt(start + 1) !== 0x5B) return false;   // [[

        const close = state.src.indexOf(']]', start + 2);
        if (close === -1) return false;

        const inner = state.src.slice(start + 2, close);
        if (inner.length === 0 || inner.includes('\n') || inner.includes('[')) return false;

        if (!silent) {
            const bar = inner.indexOf('|');
            const id = (bar === -1 ? inner : inner.slice(0, bar)).trim();
            const alias = bar === -1 ? '' : inner.slice(bar + 1).trim();
            const missing = !opts.exists(id);

            const open = state.push('link_open', 'a', 1);
            open.attrSet('href', `basic:${id}`);
            open.attrSet('data-ref', id);
            open.attrSet('class', missing ? 'wikilink is-missing' : 'wikilink');
            if (missing) open.attrSet('title', `${id} — no page yet`);

            const text = state.push('text', '', 0);
            text.content = alias || opts.displayName(id);

            state.push('link_close', 'a', -1);
        }

        state.pos = close + 2;
        return true;
    });
}

function makeRenderer(opts: RenderOptions): MarkdownIt {
    const md = new MarkdownIt({
        // Raw HTML in a page is escaped rather than run. These are the user's own files, but
        // "the user's own file" is exactly what an imported or shared project is not.
        html: false,
        linkify: false,
        breaks: false,
        typographer: false,
    });
    md.validateLink = (url) => SAFE_LINK.test(url.trim());
    md.use(wikilinkPlugin, opts);
    return md;
}

export interface RenderedPage {
    /** Frontmatter is the form's business, not the reader's; kept out of the prose. */
    parts: RenderedPart[];
}

/** Render a document body into readable parts, generated sections kept distinct. */
export function renderPage(text: string, opts: RenderOptions): RenderedPage {
    const md = makeRenderer(opts);
    const { body } = splitFrontmatter(text);
    const scan = findBlocks(body);

    // A malformed page still has to be readable; it just gets no section boundaries.
    if (!scan.ok) return { parts: [{ kind: 'prose', html: md.render(body) }] };

    const parts: RenderedPart[] = [];
    let cursor = 0;

    const prose = (from: number, to: number): void => {
        const chunk = body.slice(from, to).trim();
        if (chunk.length > 0) parts.push({ kind: 'prose', html: md.render(chunk) });
    };

    for (const block of scan.blocks) {
        prose(cursor, block.start);
        parts.push({ kind: 'generated', key: block.key, html: md.render(block.content) });
        cursor = block.end;
    }
    prose(cursor, body.length);

    return { parts };
}

/** Every wikilink in a document that points at nothing, in the order they appear. */
export function unresolvedLinks(text: string, exists: (id: string) => boolean): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    const { body } = splitFrontmatter(text);

    for (const m of body.matchAll(/\[\[([^\]|\n]+?)(?:\|[^\]\n]*?)?\]\]/g)) {
        const id = m[1]!.trim();
        if (!id || seen.has(id) || exists(id)) continue;
        seen.add(id);
        out.push(id);
    }
    return out;
}
