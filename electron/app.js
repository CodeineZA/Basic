/* Window, IPC, the filesystem and updates. Everything else lives in the renderer.
 *
 * The main process deliberately knows nothing about templates, edges or Markdown. It reads
 * bytes, writes bytes atomically, and reports changes. That keeps the whole domain model in
 * one pure, testable place and keeps this file small enough to audit.
 *
 * Security posture: contextIsolation on, sandbox on, nodeIntegration off. Paths arriving
 * from the renderer are resolved and checked against the project root before anything
 * touches them - the renderer is not a trusted source of paths. */

import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import chokidar from 'chokidar';
import electronUpdater from 'electron-updater';

// The bare "electron-log" entry has a `browser` condition and can resolve to the renderer
// build inside a bundler; /main is the unambiguous one for this process.
import log from 'electron-log/main';

const { autoUpdater } = electronUpdater;

const here = dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
const DEV_URL = 'http://localhost:5173';

log.initialize();
log.transports.file.level = 'info';
autoUpdater.logger = log;

/* Hash of the last text WE wrote to each absolute path. A watcher event whose content
 * hashes the same is our own echo. Hash rather than a settling timer: a timer is a guess
 * about scheduler latency, and it is wrong under load. */
const lastWritten = new Map();
const watchers = new Map();

const hash = (text) => createHash('sha1').update(text).digest('hex');

const SKIP = new Set(['.basic', '.git', 'node_modules']);
const DOC = /\.(md|ya?ml|json)$/i;

/* -- serving the renderer -------------------------------------------------- */

/* The app is served from basic://app/ rather than from file://.
 *
 * This is not cosmetic. A file:// page has an OPAQUE origin, and Chromium refuses storage
 * to opaque origins - localStorage throws SecurityError on every call. Basic's browser
 * storage helper catches and falls back by design, so the failure would be completely
 * silent: the app appears to work and simply forgets everything every time it closes.
 *
 * A registered scheme that is `standard` and `secure` gets a real origin, so storage works,
 * and it brings the rest of a secure context with it. It also removes file:// path handling
 * from the equation, which is one fewer way to serve something we did not intend to.
 *
 * This registration MUST happen before the app is ready, hence module scope. */
const SCHEME = 'basic';

protocol.registerSchemesAsPrivileged([{
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);

const rendererRoot = join(here, '..', 'dist-electron', 'renderer');

function serveRenderer() {
    protocol.handle(SCHEME, async (request) => {
        const { pathname } = new URL(request.url);
        const target = normalize(join(rendererRoot, decodeURIComponent(pathname)));

        // Nothing outside the renderer directory is servable, whatever the URL claims.
        // Without this, "basic://app/../../../../secrets" is a file read.
        if (!target.startsWith(normalize(rendererRoot))) {
            log.warn(`protocol: blocked a path escaping the renderer root: ${request.url}`);
            return new Response('Not found', { status: 404 });
        }

        try {
            return await net.fetch(pathToFileURL(target).toString());
        } catch (err) {
            log.error(`protocol: could not serve ${target}: ${err}`);
            return new Response('Not found', { status: 404 });
        }
    });
}

/* -- filesystem ------------------------------------------------------------ */

/** Resolve a project-relative path, refusing anything that escapes the root. */
function safeJoin(root, relPath) {
    const rootAbs = resolve(root);
    const target = resolve(rootAbs, relPath);
    const rel = relative(rootAbs, target);
    // On Windows a different drive makes relative() return an absolute path,
    // which would sail past the '..' check - hence the second test.
    if (rel.startsWith('..') || resolve(rel) === rel) {
        throw new Error(`path escapes the project: ${relPath}`);
    }
    return target;
}

async function listFiles(root, sub = '') {
    const out = [];
    const entries = await readdir(join(root, sub), { withFileTypes: true });
    for (const entry of entries) {
        if (SKIP.has(entry.name)) continue;
        const rel = sub ? `${sub}/${entry.name}` : entry.name;
        if (entry.isDirectory()) out.push(...await listFiles(root, rel));
        else if (DOC.test(entry.name)) out.push(rel);
    }
    return out;
}

/** Temp file then rename, so a crash mid-write cannot truncate a real page. */
async function atomicWrite(absolute, text) {
    await mkdir(dirname(absolute), { recursive: true });
    const tmp = `${absolute}.basic-tmp`;
    await writeFile(tmp, text, 'utf8');
    await rename(tmp, absolute);
    lastWritten.set(absolute, hash(text));
}

/* -- updates --------------------------------------------------------------- */

/* One object describing where the updater is, pushed to the renderer whenever it moves.
 * The renderer renders that object; it never infers state from a sequence of events. */
let updateState = { status: 'idle', version: app.getVersion() };

function setUpdateState(patch) {
    updateState = { ...updateState, ...patch, version: app.getVersion() };
    for (const w of BrowserWindow.getAllWindows()) {
        w.webContents.send('basic:update.changed', updateState);
    }
}

function startUpdater() {
    if (isDev) {
        // electron-updater throws without a packaged app-update.yml, and a dev build has
        // nothing meaningful to update to anyway.
        setUpdateState({ status: 'disabled', reason: 'development build' });
        return;
    }

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    // Releases are published as pre-release, so without this the feed looks empty.
    autoUpdater.allowPrerelease = true;

    autoUpdater.on('checking-for-update', () => setUpdateState({ status: 'checking' }));
    autoUpdater.on('update-not-available', () => setUpdateState({ status: 'current' }));
    autoUpdater.on('update-available', (info) => {
        setUpdateState({ status: 'downloading', available: info.version, percent: 0 });
    });
    autoUpdater.on('download-progress', (p) => {
        setUpdateState({ status: 'downloading', percent: Math.round(p.percent) });
    });
    autoUpdater.on('update-downloaded', (info) => {
        setUpdateState({ status: 'ready', available: info.version });
    });
    autoUpdater.on('error', (err) => {
        log.error(`updater: ${err}`);
        setUpdateState({ status: 'error', message: String(err?.message ?? err) });
    });

    autoUpdater.checkForUpdates().catch((err) => log.error(`updater: check threw ${err}`));
}

/* -- the window ------------------------------------------------------------ */

function createWindow() {
    const win = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 900,
        minHeight: 600,
        backgroundColor: '#14161a',
        title: 'Basic',
        webPreferences: {
            preload: join(here, 'preload.cjs'),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            webviewTag: false,
        },
    });

    // setWindowOpenHandler lives on webContents, not on the window.
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url);
        return { action: 'deny' };
    });

    /* The renderer only ever needs its own origin. Anything else - a stray link, a redirect
     * - opens in the real browser rather than replacing the app. */
    win.webContents.on('will-navigate', (event, url) => {
        const allowed = isDev ? url.startsWith(DEV_URL) : url.startsWith(`${SCHEME}://`);
        if (allowed) return;
        event.preventDefault();
        if (url.startsWith('http')) shell.openExternal(url);
    });

    /* A renderer that fails to load otherwise shows a blank window and says nothing, which
     * is a miserable thing to debug. */
    win.webContents.on('did-finish-load', () => {
        log.info(`renderer loaded: ${win.webContents.getURL()}`);
        win.webContents.send('basic:update.changed', updateState);
    });
    win.webContents.on('did-fail-load', (_e, code, description, url) => {
        log.error(`renderer FAILED to load (${code} ${description}): ${url}`);
    });

    if (isDev) win.loadURL(DEV_URL);
    else win.loadURL(`${SCHEME}://app/index.html`);

    return win;
}

/* -- IPC ------------------------------------------------------------------- */

ipcMain.handle('basic:app.info', () => ({
    packaged: app.isPackaged,
    version: app.getVersion(),
}));

ipcMain.handle('basic:app.openLogFolder', () => {
    shell.showItemInFolder(log.transports.file.getFile().path);
    return true;
});

ipcMain.handle('basic:update.state', () => updateState);

ipcMain.handle('basic:update.checkNow', () => {
    if (isDev) return updateState;
    return autoUpdater.checkForUpdates()
        .then(() => updateState)
        .catch((err) => {
            setUpdateState({ status: 'error', message: String(err?.message ?? err) });
            return updateState;
        });
});

ipcMain.handle('basic:update.install', () => {
    if (updateState.status !== 'ready') return false;
    autoUpdater.quitAndInstall(true, true);
    return true;
});

ipcMain.handle('basic:project.pickFolder', async (_e, mode) => {
    const result = await dialog.showOpenDialog({
        title: mode === 'create' ? 'Choose a folder for the new project' : 'Open a project folder',
        properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
});

/* A folder that already holds source code is almost certainly not where someone meant to
 * put a game project - it is what happens when the picker opens on the app's own directory,
 * which has already happened once here. Report it and let the renderer ask; refusing
 * outright would be wrong, since someone may genuinely want design notes beside code. */
ipcMain.handle('basic:project.inspect', async (_e, root) => {
    const exists = async (name) => stat(join(resolve(root), name)).then(() => true, () => false);
    const [pkg, git, project] = await Promise.all([
        exists('package.json'), exists('.git'), exists('basic.json'),
    ]);
    return { looksLikeCode: pkg || git, alreadyAProject: project };
});

ipcMain.handle('basic:project.scaffold', async (_e, { root, files }) => {
    for (const file of files) await atomicWrite(safeJoin(root, file.path), file.text);
    return true;
});

ipcMain.handle('basic:fs.list', (_e, root) => listFiles(resolve(root)));

ipcMain.handle('basic:fs.read', async (_e, { root, path }) => {
    try {
        return await readFile(safeJoin(root, path), 'utf8');
    } catch {
        return null;
    }
});

ipcMain.handle('basic:fs.write', async (_e, { root, path, text }) => {
    await atomicWrite(safeJoin(root, path), text);
    return true;
});

/* A batch is computed in full by the renderer, then written here. If one write fails the
 * caller is told exactly which ones landed - a half-updated project the user does not know
 * about is the worst outcome available. */
ipcMain.handle('basic:fs.writeAll', async (_e, { root, edits }) => {
    const written = [];
    for (const edit of edits) {
        try {
            await atomicWrite(safeJoin(root, edit.path), edit.text);
            written.push(edit.path);
        } catch (err) {
            return { ok: false, written, failed: edit.path, message: String(err?.message ?? err) };
        }
    }
    return { ok: true, written };
});

ipcMain.handle('basic:fs.watch', (event, root) => {
    const key = resolve(root);
    if (watchers.has(key)) return true;

    const watcher = chokidar.watch(key, {
        ignoreInitial: true,
        ignored: (p) => p.split(sep).some((part) => SKIP.has(part)) || p.endsWith('.basic-tmp'),
    });

    const report = async (absolute, kind) => {
        const path = relative(key, absolute).split(sep).join('/');
        if (!DOC.test(path)) return;
        if (kind === 'unlink') {
            lastWritten.delete(absolute);
            event.sender.send('basic:fs.changed', { kind, path });
            return;
        }
        const text = await readFile(absolute, 'utf8').catch(() => null);
        if (text === null) return;
        if (lastWritten.get(absolute) === hash(text)) return; // our own echo
        event.sender.send('basic:fs.changed', { kind, path, text });
    };

    watcher.on('add', (p) => report(p, 'add'));
    watcher.on('change', (p) => report(p, 'change'));
    watcher.on('unlink', (p) => report(p, 'unlink'));
    watchers.set(key, watcher);
    return true;
});

ipcMain.handle('basic:fs.unwatch', async (_e, root) => {
    const key = resolve(root);
    await watchers.get(key)?.close();
    watchers.delete(key);
    return true;
});

/* -- lifecycle ------------------------------------------------------------- */

/* NOT `await app.whenReady()` at the top level.
 *
 * Electron dispatches 'ready' only once the main entry has finished evaluating. main.js
 * awaits this module, so a top-level await on whenReady() here means evaluation waits for
 * ready and ready waits for evaluation - the app comes up with no window, no error and no
 * log, forever. Attach a callback instead and let the module finish. */
app.whenReady().then(() => {
    log.info(`starting Basic ${app.getVersion()}, dev=${isDev}`);
    if (!isDev) serveRenderer();
    createWindow();
    startUpdater();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
