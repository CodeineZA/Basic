/* The only bridge between the page and the machine.
 *
 * CommonJS because a sandboxed preload cannot be an ES module. The renderer gets one frozen
 * namespace and never sees ipcRenderer, so the page cannot reach a channel that was not
 * deliberately exposed here. Subscription helpers return an unsubscribe function, and the
 * Electron event object is stripped before any payload reaches the page. */

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

/** Subscribe to a push channel, handing back the unsubscribe rather than a channel name. */
function subscribe(channel, onMessage) {
    const listener = (_event, payload) => onMessage(payload);
    ipcRenderer.on(channel, listener);
    return () => { ipcRenderer.off(channel, listener); };
}

contextBridge.exposeInMainWorld('basicNative', Object.freeze({
    project: Object.freeze({
        pickFolder: (mode) => invoke('basic:project.pickFolder', mode),
        inspect: (root) => invoke('basic:project.inspect', root),
        scaffold: (root, files) => invoke('basic:project.scaffold', { root, files }),
    }),

    fs: Object.freeze({
        list: (root) => invoke('basic:fs.list', root),
        read: (root, path) => invoke('basic:fs.read', { root, path }),
        write: (root, path, text) => invoke('basic:fs.write', { root, path, text }),
        writeAll: (root, edits) => invoke('basic:fs.writeAll', { root, edits }),
    }),

    watch: (root, onChange) => {
        const off = subscribe('basic:fs.changed', onChange);
        invoke('basic:fs.watch', root);
        return () => {
            off();
            invoke('basic:fs.unwatch', root);
        };
    },

    updates: Object.freeze({
        state: () => invoke('basic:update.state'),
        checkNow: () => invoke('basic:update.checkNow'),
        install: () => invoke('basic:update.install'),
        subscribe: (onChange) => subscribe('basic:update.changed', onChange),
    }),

    app: Object.freeze({
        info: () => invoke('basic:app.info'),
        openLogFolder: () => invoke('basic:app.openLogFolder'),
    }),
}));
