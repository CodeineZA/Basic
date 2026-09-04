/* Thin bootstrap.
 *
 * The crash handlers are installed before anything else is loaded, and the real
 * app is brought in with a DYNAMIC import - a static one would be hoisted above
 * these handlers and a failure during module evaluation would vanish with no
 * window and no log. */

import { app } from 'electron';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const crashLog = join(tmpdir(), 'basic', 'startup-crash.log');

function record(kind, err) {
    try {
        mkdirSync(join(tmpdir(), 'basic'), { recursive: true });
        appendFileSync(crashLog, `\n[${new Date().toISOString()}] ${kind}\n${err?.stack ?? err}\n`);
    } catch {
        // Nothing useful left to do if even the log fails.
    }
}

process.on('uncaughtException', (err) => { record('uncaughtException', err); app?.quit(); });
process.on('unhandledRejection', (err) => { record('unhandledRejection', err); });

await import('./app.js');
