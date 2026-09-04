/* Create the GitHub release BEFORE electron-builder uploads to it.
 *
 * electron-builder publishes its artifacts concurrently, and each publisher creates the
 * release if it does not already exist. When two of them check at the same moment, both
 * find nothing and both create one - leaving two releases sharing a single tag with the
 * assets split between them.
 *
 * That failure is close to invisible: both releases look fine in the API, but
 * /releases/download/<tag>/<file> resolves to only one of them, so whichever assets landed
 * on the other simply 404. A client would then silently fall back to downloading the full
 * installer instead of a delta, or fail to see the update at all.
 *
 * Creating the release first removes the race: both publishers find an existing release and
 * attach to it. It is made as a DRAFT so a half-uploaded release is never visible to an
 * updater - finish-release.mjs publishes it once the assets are all present.
 *
 *   node scripts/ensure-release.mjs [--tag v1.2.3]
 *
 * Idempotent. Safe to run when the release already exists.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OWNER = 'CodeineZA';
const REPO = 'Basic';

const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;

async function gh(path, init = {}) {
    return fetch(`https://api.github.com/repos/${OWNER}/${REPO}${path}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
            ...(init.headers ?? {}),
        },
    });
}

async function main() {
    if (!token) {
        console.error('GH_TOKEN is not set; cannot create the release.');
        console.error('See CLAUDE.md - it is read out of Windows Credential Manager, not pasted.');
        process.exit(1);
    }

    const tagArg = process.argv.indexOf('--tag');
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
    const tag = tagArg === -1 ? `v${pkg.version}` : process.argv[tagArg + 1];

    const existing = await gh(`/releases/tags/${tag}`);
    if (existing.ok) {
        const release = await existing.json();
        console.log(`${tag} already exists (id ${release.id}) with ${release.assets.length} asset(s).`);
        return;
    }

    // A by-tag lookup misses drafts, so search the list too - a rerun after a failed publish
    // must find its own draft rather than creating a second release for the same tag.
    const listed = await gh('/releases?per_page=20');
    if (listed.ok) {
        const draft = (await listed.json()).find((r) => r.tag_name === tag);
        if (draft) {
            console.log(`${tag} already exists as a draft (id ${draft.id}).`);
            return;
        }
    }

    const created = await gh('/releases', {
        method: 'POST',
        body: JSON.stringify({
            tag_name: tag,
            name: tag,
            draft: true,
            prerelease: true,
            body: `Basic ${tag}\n\nWindows installer below. The app updates itself from here.`,
        }),
    });

    if (!created.ok) {
        console.error(`Could not create ${tag}: ${created.status} ${await created.text()}`);
        process.exit(1);
    }
    console.log(`Created ${tag} as a draft (id ${(await created.json()).id}).`);
}

await main();
