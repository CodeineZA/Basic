/* Installer artwork and the application icon.
 *
 * Generated rather than committed as opaque binaries, so the art can be changed by editing
 * numbers instead of opening an image editor, and a palette change is one line rather than
 * a re-export.
 *
 * NSIS is fussy about its bitmaps: 24-bit, uncompressed, bottom-up, rows padded to a
 * four-byte boundary. Anything else renders as nothing, silently, which is a miserable
 * thing to debug.
 *
 *   node scripts/make-installer-art.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'build');

/* The palette, matching src/styles/tokens.css. */
const ACCENT = [0x4a, 0x6f, 0x8a];
const INK = [0x14, 0x16, 0x1a];
const PAPER = [0xf4, 0xf2, 0xee];
const PANEL = [0x1b, 0x1e, 0x23];

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

/* -- the mark --------------------------------------------------------------
 *
 * Two nodes and the line between them. The whole app is about things being linked, and at
 * 16px a "B" glyph turns to mush while two dots and a stroke still read as something. */

const NODE_A = { x: 0.32, y: 0.31, r: 0.135 };
const NODE_B = { x: 0.68, y: 0.69, r: 0.135 };
const EDGE_W = 0.052;

/** Signed coverage of the mark at a point, 0 outside, 1 inside. Supersampled by the caller. */
function markAt(x, y) {
    const inCircle = (c) => Math.hypot(x - c.x, y - c.y) <= c.r;
    if (inCircle(NODE_A) || inCircle(NODE_B)) return true;

    // Distance from the segment A-B.
    const dx = NODE_B.x - NODE_A.x;
    const dy = NODE_B.y - NODE_A.y;
    const t = clamp01(((x - NODE_A.x) * dx + (y - NODE_A.y) * dy) / (dx * dx + dy * dy));
    const px = NODE_A.x + t * dx;
    const py = NODE_A.y + t * dy;
    return Math.hypot(x - px, y - py) <= EDGE_W / 2;
}

/** Rounded-square coverage, so the icon does not look like a sticker. */
function plaqueAt(x, y, radius = 0.19) {
    const cx = Math.abs(x - 0.5);
    const cy = Math.abs(y - 0.5);
    const half = 0.5 - radius;
    if (cx <= half || cy <= half) return cx <= 0.5 && cy <= 0.5;
    return Math.hypot(cx - half, cy - half) <= radius;
}

const SAMPLES = 4;

/** Coverage of a predicate over one pixel, sampled on a 4x4 grid. */
function coverage(px, py, size, predicate) {
    let hits = 0;
    for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
            const x = (px + (sx + 0.5) / SAMPLES) / size;
            const y = (py + (sy + 0.5) / SAMPLES) / size;
            if (predicate(x, y)) hits++;
        }
    }
    return hits / (SAMPLES * SAMPLES);
}

/* -- BMP ------------------------------------------------------------------- */

/** Write a 24-bit uncompressed BMP. `pixel(x, y)` returns [r, g, b]. */
function writeBmp(path, width, height, pixel) {
    const rowBytes = width * 3;
    const padding = (4 - (rowBytes % 4)) % 4;
    const stride = rowBytes + padding;
    const pixels = Buffer.alloc(stride * height);

    for (let y = 0; y < height; y++) {
        const row = (height - 1 - y) * stride; // BMP rows run bottom-up
        for (let x = 0; x < width; x++) {
            const [r, g, b] = pixel(x, y);
            const at = row + x * 3;
            pixels[at] = Math.round(b); // BGR, not RGB
            pixels[at + 1] = Math.round(g);
            pixels[at + 2] = Math.round(r);
        }
    }

    const header = Buffer.alloc(54);
    header.write('BM', 0, 'ascii');
    header.writeUInt32LE(54 + pixels.length, 2);
    header.writeUInt32LE(54, 10);
    header.writeUInt32LE(40, 14);
    header.writeInt32LE(width, 18);
    header.writeInt32LE(height, 22);
    header.writeUInt16LE(1, 26);
    header.writeUInt16LE(24, 28);
    header.writeUInt32LE(pixels.length, 34);

    writeFileSync(path, Buffer.concat([header, pixels]));
    console.log(`  ${path.split(/[\\/]/).pop()}  ${width}x${height}`);
}

/* -- ICO ------------------------------------------------------------------- */

/* An .ico is a directory of DIB images. Each entry carries a BITMAPINFOHEADER whose height
 * is DOUBLE the real height, because the format expects a colour bitmap followed by a 1-bit
 * AND mask. We write 32-bit BGRA and a zeroed mask - the alpha channel does the work, but
 * the mask must still be present and correctly sized or the icon is rejected. */
function icoImage(size) {
    const stride = size * 4;
    const xor = Buffer.alloc(stride * size);

    for (let y = 0; y < size; y++) {
        const row = (size - 1 - y) * stride; // bottom-up
        for (let x = 0; x < size; x++) {
            const plaque = coverage(x, y, size, plaqueAt);
            const mark = coverage(x, y, size, markAt);
            const [r, g, b] = mix(ACCENT, PAPER, mark);
            const at = row + x * 4;
            xor[at] = Math.round(b);
            xor[at + 1] = Math.round(g);
            xor[at + 2] = Math.round(r);
            xor[at + 3] = Math.round(plaque * 255);
        }
    }

    // 1bpp AND mask, rows padded to four bytes. Left zeroed: alpha is authoritative.
    const maskStride = Math.ceil(size / 32) * 4;
    const and = Buffer.alloc(maskStride * size);

    const header = Buffer.alloc(40);
    header.writeUInt32LE(40, 0);
    header.writeInt32LE(size, 4);
    header.writeInt32LE(size * 2, 8); // colour bitmap + mask
    header.writeUInt16LE(1, 12);
    header.writeUInt16LE(32, 14);
    header.writeUInt32LE(xor.length + and.length, 20);

    return Buffer.concat([header, xor, and]);
}

function writeIco(path, sizes) {
    const images = sizes.map(icoImage);

    const dir = Buffer.alloc(6 + sizes.length * 16);
    dir.writeUInt16LE(0, 0);
    dir.writeUInt16LE(1, 2); // 1 = icon
    dir.writeUInt16LE(sizes.length, 4);

    let offset = dir.length;
    sizes.forEach((size, i) => {
        const at = 6 + i * 16;
        dir.writeUInt8(size >= 256 ? 0 : size, at);      // 0 means 256
        dir.writeUInt8(size >= 256 ? 0 : size, at + 1);
        dir.writeUInt8(0, at + 2);
        dir.writeUInt8(0, at + 3);
        dir.writeUInt16LE(1, at + 4);
        dir.writeUInt16LE(32, at + 6);
        dir.writeUInt32LE(images[i].length, at + 8);
        dir.writeUInt32LE(offset, at + 12);
        offset += images[i].length;
    });

    writeFileSync(path, Buffer.concat([dir, ...images]));
    console.log(`  ${path.split(/[\\/]/).pop()}  ${sizes.join(', ')}`);
}

/* -- the pieces ------------------------------------------------------------ */

/** Draw the mark into a rectangle of arbitrary aspect, centred in a square box of `box` px. */
function markPixel(x, y, box, originX, originY, background) {
    const localX = (x - originX) / box;
    const localY = (y - originY) / box;
    if (localX < 0 || localX > 1 || localY < 0 || localY > 1) return background;

    let hits = 0;
    for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
            const sxx = localX + (sx + 0.5) / (SAMPLES * box);
            const syy = localY + (sy + 0.5) / (SAMPLES * box);
            if (markAt(sxx, syy)) hits++;
        }
    }
    return mix(background, PAPER, hits / (SAMPLES * SAMPLES));
}

function main() {
    mkdirSync(OUT, { recursive: true });
    console.log('Writing installer art into build/');

    writeIco(join(OUT, 'icon.ico'), [16, 24, 32, 48, 64, 128, 256]);

    // 150x57 header strip. The mark sits right, where NSIS leaves room.
    writeBmp(join(OUT, 'installerHeader.bmp'), 150, 57, (x, y) => {
        const base = mix(PANEL, INK, y / 57);
        return markPixel(x, y, 38, 150 - 47, 10, base);
    });

    // 164x314 sidebar, used by both the installer and the uninstaller.
    const sidebar = (x, y) => {
        const t = clamp01((x / 164) * 0.35 + (y / 314) * 0.65);
        const base = mix(mix(ACCENT, INK, 0.55), INK, t);
        return markPixel(x, y, 84, 40, 60, base);
    };
    writeBmp(join(OUT, 'installerSidebar.bmp'), 164, 314, sidebar);
    writeBmp(join(OUT, 'uninstallerSidebar.bmp'), 164, 314, sidebar);

    console.log('Done.');
}

main();
