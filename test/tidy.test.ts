/* Layout and framing are pure maths, so they get tested without a browser.
 *
 * These exist because the first attempt handed framing to the renderer's own
 * fitView and spent a long time rendering a five-card graph at 26% zoom. Doing
 * the arithmetic here means it can be checked rather than eyeballed. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { boundsOf, NODE_W, pushBelow, tidy, viewportFor, type Placed } from '../src/ui/canvas/tidy.ts';

const box = (id: string, height = 60) => ({ id, width: NODE_W, height });

test('a chain is laid out left to right with real space between ranks', () => {
    const placed = tidy(
        [box('a'), box('b'), box('c')],
        [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }],
    );
    const [a, b, c] = ['a', 'b', 'c'].map((id) => placed.get(id)!) as [Placed, Placed, Placed];
    assert.ok(b.x > a.x + NODE_W, 'b starts after a ends');
    assert.ok(c.x > b.x + NODE_W, 'c starts after b ends');
    // No two cards may touch: the gap is the whole point of tidying.
    assert.ok(b.x - (a.x + NODE_W) >= 80, `gap was ${b.x - (a.x + NODE_W)}`);
});

test('positions snap to the grid', () => {
    const placed = tidy([box('a'), box('b')], [{ from: 'a', to: 'b' }]);
    for (const p of placed.values()) {
        assert.equal(p.x % 16, 0, `x ${p.x} is off-grid`);
        assert.equal(p.y % 16, 0, `y ${p.y} is off-grid`);
    }
});

test('an edge naming a node that is not on the canvas does not throw', () => {
    const placed = tidy([box('a')], [{ from: 'a', to: 'ghost' }]);
    assert.equal(placed.size, 1);
});

test('bounds cover every card, including its width and height', () => {
    const placed = new Map([
        ['a', { id: 'a', x: 0, y: 0 }],
        ['b', { id: 'b', x: 400, y: 200 }],
    ]);
    const sizes = new Map([
        ['a', { width: 240, height: 60 }],
        ['b', { width: 240, height: 100 }],
    ]);
    assert.deepEqual(boundsOf(placed, sizes), { minX: 0, minY: 0, maxX: 640, maxY: 300 });
});

test('bounds of an empty canvas are nothing, not a zero-sized box', () => {
    assert.equal(boundsOf(new Map(), new Map()), null);
});

test('the viewport centres the graph and scales it to fit', () => {
    const bounds = { minX: 0, minY: 0, maxX: 1000, maxY: 400 };
    const vp = viewportFor(bounds, { width: 740, height: 646 });

    // Width is the binding constraint: 740/1000 * 0.88.
    assert.ok(Math.abs(vp.zoom - 0.6512) < 0.001, `zoom was ${vp.zoom}`);

    // The graph's centre lands on the pane's centre.
    assert.ok(Math.abs((vp.x + 500 * vp.zoom) - 370) < 0.5);
    assert.ok(Math.abs((vp.y + 200 * vp.zoom) - 323) < 0.5);
});

test('every corner of the graph lands inside the pane', () => {
    const bounds = { minX: 48, minY: 48, maxX: 1056, maxY: 470 };
    const pane = { width: 740, height: 646 };
    const vp = viewportFor(bounds, pane);
    const toScreen = (x: number, y: number) => ({ x: x * vp.zoom + vp.x, y: y * vp.zoom + vp.y });

    const corners: Array<[number, number]> = [
        [bounds.minX, bounds.minY],
        [bounds.maxX, bounds.maxY],
    ];
    for (const [x, y] of corners) {
        const p = toScreen(x, y);
        assert.ok(p.x >= 0 && p.x <= pane.width, `x ${p.x} outside 0..${pane.width}`);
        assert.ok(p.y >= 0 && p.y <= pane.height, `y ${p.y} outside 0..${pane.height}`);
    }
});

test('a tiny graph is not magnified past its natural size', () => {
    const vp = viewportFor({ minX: 0, minY: 0, maxX: 240, maxY: 60 }, { width: 1400, height: 900 });
    assert.equal(vp.zoom, 1, 'one small card should not fill the screen');
});

test('a huge graph is not shrunk past the point of legibility', () => {
    const vp = viewportFor({ minX: 0, minY: 0, maxX: 40000, maxY: 20000 }, { width: 740, height: 646 });
    assert.equal(vp.zoom, 0.2);
});

test('expanding a card pushes down only the cards in its column', () => {
    const placed = new Map([
        ['open', { id: 'open', x: 0, y: 0 }],
        ['below', { id: 'below', x: 0, y: 200 }],
        ['beside', { id: 'beside', x: 400, y: 200 }],
        ['above', { id: 'above', x: 0, y: -200 }],
    ]);
    const sizes = new Map([...placed.keys()].map((id) => [id, { width: 240, height: 60 }]));
    const after = pushBelow(placed, sizes, 'open', 120);

    assert.equal(after.get('below')!.y, 320, 'the card underneath moves');
    assert.equal(after.get('beside')!.y, 200, 'a different column must not move');
    assert.equal(after.get('above')!.y, -200, 'cards above must not move');
    assert.equal(after.get('open')!.y, 0, 'the expanded card stays put');
});

test('collapsing restores the layout exactly, because the shift is derived', () => {
    const placed = new Map([
        ['open', { id: 'open', x: 0, y: 0 }],
        ['below', { id: 'below', x: 0, y: 200 }],
    ]);
    const sizes = new Map([...placed.keys()].map((id) => [id, { width: 240, height: 60 }]));
    assert.deepEqual(pushBelow(placed, sizes, 'open', 0), placed);
});
