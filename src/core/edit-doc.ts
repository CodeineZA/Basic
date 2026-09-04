/* Editing a document's frontmatter in place.
 *
 * Everything until now only ever wrote generated blocks into the BODY. Reordering beats
 * means writing structured data back into the frontmatter, which is a sharper edge: it is
 * hand-authored YAML, often with comments explaining a decision, and a naive
 * parse-then-dump would silently drop every one of them.
 *
 * So this goes through the yaml Document API rather than toJS/stringify. Comments, key
 * order and block scalars survive, because the document is edited rather than rebuilt.
 *
 * Reports rather than throws, for the same reason write-doc.ts does: a file we cannot make
 * sense of is a problem to show someone, not an exception to unwind the world with. */

import { isMap, isSeq, parseDocument, type Document, type YAMLMap, type YAMLSeq } from 'yaml';
import { splitFrontmatter } from './parse-doc.ts';
import type { Problem } from './types.ts';

export type EditResult =
    | { ok: true; text: string; changed: boolean }
    | { ok: false; problem: Problem };

const fail = (rule: string, message: string, file?: string): EditResult => ({
    ok: false,
    problem: { severity: 'error', rule, message, ...(file === undefined ? {} : { file }) },
});

/** Apply a mutation to a document's frontmatter, leaving the body untouched. */
export function editFrontmatter(
    text: string,
    mutate: (doc: Document) => boolean,
    file?: string,
): EditResult {
    const split = splitFrontmatter(text);
    if (split.frontmatter === null) {
        return fail('edit/no-frontmatter', 'this document has no frontmatter to edit', file);
    }

    const doc = parseDocument(split.frontmatter);
    if (doc.errors.length > 0) {
        return fail('edit/frontmatter', `frontmatter will not parse: ${doc.errors[0]!.message}`, file);
    }

    if (!mutate(doc)) return { ok: true, text, changed: false };

    let yaml = doc.toString({ lineWidth: 0 });
    if (!yaml.endsWith('\n')) yaml += '\n';

    // The body is spliced back verbatim. Only the frontmatter is ever rewritten.
    return { ok: true, text: `---\n${yaml}---\n${split.body}`, changed: true };
}

/* -- beats ----------------------------------------------------------------- */

/** The `beats` sequence, or null when the document has none or it is the wrong shape. */
function beatsOf(doc: Document): YAMLSeq | null {
    const beats = doc.get('beats');
    return isSeq(beats) ? beats : null;
}

function indexOfBeat(seq: YAMLSeq, beatId: string): number {
    return seq.items.findIndex((item) => isMap(item) && item.get('id') === beatId);
}

/** Move a beat by `delta` places. Ordering is data: it changes what the fold derives. */
export function moveBeat(text: string, beatId: string, delta: number, file?: string): EditResult {
    return editFrontmatter(text, (doc) => {
        const seq = beatsOf(doc);
        if (!seq) return false;
        const from = indexOfBeat(seq, beatId);
        if (from === -1) return false;

        const to = from + delta;
        // Clamping rather than erroring: "up" on the first beat is a no-op, not a failure.
        if (to < 0 || to >= seq.items.length) return false;

        const [item] = seq.items.splice(from, 1);
        seq.items.splice(to, 0, item);
        return true;
    }, file);
}

export interface BeatSeed {
    id: string;
    title: string;
    status?: string;
    verify?: string;
    text?: string;
}

/** Append a beat, or insert it after `afterBeatId` when one is given. */
export function addBeat(text: string, beat: BeatSeed, afterBeatId?: string, file?: string): EditResult {
    return editFrontmatter(text, (doc) => {
        let seq = beatsOf(doc);
        if (!seq) {
            // An act with `beats: []`, or none at all, still has to accept its first beat.
            if (doc.get('beats') !== undefined && !isSeq(doc.get('beats'))) return false;
            doc.set('beats', doc.createNode([]));
            seq = beatsOf(doc);
            if (!seq) return false;
        }

        const node = doc.createNode({
            id: beat.id,
            title: beat.title,
            status: beat.status ?? 'pending',
            ...(beat.verify === undefined ? {} : { verify: beat.verify }),
            ...(beat.text === undefined ? {} : { text: beat.text }),
        });

        const after = afterBeatId ? indexOfBeat(seq, afterBeatId) : -1;
        if (after === -1) seq.items.push(node);
        else seq.items.splice(after + 1, 0, node);
        return true;
    }, file);
}

export function removeBeat(text: string, beatId: string, file?: string): EditResult {
    return editFrontmatter(text, (doc) => {
        const seq = beatsOf(doc);
        if (!seq) return false;
        const at = indexOfBeat(seq, beatId);
        if (at === -1) return false;
        seq.items.splice(at, 1);
        return true;
    }, file);
}

/** Set fields on a beat. A value of null removes the key rather than writing a null. */
export function updateBeat(
    text: string,
    beatId: string,
    patch: Record<string, unknown>,
    file?: string,
): EditResult {
    return editFrontmatter(text, (doc) => {
        const seq = beatsOf(doc);
        if (!seq) return false;
        const at = indexOfBeat(seq, beatId);
        if (at === -1) return false;

        const item = seq.items[at] as YAMLMap;
        let changed = false;
        for (const [key, value] of Object.entries(patch)) {
            if (value === null) {
                if (item.has(key)) { item.delete(key); changed = true; }
                continue;
            }
            // Writing an identical value would still rewrite the file; skip it.
            if (item.get(key) === value) continue;
            item.set(key, doc.createNode(value));
            changed = true;
        }
        return changed;
    }, file);
}

/** A beat id that is not already taken in this act, in the house style. */
export function nextBeatId(existing: readonly string[]): string {
    const used = new Set(existing);
    for (let n = 1; n < 1000; n++) {
        const id = `beat_${String(n).padStart(2, '0')}`;
        if (!used.has(id)) return id;
    }
    return `beat_${Date.now()}`;
}
