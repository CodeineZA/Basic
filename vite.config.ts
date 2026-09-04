import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/* Two build targets from one source tree.
 *
 *   browser  - runs against the in-memory project adapter, which is what makes
 *              the whole UI verifiable under Vite with nothing packaged
 *   desktop  - the Electron shell, talking to the real filesystem over IPC
 *
 * The target is a build-time constant rather than a runtime check, so the
 * browser bundle does not carry desktop-only code and vice versa.
 *
 * Selected with vite's own `--mode` rather than an environment variable:
 * `BASIC_TARGET=desktop npm run build` is not a thing that works here, because
 * npm runs scripts through cmd, which has no inline environment prefix. */
export default defineConfig(({ mode }) => {
    const target = process.env['BASIC_TARGET'] ?? (mode === 'desktop' ? 'desktop' : 'browser');

    return {
        plugins: [react()],
        // Relative, so the packaged build loads from basic://app/ without a host.
        base: './',
        define: {
            __BASIC_TARGET__: JSON.stringify(target),
            __BASIC_VERSION__: JSON.stringify(process.env['npm_package_version'] ?? '0.0.0'),
        },
        build: {
            outDir: target === 'desktop' ? 'dist-electron/renderer' : 'dist',
            emptyOutDir: true,
            target: 'chrome126',
            sourcemap: true,
        },
        server: {
            port: 5173,
            strictPort: true,
            /* Do not watch the build outputs.
             *
             * electron-builder extracts ~200 MB of Electron into release/ and then RENAMES
             * the directory. A watcher with handles open in there makes that rename fail
             * with EPERM, and the packaging error says nothing about a dev server. */
            watch: { ignored: ['**/release/**', '**/dist-electron/**', '**/dist/**', '**/build/**'] },
        },
    };
});
