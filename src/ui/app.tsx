/* The shell: tabs across the top, explorer left, workspace centre, palette or inspector
 * right, status along the bottom.
 *
 * Canvases and documents are both just tabs, because a canvas that refers to another canvas
 * and a page that links to another page are the same idea. A progression document gets two
 * views of the same data - script and flow - which are a switch, not two tabs. */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createStore } from '../state/store.ts';
import { DEMO_ROOT, ensureDemo, platform, type UpdateState } from '../platform/index.ts';
import { addBeat, moveBeat, nextBeatId, removeBeat, updateBeat } from '../core/edit-doc.ts';
import { humanise } from '../core/scaffold.ts';
import { GraphView } from './canvas/graph.tsx';
import { ScriptView } from './script/script.tsx';
import { Board } from './board/board.tsx';
import { Problems } from './problems/problems.tsx';
import { TemplateEditor } from './schema/template-editor.tsx';
import { RelationsEditor } from './schema/relations-editor.tsx';
import { TableView } from './table/table.tsx';
import {
    addRelation, addTemplateField, moveTemplateField, removeRelation, removeTemplateField,
    removeTemplateSection, setTemplateMeta, updateRelation, updateTemplateField,
} from '../core/edit-schema.ts';
import { setFrontmatterField } from '../core/edit-doc.ts';
import { WorldPanel } from './script/world.tsx';
import { Editor } from './wiki/editor.tsx';
import { Page } from './wiki/page.tsx';
import { Explorer } from './explorer/explorer.tsx';
import { Inspector } from './inspector/inspector.tsx';

const store = createStore();

interface Tab { id: string; title: string; }
type ActView = 'script' | 'flow' | 'board';
/* A wiki reads by default; editing is a deliberate step, not the resting state. */
type DocView = 'read' | 'edit';

/** The updater's state, kept in sync with the main process. */
function useUpdates(): UpdateState {
    const [state, setState] = useState<UpdateState>({ status: 'idle', version: '0.0.0' });

    useEffect(() => {
        let live = true;
        void platform.updates.state().then((s) => { if (live) setState(s); });
        const off = platform.updates.subscribe(setState);
        return () => { live = false; off(); };
    }, []);

    return state;
}

/* Only speaks when it has something to say. A banner that permanently reports "up to date"
 * is a banner people stop reading, and then they miss the one that matters. */
function UpdateBanner({ state }: { state: UpdateState }): React.JSX.Element | null {
    if (state.status === 'ready') {
        return (
            <div className="update-bar" role="status">
                <span><strong>Basic {state.available}</strong> is downloaded.</span>
                <button type="button" className="btn btn-primary" onClick={() => void platform.updates.install()}>
                    Restart to update
                </button>
            </div>
        );
    }
    if (state.status === 'downloading') {
        return (
            <div className="update-bar" role="status">
                {/* A number, not a spinner: "downloading" with no progress is indistinguishable
                    from stuck. */}
                <span>Downloading Basic {state.available ?? ''} — {state.percent ?? 0}%</span>
            </div>
        );
    }
    if (state.status === 'error') {
        return (
            <div className="update-bar is-error" role="alert">
                <span>Could not check for updates: {state.message}</span>
                <button type="button" className="btn" onClick={() => void platform.updates.checkNow()}>
                    Try again
                </button>
            </div>
        );
    }
    return null;
}

export function App(): React.JSX.Element {
    const state = useSyncExternalStore(store.subscribe, store.getState);
    const updates = useUpdates();
    const [tabs, setTabs] = useState<Tab[]>([]);
    const [active, setActive] = useState<string | null>(null);
    const [selected, setSelected] = useState<string | null>(null);
    const [actView, setActView] = useState<ActView>('script');
    /** The beat the world is being shown as of. Null is "before anything happens". */
    const [cursor, setCursor] = useState<string | null>(null);
    /** Show only beats in this state. 'all' is everything. */
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [docView, setDocView] = useState<DocView>('read');

    const open = useCallback((tab: Tab) => {
        setTabs((current) => (current.some((t) => t.id === tab.id) ? current : [...current, tab]));
        setActive(tab.id);
    }, []);

    const openAct = useCallback((actId: string) => {
        const name = store.getState().index?.nodes.get(actId)?.name ?? actId;
        open({ id: `act:${actId}`, title: name });
    }, [open]);

    const openDoc = useCallback((path: string) => {
        open({ id: `doc:${path}`, title: path.split('/').pop() ?? path });
    }, [open]);

    /* Following a link by id rather than by path: an object opens its own page, a beat opens
     * the act it lives in, since a beat has no file of its own. */
    const openRef = useCallback((ref: string) => {
        const index = store.getState().index;
        if (!index) return;
        const id = index.nodes.has(ref)
            ? ref
            : index.order.find((b) => index.nodes.get(b)?.locator === ref);
        const node = id ? index.nodes.get(id) : undefined;
        if (!node) return;
        if (node.kind === 'act') openAct(node.id);
        else if (node.kind === 'beat') openAct(node.id.split('#')[0]!);
        else openDoc(node.path);
    }, [openAct, openDoc]);

    // In a browser there is no folder picker worth the name, so open the demo straight away
    // - a blank grey box teaches nobody anything.
    useEffect(() => {
        if (platform.isDesktop || store.getState().root) return;
        ensureDemo();
        void store.openProject(DEMO_ROOT);
    }, []);

    useEffect(() => {
        const index = state.index;
        if (!index || tabs.length > 0) return;
        const firstAct = [...index.nodes.values()].find((n) => n.kind === 'act');
        if (firstAct) openAct(firstAct.id);
    }, [state.index, tabs.length, openAct]);

    const errors = useMemo(() => state.problems.filter((p) => p.severity === 'error'), [state.problems]);
    const warnings = useMemo(() => state.problems.filter((p) => p.severity === 'warning'), [state.problems]);

    if (!state.root || !state.index || !state.project) {
        return (
            <>
                <UpdateBanner state={updates} />
                <Welcome busy={state.busy} version={updates.version} />
            </>
        );
    }

    const { index, project } = state;
    const activeDoc = active?.startsWith('doc:') ? active.slice(4) : null;
    const activeAct = active?.startsWith('act:') ? active.slice(4) : null;
    const activeTemplate = active?.startsWith('tpl:') ? active.slice(4) : null;
    const activeTable = active?.startsWith('table:') ? active.slice(6) : null;
    const doc = activeDoc ? state.docs.get(activeDoc) : undefined;

    /* Beat edits go through the store's buffer, so the script view, the canvas and any open
     * editor of the same act all move together and one save writes it. */
    const actPath = activeAct ? index.nodes.get(activeAct)?.path : undefined;
    const beatsOfAct = (actId: string): string[] =>
        index.order.filter((id) => id.startsWith(`${actId}#`)).map((id) => id.slice(actId.length + 1));

    const editAct = (fn: (text: string, file: string) => ReturnType<typeof moveBeat>): void => {
        if (actPath) store.applyEdit(actPath, fn);
    };

    /* Schema files go through the same buffered edit as everything else, so a template
     * change shows up in every form and dropdown before it reaches disk. */
    const editTemplate = (id: string, fn: (text: string, file: string) => ReturnType<typeof moveBeat>): void => {
        store.applyEdit(`templates/${id}.yaml`, fn);
    };
    const editRelations = (fn: (text: string, file: string) => ReturnType<typeof moveBeat>): void => {
        store.applyEdit('relations.yaml', fn);
    };

    return (
        <>
            <UpdateBanner state={updates} />
            <div className="app">
                <div className="tabs" role="tablist">
                    {tabs.map((tab) => {
                        const path = tab.id.startsWith('doc:') ? tab.id.slice(4) : null;
                        const dirty = path
                            ? state.docs.get(path)?.buffer !== undefined
                            : state.docs.get(index.nodes.get(tab.id.slice(4))?.path ?? '')?.buffer !== undefined;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                role="tab"
                                className="tab"
                                aria-selected={active === tab.id}
                                onClick={() => setActive(tab.id)}
                            >
                                <span className="tab-title">{tab.title}</span>
                                {dirty && <span className="dot" aria-label="unsaved" />}
                            </button>
                        );
                    })}
                </div>

                <aside className="left">
                    <Explorer
                        index={index}
                        project={project}
                        currentTab={active}
                        onOpenAct={openAct}
                        onOpenDoc={openDoc}
                        onOpenRef={openRef}
                        onOpenTemplate={(id) => open({ id: `tpl:${id}`, title: `${project.templates.get(id)?.label ?? id} template` })}
                        onOpenRelations={() => open({ id: 'relations', title: 'Relations' })}
                        onOpenTable={(type) => open({ id: `table:${type}`, title: `All ${project.templates.get(type)?.label?.toLowerCase() ?? type}` })}
                        onCreateTemplate={(id, label) => {
                            void store.createTemplate(id, label).then(() => {
                                open({ id: `tpl:${id}`, title: `${label} template` });
                            });
                        }}
                    />
                </aside>

                <main className="centre">
                    {activeAct && (
                        <>
                            {/* Its own bar rather than floating over the content: an absolutely
                                positioned switcher lands on top of whatever the view puts in
                                that corner. */}
                            <div className="centre-bar">
                                <div className="view-switch" role="group" aria-label="View">
                                    <button
                                        type="button" aria-pressed={actView === 'script'}
                                        onClick={() => setActView('script')}
                                    >Script</button>
                                    <button
                                        type="button" aria-pressed={actView === 'flow'}
                                        onClick={() => setActView('flow')}
                                    >Flow</button>
                                    <button
                                        type="button" aria-pressed={actView === 'board'}
                                        onClick={() => setActView('board')}
                                    >Board</button>
                                </div>
                            </div>

                            <div className="centre-body">
                            {actView === 'board' ? (
                                <Board
                                    index={index}
                                    project={project}
                                    actId={activeAct}
                                    selected={selected}
                                    onSelect={setSelected}
                                    onSetStatus={(beatId, status) =>
                                        editAct((t, f) => updateBeat(t, beatId, { status }, f))}
                                    onOpenDoc={openDoc}
                                />
                            ) : actView === 'script' ? (
                                <ScriptView
                                    index={index}
                                    project={project}
                                    actId={activeAct}
                                    cursor={cursor}
                                    statusFilter={statusFilter}
                                    selected={selected}
                                    onSetCursor={setCursor}
                                    onSelect={setSelected}
                                    onOpenDoc={openDoc}
                                    onMove={(beatId, delta) => editAct((t, f) => moveBeat(t, beatId, delta, f))}
                                    onAdd={(afterBeatId) => {
                                        const id = nextBeatId(beatsOfAct(activeAct));
                                        editAct((t, f) => addBeat(t, { id, title: 'Untitled beat' }, afterBeatId, f));
                                    }}
                                    onRemove={(beatId) => editAct((t, f) => removeBeat(t, beatId, f))}
                                    onUpdate={(beatId, patch) => editAct((t, f) => updateBeat(t, beatId, patch, f))}
                                />
                            ) : (
                                <GraphView
                                    index={index}
                                    project={project}
                                    actId={activeAct}
                                    cursor={cursor}
                                    statusFilter={statusFilter}
                                    onOpenDoc={openDoc}
                                    onSelectNode={setSelected}
                                />
                            )}
                            </div>
                        </>
                    )}
                    {activeTemplate && project.templates.get(activeTemplate) && (
                        <TemplateEditor
                            project={project}
                            template={project.templates.get(activeTemplate)!}
                            onSetMeta={(patch) => editTemplate(activeTemplate, (t, f) => setTemplateMeta(t, patch, f))}
                            onAddField={(field) => editTemplate(activeTemplate, (t, f) => addTemplateField(t, field, undefined, f))}
                            onUpdateField={(key, patch) => editTemplate(activeTemplate, (t, f) => updateTemplateField(t, key, patch, f))}
                            onMoveField={(key, delta) => editTemplate(activeTemplate, (t, f) => moveTemplateField(t, key, delta, f))}
                            onRemoveField={(key) => editTemplate(activeTemplate, (t, f) => removeTemplateField(t, key, f))}
                            onRemoveSection={(key) => editTemplate(activeTemplate, (t, f) => removeTemplateSection(t, key, f))}
                        />
                    )}
                    {active === 'relations' && (
                        <RelationsEditor
                            project={project}
                            onAdd={(rel) => editRelations((t, f) => addRelation(t, rel, f))}
                            onUpdate={(id, patch) => editRelations((t, f) => updateRelation(t, id, patch, f))}
                            onRemove={(id) => editRelations((t, f) => removeRelation(t, id, f))}
                        />
                    )}
                    {activeTable && (
                        <TableView
                            index={index}
                            project={project}
                            type={activeTable}
                            onOpenDoc={openDoc}
                            onSetField={(path, key, value) =>
                                store.applyEdit(path, (t, f) => setFrontmatterField(t, key, value, f))}
                        />
                    )}
                    {active === 'problems' && (
                        <Problems problems={state.problems} onOpenDoc={openDoc} />
                    )}
                    {activeDoc && doc && (
                        <>
                            <div className="centre-bar">
                                <div className="view-switch" role="group" aria-label="View">
                                    <button
                                        type="button" aria-pressed={docView === 'read'}
                                        onClick={() => setDocView('read')}
                                    >Read</button>
                                    <button
                                        type="button" aria-pressed={docView === 'edit'}
                                        onClick={() => setDocView('edit')}
                                    >Edit</button>
                                </div>
                            </div>
                            <div className="centre-body">
                            {docView === 'read' ? (
                                <Page
                                    index={index}
                                    project={project}
                                    path={activeDoc}
                                    text={doc.buffer ?? doc.text}
                                    onOpenDoc={openDoc}
                                    onOpenRef={openRef}
                                    onCreate={(type, id) => {
                                        void store.createEntity(type, id, humanise(id)).then((path) => {
                                            if (path) openDoc(path);
                                        });
                                    }}
                                />
                            ) : (
                        <Editor
                            path={activeDoc}
                            text={doc.buffer ?? doc.text}
                            dirty={doc.buffer !== undefined}
                            {...(doc.conflict === undefined ? {} : { conflict: doc.conflict })}
                            onChange={(text) => store.setBuffer(activeDoc, text)}
                            onResolve={(keep) => store.resolveConflict(activeDoc, keep)}
                        />
                            )}
                            </div>
                        </>
                    )}
                    {!activeAct && !activeDoc && !activeTemplate && !activeTable && active !== 'problems' && active !== 'relations' && (
                        <p className="empty" style={{ padding: 'var(--s-6)' }}>Nothing open.</p>
                    )}
                </main>

                <aside className="right">
                    {state.notice && <p className="notice" role="alert">{state.notice}</p>}
                    {cursor !== null
                        ? <WorldPanel index={index} project={project} cursor={cursor} onOpenDoc={openDoc} />
                        : <Inspector index={index} project={project} selected={selected} onOpenDoc={openDoc} />}
                </aside>

                <footer className="status">
                    <span>{state.name}</span>
                    {/* A count, not a mood: zero problems says zero, never "looks good". */}
                    <button
                        type="button"
                        className={`link-btn ${errors.length > 0 ? 'count-error' : 'count-ok'}`}
                        onClick={() => open({ id: 'problems', title: 'Problems' })}
                    >
                        {errors.length} {errors.length === 1 ? 'error' : 'errors'}
                        {warnings.length > 0 && <span className="muted"> · {warnings.length} warnings</span>}
                    </button>
                    <span className="muted">{index.nodes.size} nodes · {index.edges.length} links</span>

                    <label className="scrubber">
                        <span className="muted">World at</span>
                        <select
                            value={cursor ?? ''}
                            aria-label="Show the world as of a beat"
                            onChange={(e) => setCursor(e.target.value === '' ? null : e.target.value)}
                        >
                            <option value="">— the start —</option>
                            {index.order.map((id, i) => (
                                <option key={id} value={id}>
                                    {i + 1}. {index.nodes.get(id)?.name ?? id}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className="filter">
                        <span className="muted">Show</span>
                        <select
                            value={statusFilter}
                            aria-label="Show only beats in a given state"
                            onChange={(e) => setStatusFilter(e.target.value)}
                        >
                            <option value="all">everything</option>
                            {project.statuses.map((s) => (
                                <option key={s} value={s}>{s.replace('-', ' ')} only</option>
                            ))}
                        </select>
                    </label>

                    <span className="spacer" />
                    <span className="muted">v{updates.version}</span>
                    <button
                        type="button"
                        className="btn btn-primary"
                        disabled={state.busy}
                        onClick={() => void store.save()}
                    >
                        {state.busy ? 'Saving…' : 'Save and regenerate'}
                    </button>
                </footer>
            </div>
        </>
    );
}

function Welcome({ busy, version }: { busy: boolean; version: string }): React.JSX.Element {
    const [name, setName] = useState('My Game');
    const [warning, setWarning] = useState<{ root: string; alreadyAProject: boolean } | null>(null);

    const scaffoldInto = async (root: string): Promise<void> => {
        setWarning(null);
        await store.createProject(root, name);
    };

    /* A folder holding a package.json or a .git is almost certainly not where anyone meant
     * to put a game project - it is what happens when the picker opens on the app's own
     * directory. Ask rather than refuse: someone may genuinely want notes beside code. */
    const create = async (): Promise<void> => {
        const root = await platform.pickFolder('create');
        if (!root) return;
        const report = await platform.inspectFolder(root);
        if (report.looksLikeCode || report.alreadyAProject) {
            setWarning({ root, alreadyAProject: report.alreadyAProject });
            return;
        }
        await scaffoldInto(root);
    };

    const openExisting = async (): Promise<void> => {
        const root = await platform.pickFolder('open');
        if (root) await store.openProject(root);
    };

    return (
        <div className="welcome">
            <div className="panel-title">
                <span className="eyebrow">Basic {version}</span>
                <h1 className="heading">A game's wiki that writes itself</h1>
            </div>
            <p>
                Choose a folder. Templates describe what a character or an item is; a
                progression document says what becomes true and when; every link between
                them is generated from those two.
            </p>

            {warning ? (
                <div className="notice" role="alert">
                    <p style={{ margin: '0 0 var(--s-3)' }}>
                        {warning.alreadyAProject
                            ? <><strong>That folder is already a Basic project.</strong> Open it instead of creating a new one, or the scaffold will overwrite its templates.</>
                            : <><strong>That folder contains source code.</strong> Scaffolding a game project into it will mix design files in with the code.</>}
                    </p>
                    <code className="rule">{warning.root}</code>
                    <div className="btn-row" style={{ marginTop: 'var(--s-4)' }}>
                        <button type="button" className="btn" onClick={() => setWarning(null)}>
                            Pick a different folder
                        </button>
                        <button type="button" className="btn" onClick={() => void scaffoldInto(warning.root)}>
                            Use it anyway
                        </button>
                    </div>
                </div>
            ) : (
                <>
                    <label className="inspector-field" style={{ width: '100%' }}>
                        <span className="label">Project name</span>
                        <input
                            className="btn"
                            style={{ width: '100%', justifyContent: 'flex-start' }}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </label>
                    <div className="btn-row">
                        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void create()}>
                            New project…
                        </button>
                        <button type="button" className="btn" disabled={busy} onClick={() => void openExisting()}>
                            Open a folder…
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}
