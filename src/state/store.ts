/* One store. Every view is a query over it, and nothing else owns data.
 *
 * The canvas does not hold node records and an editor tab does not hold a file:
 * they hold a subscription. Two views of the same act cannot disagree because
 * there is only one copy to disagree with. */

import { parse } from 'yaml';
import { buildIndex, type GraphIndex } from '../core/index-graph.ts';
import { parseDoc, type ParsedDoc } from '../core/parse-doc.ts';
import { makeProject, parseTemplate, DEFAULT_RELATIONS, DEFAULT_STATUSES, type Project } from '../core/project.ts';
import { renderSections } from '../core/generate.ts';
import { applyBlocks } from '../core/write-doc.ts';
import { validateProject } from '../core/validate.ts';
import type { EditResult } from '../core/edit-doc.ts';
import { newObjectPage, scaffoldProject } from '../core/scaffold.ts';
import { newTemplateFile } from '../core/edit-schema.ts';
import {
    canvasPath, newCanvas, parseCanvas, serialiseCanvas, type CanvasDoc,
} from '../core/canvas.ts';
import type { Problem, Relation, Template } from '../core/types.ts';
import { platform, type FileChange } from '../platform/index.ts';

export interface OpenDoc {
    path: string;
    /** What is on disk, as far as we know. */
    text: string;
    /** Unsaved edits. Undefined means the tab is clean. */
    buffer?: string;
    /** Set when disk changed under an unsaved buffer. Never merged silently. */
    conflict?: string;
}

export interface State {
    root: string | null;
    name: string;
    project: Project | null;
    docs: Map<string, OpenDoc>;
    index: GraphIndex | null;
    /** Index problems and write refusals combined - what the UI shows. */
    problems: Problem[];
    /* Kept apart from the index's own findings because reindexing must not
     * silently drop them: a file Basic REFUSED to write is the single most
     * important thing on the list, and it is not something the index knows. */
    writeProblems: Problem[];
    busy: boolean;
    notice: string | null;
}

const empty = (): State => ({
    root: null, name: 'Basic', project: null,
    docs: new Map(), index: null, problems: [], writeProblems: [], busy: false, notice: null,
});

export interface Store {
    getState(): State;
    subscribe(fn: () => void): () => void;
    openProject(root: string): Promise<void>;
    createProject(root: string, name: string): Promise<void>;
    /** Current text of a document: the unsaved buffer if there is one. */
    textOf(path: string): string;
    setBuffer(path: string, text: string): void;
    /** Apply a structured edit to a document, e.g. reordering an act's beats. */
    applyEdit(path: string, edit: (text: string, file: string) => EditResult): boolean;
    /** Create a page for a link that points at nothing. Returns its path. */
    createEntity(type: string, id: string, name: string): Promise<string | null>;
    /** Create a new kind of thing. Returns the template's path. */
    createTemplate(id: string, label: string): Promise<string | null>;
    /** Canvas ids in the project. */
    canvasIds(): string[];
    /** A canvas document, or null when there is no such file. */
    canvasDoc(id: string): CanvasDoc | null;
    /** Change a canvas. Buffered like every other edit, so one save writes it. */
    updateCanvas(id: string, change: (canvas: CanvasDoc) => CanvasDoc): void;
    createCanvas(id: string, name: string): Promise<string | null>;
    resolveConflict(path: string, keep: 'mine' | 'theirs'): void;
    save(): Promise<void>;
}

export function createStore(): Store {
    let state = empty();
    const listeners = new Set<() => void>();
    let unwatch: (() => void) | null = null;

    const emit = (): void => { for (const fn of listeners) fn(); };
    const set = (patch: Partial<State>): void => { state = { ...state, ...patch }; emit(); };

    const parsedDocs = (): ParsedDoc[] => {
        const out: ParsedDoc[] = [];
        for (const doc of state.docs.values()) {
            if (!doc.path.endsWith('.md')) continue;
            out.push(parseDoc(doc.path, doc.buffer ?? doc.text));
        }
        return out;
    };

    /** Rebuild the schema and the graph from whatever the docs currently say. */
    const reindex = (): void => {
        const project = readProject(state.docs, state.name);
        const index = buildIndex(parsedDocs(), project);
        state = {
            ...state, project, index,
            // validateProject already folds in the indexer's own referential findings.
            problems: [...validateProject(index, project), ...state.writeProblems],
        };
        emit();
    };

    const load = async (root: string): Promise<void> => {
        set({ busy: true });
        const paths = await platform.list(root);
        const docs = new Map<string, OpenDoc>();
        for (const path of paths) {
            const text = await platform.read(root, path);
            if (text !== null) docs.set(path, { path, text });
        }
        const name = readManifest(docs).name ?? root.split(/[\\/]/).pop() ?? 'Basic';
        state = { ...state, root, name, docs, busy: false };
        reindex();

        unwatch?.();
        unwatch = platform.watch(root, (change) => applyExternal(change));
    };

    /* An external edit reloads a clean tab in silence - that is the common case
     * and it must be frictionless. A dirty tab raises a conflict instead: never
     * merge, never pick a winner. */
    const applyExternal = (change: FileChange): void => {
        const docs = new Map(state.docs);
        if (change.kind === 'unlink') {
            docs.delete(change.path);
        } else {
            const existing = docs.get(change.path);
            const text = change.text ?? '';
            if (existing?.buffer !== undefined && existing.buffer !== text) {
                docs.set(change.path, { ...existing, conflict: text });
            } else {
                docs.set(change.path, { path: change.path, text });
            }
        }
        state = { ...state, docs };
        reindex();
    };

    return {
        getState: () => state,

        subscribe(fn) {
            listeners.add(fn);
            return () => { listeners.delete(fn); };
        },

        async openProject(root) { await load(root); },

        async createProject(root, name) {
            await platform.scaffold(root, scaffoldProject(name));
            await load(root);
        },

        textOf(path) {
            const doc = state.docs.get(path);
            return doc?.buffer ?? doc?.text ?? '';
        },

        setBuffer(path, text) {
            const doc = state.docs.get(path);
            if (!doc) return;
            const docs = new Map(state.docs);
            docs.set(path, text === doc.text ? { path, text: doc.text } : { ...doc, buffer: text });
            state = { ...state, docs };
            reindex();
        },

        /* Structured edits go through the same buffer as typing does, so the canvas, the
         * script view and any open editor all move together and a single save writes it. */
        applyEdit(path, edit) {
            const doc = state.docs.get(path);
            if (!doc) return false;

            const result = edit(doc.buffer ?? doc.text, path);
            if (!result.ok) {
                state = { ...state, writeProblems: [...state.writeProblems, result.problem] };
                reindex();
                return false;
            }
            if (!result.changed) return false;

            this.setBuffer(path, result.text);
            return true;
        },

        /* Creating a page is a deliberate act with no half-way state, so it lands on disk
         * immediately rather than sitting in a buffer - otherwise the link that prompted it
         * would still be dead until an unrelated save. */
        async createEntity(type, id, name) {
            const { root, project, index } = state;
            if (!root || !project) return null;

            const template = project.templates.get(type);
            if (!template) return null;
            if (index?.nodes.has(id)) return null;

            const path = `entities/${type}/${id}.md`;
            const text = newObjectPage(template, id, name);
            await platform.write(root, path, text);

            const docs = new Map(state.docs);
            docs.set(path, { path, text });
            state = { ...state, docs };
            reindex();
            return path;
        },

        /* A new kind of thing. Written straight away for the same reason a page is: the
         * explorer, the palette and every type dropdown should show it at once. */
        async createTemplate(id, label) {
            const { root, project } = state;
            if (!root || !project || project.templates.has(id)) return null;

            const path = `templates/${id}.yaml`;
            const text = newTemplateFile(id, label);
            await platform.write(root, path, text);

            const docs = new Map(state.docs);
            docs.set(path, { path, text });
            state = { ...state, docs };
            reindex();
            return path;
        },

        canvasIds() {
            return [...state.docs.keys()]
                .filter((p) => p.startsWith('canvases/') && p.endsWith('.json'))
                .map((p) => p.slice('canvases/'.length, -'.json'.length))
                .sort();
        },

        canvasDoc(id) {
            const doc = state.docs.get(canvasPath(id));
            return doc ? parseCanvas(id, doc.buffer ?? doc.text) : null;
        },

        /* Layout is data like anything else: it goes through the buffer, so moving a card
         * marks the tab dirty and one save writes it alongside every other change. */
        updateCanvas(id, change) {
            const path = canvasPath(id);
            const doc = state.docs.get(path);
            if (!doc) return;

            const before = parseCanvas(id, doc.buffer ?? doc.text);
            const after = change(before);
            if (after === before) return;

            const text = serialiseCanvas(after);
            if (text === (doc.buffer ?? doc.text)) return;
            this.setBuffer(path, text);
        },

        async createCanvas(id, name) {
            const { root } = state;
            if (!root || state.docs.has(canvasPath(id))) return null;

            const path = canvasPath(id);
            const text = serialiseCanvas(newCanvas(id, name));
            await platform.write(root, path, text);

            const docs = new Map(state.docs);
            docs.set(path, { path, text });
            state = { ...state, docs };
            reindex();
            return path;
        },

        resolveConflict(path, keep) {
            const doc = state.docs.get(path);
            if (!doc?.conflict) return;
            const docs = new Map(state.docs);
            docs.set(path, keep === 'theirs'
                ? { path, text: doc.conflict }
                : { path, text: doc.conflict, buffer: doc.buffer ?? doc.text });
            state = { ...state, docs };
            reindex();
        },

        /* Save is where generated blocks reach disk. The index is already live,
         * so the whole batch is computed first and written in one go - a
         * half-updated project is the outcome worth most effort to avoid. */
        async save() {
            const { root, project, index } = state;
            if (!root || !project || !index) return;
            // Recomputed from scratch every save; a fixed file must stop nagging.
            set({ busy: true, notice: null, writeProblems: [] });

            const edits: Array<{ path: string; text: string }> = [];
            const blocked: Problem[] = [];

            for (const doc of state.docs.values()) {
                const current = doc.buffer ?? doc.text;
                let next = current;

                if (doc.path.endsWith('.md')) {
                    const parsed = parseDoc(doc.path, current);
                    const id = typeof parsed.data['id'] === 'string' ? parsed.data['id'] : null;
                    if (id && index.nodes.has(id)) {
                        const result = applyBlocks(current, renderSections(index, project, id), doc.path);
                        if (!result.ok) { blocked.push(result.problem); continue; }
                        next = result.text;
                    }
                }
                if (next !== doc.text) edits.push({ path: doc.path, text: next });
            }

            if (edits.length === 0) {
                state = { ...state, busy: false, writeProblems: blocked };
                reindex();
                return;
            }

            const result = await platform.writeAll(root, edits);
            const docs = new Map(state.docs);
            for (const edit of edits) {
                if (!result.written.includes(edit.path)) continue;
                docs.set(edit.path, { path: edit.path, text: edit.text });
            }
            state = {
                ...state, docs, busy: false,
                notice: result.ok
                    ? null
                    : `Wrote ${result.written.length} of ${edits.length} files, then failed on ${result.failed}: ${result.message}`,
                writeProblems: blocked,
            };
            reindex();
        },
    };
}

/* -- reading the project's own schema off disk ---------------------------- */

function readManifest(docs: Map<string, OpenDoc>): { name: string | null; statuses: string[] } {
    const fallback = { name: null, statuses: [...DEFAULT_STATUSES] };
    const manifest = docs.get('basic.json');
    if (!manifest) return fallback;
    try {
        const parsed = JSON.parse(manifest.buffer ?? manifest.text) as { name?: unknown; statuses?: unknown };
        const statuses = Array.isArray(parsed.statuses) && parsed.statuses.every((v) => typeof v === 'string')
            ? parsed.statuses as string[]
            : fallback.statuses;
        return { name: typeof parsed.name === 'string' ? parsed.name : null, statuses };
    } catch {
        return fallback;
    }
}

function readProject(docs: Map<string, OpenDoc>, name: string): Project {
    const templates: Template[] = [];
    for (const doc of docs.values()) {
        if (!doc.path.startsWith('templates/') || !doc.path.endsWith('.yaml')) continue;
        try {
            const t = parseTemplate(doc.buffer ?? doc.text);
            if (t?.id) templates.push({ ...t, fields: t.fields ?? [] });
        } catch {
            // A broken template surfaces as unknown-type problems on its pages,
            // which points at the real cause better than a parse error here.
        }
    }

    let relations = DEFAULT_RELATIONS;
    const relDoc = docs.get('relations.yaml');
    if (relDoc) {
        try {
            const parsed = parse(relDoc.buffer ?? relDoc.text) as Relation[] | null;
            if (Array.isArray(parsed) && parsed.length > 0) relations = parsed;
        } catch { /* fall back to the defaults */ }
    }

    return makeProject(name, templates, relations, readManifest(docs).statuses);
}
