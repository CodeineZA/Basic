import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    // Relative, so the packaged build loads from disk without a host.
    base: './',
    server: { port: 5173, strictPort: true },
    build: { outDir: 'dist', sourcemap: true, target: 'chrome126' },
});
