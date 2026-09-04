/* Writing generated sections back into a document.
 *
 * This is the sharpest edge in the app: it rewrites regions of files the user
 * has hand-written prose into. Three rules, and the tests enforce all three.
 *
 *   1. Only ever touch text between a matched pair of markers.
 *   2. Writing twice produces byte-identical output.
 *   3. Malformed markers mean refuse to write and report - never guess which
 *      marker the author meant.
 *
 * It reports rather than throws, because "this file is confusing" is a problem
 * to show the user, not an exception to unwind the world with. */

import type { Problem } from './types.ts';

export interface ManagedBlock {
    key: string;
    /** Offset of the opening marker's first character. */
    start: number;
    /** Offset one past the closing marker's last character. */
    end: number;
    /** Current content between the markers, newline-trimmed. */
    content: string;
}

export interface Section {
    key: string;
    content: string;
}

export type ScanResult =
    | { ok: true; blocks: ManagedBlock[] }
    | { ok: false; problem: Problem };

export type WriteResult =
    | { ok: true; text: string; changed: boolean }
    | { ok: false; problem: Problem };

const MARKER = /^[ \t]*<!--[ \t]*(\/?)basic:([A-Za-z0-9_-]+)[ \t]*-->[ \t]*$/gm;

const trimBlankLines = (s: string): string =>
    s.replace(/\r\n/g, '\n').replace(/^\n+/, '').replace(/\n+$/, '');

export const openMarker = (key: string): string => `<!-- basic:${key} -->`;
export const closeMarker = (key: string): string => `<!-- /basic:${key} -->`;

export function renderBlock(key: string, content: string): string {
    return `${openMarker(key)}\n${trimBlankLines(content)}\n${closeMarker(key)}`;
}

const malformed = (rule: string, message: string, file?: string): Problem => ({
    severity: 'error',
    rule,
    message,
    ...(file === undefined ? {} : { file }),
});

/** Find every managed block, or explain why the file cannot be trusted. */
export function findBlocks(text: string, file?: string): ScanResult {
    const blocks: ManagedBlock[] = [];
    const seen = new Set<string>();
    let open: { key: string; start: number; innerStart: number } | null = null;

    MARKER.lastIndex = 0;
    for (const m of text.matchAll(MARKER)) {
        const isClose = m[1] === '/';
        const key = m[2]!;
        const start = m.index;
        const end = m.index + m[0].length;

        if (!isClose) {
            if (open) {
                return {
                    ok: false,
                    problem: malformed('block/nested',
                        `'basic:${key}' opens inside 'basic:${open.key}', which is never closed`, file),
                };
            }
            if (seen.has(key)) {
                return {
                    ok: false,
                    problem: malformed('block/duplicate',
                        `'basic:${key}' appears more than once`, file),
                };
            }
            seen.add(key);
            open = { key, start, innerStart: end };
            continue;
        }

        if (!open) {
            return {
                ok: false,
                problem: malformed('block/orphan-close',
                    `'/basic:${key}' closes a block that was never opened`, file),
            };
        }
        if (open.key !== key) {
            return {
                ok: false,
                problem: malformed('block/mismatch',
                    `'basic:${open.key}' is closed by '/basic:${key}'`, file),
            };
        }
        blocks.push({
            key,
            start: open.start,
            end,
            content: trimBlankLines(text.slice(open.innerStart, start)),
        });
        open = null;
    }

    if (open) {
        return {
            ok: false,
            problem: malformed('block/unclosed', `'basic:${open.key}' is never closed`, file),
        };
    }
    return { ok: true, blocks };
}

/* `sections` must be the COMPLETE desired set for this document. Any managed
 * block not named in it is stale generated content and gets removed - leaving
 * it would be showing the user a fact that is no longer true. */
export function applyBlocks(text: string, sections: Section[], file?: string): WriteResult {
    const scan = findBlocks(text, file);
    if (!scan.ok) return scan;

    const byKey = new Map(scan.blocks.map((b) => [b.key, b]));
    const wanted = new Map(sections.map((s) => [s.key, trimBlankLines(s.content)]));

    type Edit = { start: number; end: number; text: string };
    const edits: Edit[] = [];

    for (const block of scan.blocks) {
        const next = wanted.get(block.key);
        if (next === undefined) {
            // Stale block: swallow the blank lines above it so removals do not
            // leave a growing gap behind.
            const before = text.slice(0, block.start);
            const pad = before.match(/(?:\r?\n[ \t]*)+$/);
            const start = pad ? block.start - pad[0].length + 1 : block.start;
            edits.push({ start, end: block.end, text: '' });
            continue;
        }
        if (next !== block.content) {
            edits.push({ start: block.start, end: block.end, text: renderBlock(block.key, next) });
        }
    }

    const appended = sections.filter((s) => !byKey.has(s.key));
    if (edits.length === 0 && appended.length === 0) {
        return { ok: true, text, changed: false };
    }

    // Right to left, so earlier offsets stay valid.
    let out = text;
    for (const edit of edits.sort((a, b) => b.start - a.start)) {
        out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
    }

    if (appended.length > 0) {
        const head = out.replace(/\s+$/, '');
        const body = appended.map((s) => renderBlock(s.key, s.content)).join('\n\n');
        out = head ? `${head}\n\n${body}` : body;
    }

    return { ok: true, text: `${out.replace(/\s+$/, '')}\n`, changed: true };
}
