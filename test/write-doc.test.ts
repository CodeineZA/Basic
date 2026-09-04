import test from 'node:test';
import assert from 'node:assert/strict';
import { applyBlocks, findBlocks, renderBlock } from '../src/core/write-doc.ts';

const page = (extra = '') => `---
id: igor
type: character
---

Igor turns up uninvited and hands over an axe.

<!-- basic:availability -->
- Given by [[igor]]
<!-- /basic:availability -->
${extra}`;

test('a document with no managed blocks is left exactly as it was', () => {
    const text = '# Notes\n\nNothing generated here.\n';
    const r = applyBlocks(text, []);
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.changed, false);
    assert.equal(r.ok && r.text, text);
});

test('regenerating identical content reports no change and returns the input byte for byte', () => {
    const text = page();
    const r = applyBlocks(text, [{ key: 'availability', content: '- Given by [[igor]]' }]);
    assert.equal(r.ok && r.changed, false);
    assert.equal(r.ok && r.text, text);
});

test('writing twice is byte-identical', () => {
    const once = applyBlocks(page(), [{ key: 'availability', content: '- Sold by [[greta]]' }]);
    assert.equal(once.ok, true);
    const twice = applyBlocks(once.ok ? once.text : '', [
        { key: 'availability', content: '- Sold by [[greta]]' },
    ]);
    assert.equal(twice.ok && twice.changed, false);
    assert.equal(twice.ok && twice.text, once.ok && once.text);
});

test('prose outside the markers survives a rewrite byte for byte', () => {
    const r = applyBlocks(page(), [{ key: 'availability', content: '- Dropped by [[wolf]]' }]);
    assert.equal(r.ok, true);
    const out = r.ok ? r.text : '';
    assert.match(out, /^---\nid: igor\ntype: character\n---\n\nIgor turns up uninvited and hands over an axe\./);
    assert.match(out, /- Dropped by \[\[wolf\]\]/);
    assert.doesNotMatch(out, /Given by/);
});

test('a section with no block yet is appended once, and stays appended once', () => {
    const text = 'Just prose.\n';
    const first = applyBlocks(text, [{ key: 'appears-in', content: '- [[act_1]]' }]);
    assert.equal(first.ok && first.changed, true);
    const out = first.ok ? first.text : '';
    assert.equal(out, 'Just prose.\n\n<!-- basic:appears-in -->\n- [[act_1]]\n<!-- /basic:appears-in -->\n');

    const second = applyBlocks(out, [{ key: 'appears-in', content: '- [[act_1]]' }]);
    assert.equal(second.ok && second.changed, false);
    assert.equal(second.ok && second.text, out);
});

test('a block no longer wanted is removed without leaving a growing gap', () => {
    const text = page();
    const stripped = applyBlocks(text, []);
    assert.equal(stripped.ok && stripped.changed, true);
    const out = stripped.ok ? stripped.text : '';
    assert.doesNotMatch(out, /basic:availability/);
    assert.equal(out, '---\nid: igor\ntype: character\n---\n\nIgor turns up uninvited and hands over an axe.\n');
});

test('an empty section renders a stable empty block', () => {
    const first = applyBlocks('Prose.\n', [{ key: 'availability', content: '' }]);
    const out = first.ok ? first.text : '';
    const second = applyBlocks(out, [{ key: 'availability', content: '' }]);
    assert.equal(second.ok && second.changed, false);
    assert.equal(second.ok && second.text, out);
});

/* Every malformed shape refuses to write. Guessing which marker the author
 * meant is how a tool eats someone's prose. */
const broken: Array<[string, string, string]> = [
    ['an unclosed block', 'a\n<!-- basic:x -->\nb\n', 'block/unclosed'],
    ['a close with no open', 'a\n<!-- /basic:x -->\nb\n', 'block/orphan-close'],
    ['a mismatched close', '<!-- basic:x -->\nb\n<!-- /basic:y -->\n', 'block/mismatch'],
    ['a nested open', '<!-- basic:x -->\n<!-- basic:y -->\nb\n<!-- /basic:y -->\n', 'block/nested'],
    ['a duplicated key', '<!-- basic:x -->\na\n<!-- /basic:x -->\n<!-- basic:x -->\nb\n<!-- /basic:x -->\n', 'block/duplicate'],
];

for (const [label, text, rule] of broken) {
    test(`${label} refuses to write and reports ${rule}`, () => {
        const scan = findBlocks(text, 'igor.md');
        assert.equal(scan.ok, false);
        assert.equal(!scan.ok && scan.problem.rule, rule);
        assert.equal(!scan.ok && scan.problem.file, 'igor.md');

        const write = applyBlocks(text, [{ key: 'x', content: 'new' }], 'igor.md');
        assert.equal(write.ok, false, 'a malformed file must never be written');
    });
}

test('markers are found regardless of surrounding whitespace', () => {
    const scan = findBlocks('   <!--  basic:x  -->  \nbody\n  <!-- /basic:x -->\n');
    assert.equal(scan.ok, true);
    assert.equal(scan.ok && scan.blocks.length, 1);
    assert.equal(scan.ok && scan.blocks[0]!.content, 'body');
});

test('renderBlock trims stray blank lines so content cannot drift', () => {
    assert.equal(renderBlock('k', '\n\nbody\n\n'), '<!-- basic:k -->\nbody\n<!-- /basic:k -->');
});
