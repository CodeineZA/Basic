/* The only bridge between the page and the machine.
 *
 * CommonJS because a sandboxed preload cannot be an ES module. The renderer
 * gets one frozen namespace and never sees ipcRenderer, so the page cannot
 * reach a channel that was not deliberately exposed here. */

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('basicNative', Object.freeze({
    project: Object.freeze({
        pickFolder: (mode) => invoke('basic:project.pickFolder', mode),
        scaffold: (root, files) => invoke('basic:project.scaffold', { root, files }),
    }),

    fs: Object.freeze({
        list: (root) => invoke('basic:fs.list', root),
        read: (root, path) => invoke('basic:fs.read', { root, path }),
        write: (root, path, text) => invoke('basic:fs.write', { root, path, text }),
        writeAll: (root, edits) => invoke('basic:fs.writeAll', { root, edits }),
    }),

    /* Push channel. The Electron event object is stripped before anything
     * reaches the page, and the caller gets an unsubscribe back rather than
     * having to remember the channel name. */
    watch: (root, onChange) => {
        const listener = (_event, change) => onChange(change);
        ipcRenderer.on('basic:fs.changed', listener);
        invoke('basic:fs.watch', root);
        return () => {
            ipcRenderer.off('basic:fs.changed', listener);
            invoke('basic:fs.unwatch', root);
        };
    },

    app: Object.freeze({
        info: () => invoke('basic:app.info'),
    }),
}));
