/* Make the draft release visible - only once it is WHOLE.
 *
 * ensure-release.mjs creates the release as a draft; electron-builder attaches its assets to
 * it; this flips draft to published. The check between those is the point: the installer,
 * its blockmap and latest.yml must all be present and 'uploaded', or the flip is refused and
 * the release stays invisible to every updater.
 *
 * A missing asset here is a failed build to fix, never something to ship around. An updater
 * pointed at a release with no latest.yml reports an error to every user forever.
 *
 *   node scripts/finish-release.mjs
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
        console.error('GH_TOKEN is not set; cannot publish the release.');
        process.exit(1);
    }

    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
    const tag = `v${pkg.version}`;

    // Drafts are invisible to the by-tag endpoint; list and find.
    const listed = await gh('/releases?per_page=20');
    if (!listed.ok) {
        console.error(`Could not list releases: ${listed.status}`);
        process.exit(1);
    }
    const release = (await listed.json()).find((r) => r.tag_name === tag);
    if (!release) {
        console.error(`No release found for ${tag}.`);
        process.exit(1);
    }

    const names = release.assets.map((a) => a.name);
    const setup = names.find((n) => /^Basic-Setup-.*\.exe$/.test(n));
    const required = [
        ['installer', setup],
        ['blockmap', names.find((n) => n.endsWith('.exe.blockmap'))],
        ['update feed', names.find((n) => n === 'latest.yml')],
    ];

    const missing = required.filter(([, found]) => !found).map(([what]) => what);
    if (missing.length > 0) {
        console.error(`${tag} is incomplete - missing: ${missing.join(', ')}`);
        console.error(`Assets present: ${names.join(', ') || '(none)'}`);
        console.error('Refusing to publish. Fix the build and re-run the release.');
        process.exit(1);
    }

    const unfinished = release.assets.filter((a) => a.state !== 'uploaded').map((a) => a.name);
    if (unfinished.length > 0) {
        console.error(`Still uploading: ${unfinished.join(', ')}. Refusing to publish.`);
        process.exit(1);
    }

    if (!release.draft) {
        console.log(`${tag} is already published.`);
        return;
    }

    const updated = await gh(`/releases/${release.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ draft: false, prerelease: true }),
    });
    if (!updated.ok) {
        console.error(`Could not publish ${tag}: ${updated.status} ${await updated.text()}`);
        process.exit(1);
    }

    console.log(`Published ${tag} with ${release.assets.length} assets:`);
    for (const name of names) console.log(`  ${name}`);
    console.log(`\n${(await updated.json()).html_url}`);
}

await main();
