/* The shell: tabs across the top, explorer left, workspace centre, palette or
 * inspector right, status along the bottom.
 *
 * Canvases and documents are both just tabs, because a canvas that refers to
 * another canvas and a page that links to another page are the same idea. */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createStore } from '../state/store.ts';
import { DEMO_ROOT, ensureDemo, platform } from '../platform/index.ts';
import { GraphView } from './canvas/graph.tsx';
import { Editor } from './wiki/editor.tsx';
import { Explorer } from './explorer/explorer.tsx';
import { Inspector } from './inspector/inspector.tsx';

const store = createStore();

interface Tab { id: string; title: string; }

export function App(): React.JSX.Element {
    const state = useSyncExternalStore(store.subscribe, store.getState);
    const [tabs, setTabs] = useState<Tab[]>([]);
    const [active, setActive] = useState<string | null>(null);
    const [selected, setSelected] = useState<string | null>(null);

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

    // In a browser there is no folder picker worth the name, so open the demo
    // straight away - a blank grey box teaches nobody anything.
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

    if (!state.root || !state.index || !state.project) {
        return <Welcome busy={state.busy} />;
    }

    const { index, project } = state;
    const activeDoc = active?.startsWith('doc:') ? active.slice(4) : null;
    const activeAct = active?.startsWith('act:') ? active.slice(4) : null;
    const doc = activeDoc ? state.docs.get(activeDoc) : undefined;

    return (
        <div className="app">
            <div className="tabs" role="tablist">
                {tabs.map((tab) => {
                    const path = tab.id.startsWith('doc:') ? tab.id.slice(4) : null;
                    const dirty = path ? state.docs.get(path)?.buffer !== undefined : false;
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
                />
            </aside>

            <main className="centre">
                {activeAct && (
                    <GraphView
                        index={index}
                        project={project}
                        actId={activeAct}
                        onOpenDoc={openDoc}
                        onSelectNode={setSelected}
                    />
                )}
                {activeDoc && doc && (
                    <Editor
                        path={activeDoc}
                        text={doc.buffer ?? doc.text}
                        dirty={doc.buffer !== undefined}
                        {...(doc.conflict === undefined ? {} : { conflict: doc.conflict })}
                        onChange={(text) => store.setBuffer(activeDoc, text)}
                        onResolve={(keep) => store.resolveConflict(activeDoc, keep)}
                    />
                )}
                {!activeAct && !activeDoc && <p className="empty" style={{ padding: 'var(--s-6)' }}>Nothing open.</p>}
            </main>

            <aside className="right">
                {state.notice && <p className="notice" role="alert">{state.notice}</p>}
                <Inspector index={index} project={project} selected={selected} onOpenDoc={openDoc} />
            </aside>

            <footer className="status">
                <span>{state.name}</span>
                {/* A count, not a mood: zero problems says zero, never "looks good". */}
                <span className={errors.length > 0 ? 'count-error' : 'count-ok'}>
                    {errors.length} {errors.length === 1 ? 'problem' : 'problems'}
                </span>
                <span className="muted">{index.nodes.size} nodes · {index.edges.length} links</span>
                <span className="spacer" />
                <button type="button" className="btn btn-primary" disabled={state.busy} onClick={() => void store.save()}>
                    {state.busy ? 'Saving…' : 'Save and regenerate'}
                </button>
            </footer>
        </div>
    );
}

function Welcome({ busy }: { busy: boolean }): React.JSX.Element {
    const [name, setName] = useState('My Game');

    const create = async (): Promise<void> => {
        const root = await platform.pickFolder('create');
        if (root) await store.createProject(root, name);
    };

    const openExisting = async (): Promise<void> => {
        const root = await platform.pickFolder('open');
        if (root) await store.openProject(root);
    };

    return (
        <div className="welcome">
            <div className="panel-title">
                <span className="eyebrow">Basic</span>
                <h1 className="heading">A game's wiki that writes itself</h1>
            </div>
            <p>
                Choose a folder. Templates describe what a character or an item is; a
                progression document says what becomes true and when; every link between
                them is generated from those two.
            </p>
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
        </div>
    );
}
