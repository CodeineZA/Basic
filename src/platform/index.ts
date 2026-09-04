/* The ONLY file that knows whether Basic is running in Electron or a browser.
 *
 * Everything above this line talks to one interface. In the desktop app it goes
 * over IPC to the real filesystem; in a plain browser it runs against an
 * in-memory project persisted to localStorage, which is what makes the whole UI
 * driveable under Vite without packaging anything. */

import type { ScaffoldFile } from '../core/scaffold.ts';
import { scaffoldProject } from '../core/scaffold.ts';
import { DEMO_FILES } from './demo.ts';

export interface FileChange {
    kind: 'add' | 'change' | 'unlink';
    path: string;
    text?: string;
}

export interface WriteAllResult {
    ok: boolean;
    written: string[];
    failed?: string;
    message?: string;
}

export interface Platform {
    readonly isDesktop: boolean;
    pickFolder(mode: 'open' | 'create'): Promise<string | null>;
    scaffold(root: string, files: ScaffoldFile[]): Promise<void>;
    list(root: string): Promise<string[]>;
    read(root: string, path: string): Promise<string | null>;
    write(root: string, path: string, text: string): Promise<void>;
    writeAll(root: string, edits: ScaffoldFile[]): Promise<WriteAllResult>;
    watch(root: string, onChange: (c: FileChange) => void): () => void;
}

interface NativeBridge {
    project: {
        pickFolder(mode: string): Promise<string | null>;
        scaffold(root: string, files: ScaffoldFile[]): Promise<boolean>;
    };
    fs: {
        list(root: string): Promise<string[]>;
        read(root: string, path: string): Promise<string | null>;
        write(root: string, path: string, text: string): Promise<boolean>;
        writeAll(root: string, edits: ScaffoldFile[]): Promise<WriteAllResult>;
    };
    watch(root: string, onChange: (c: FileChange) => void): () => void;
}

const native = (globalThis as { basicNative?: NativeBridge }).basicNative;

const desktop: Platform = {
    isDesktop: true,
    pickFolder: (mode) => native!.project.pickFolder(mode),
    scaffold: async (root, files) => { await native!.project.scaffold(root, files); },
    list: (root) => native!.fs.list(root),
    read: (root, path) => native!.fs.read(root, path),
    write: async (root, path, text) => { await native!.fs.write(root, path, text); },
    writeAll: (root, edits) => native!.fs.writeAll(root, edits),
    watch: (root, onChange) => native!.watch(root, onChange),
};

/* The browser stand-in. Not a toy: it has the same semantics the real one has,
 * including surviving a reload, so what you verify here is what ships. */
const KEY = 'basic:vfs';

function loadVfs(): Record<string, Record<string, string>> {
    try {
        const raw = localStorage.getItem(KEY);
        if (raw) return JSON.parse(raw) as Record<string, Record<string, string>>;
    } catch {
        // A private window or blocked storage just means we start fresh.
    }
    return { 'demo-project': { ...DEMO_FILES } };
}

const vfs = loadVfs();
const save = (): void => {
    try { localStorage.setItem(KEY, JSON.stringify(vfs)); } catch { /* not fatal */ }
};

const listeners = new Map<string, Set<(c: FileChange) => void>>();
const announce = (root: string, change: FileChange): void => {
    for (const fn of listeners.get(root) ?? []) fn(change);
};

const browser: Platform = {
    isDesktop: false,
    pickFolder: async (mode) => {
        const name = mode === 'create' ? `project-${Date.now()}` : 'demo-project';
        vfs[name] ??= {};
        save();
        return name;
    },
    scaffold: async (root, files) => {
        vfs[root] ??= {};
        for (const f of files) vfs[root]![f.path] = f.text;
        save();
    },
    list: async (root) => Object.keys(vfs[root] ?? {}).sort(),
    read: async (root, path) => vfs[root]?.[path] ?? null,
    write: async (root, path, text) => {
        vfs[root] ??= {};
        vfs[root]![path] = text;
        save();
    },
    writeAll: async (root, edits) => {
        vfs[root] ??= {};
        for (const e of edits) vfs[root]![e.path] = e.text;
        save();
        return { ok: true, written: edits.map((e) => e.path) };
    },
    watch: (root, onChange) => {
        const set = listeners.get(root) ?? new Set();
        set.add(onChange);
        listeners.set(root, set);
        return () => { set.delete(onChange); };
    },
};

export const platform: Platform = native ? desktop : browser;

/** Seed a fresh browser session with something to look at. */
export const DEMO_ROOT = 'demo-project';

export function ensureDemo(): string {
    if (!vfs[DEMO_ROOT] || Object.keys(vfs[DEMO_ROOT]).length === 0) {
        vfs[DEMO_ROOT] = { ...DEMO_FILES };
        save();
    }
    return DEMO_ROOT;
}

export { scaffoldProject, announce };
