/* The Markdown editor.
 *
 * The document is split into segments: prose you can type in, and generated
 * blocks rendered read-only. That is what makes regeneration safe - the cursor
 * physically cannot be inside a managed region, so rewriting one can never land
 * on top of your typing. The markers stay plain text on disk; read-only is a
 * property of this editor, not of the format. */

import { useMemo } from 'react';
import { findBlocks } from '../../core/write-doc.ts';

export interface EditorProps {
    path: string;
    text: string;
    dirty: boolean;
    conflict?: string;
    onChange: (text: string) => void;
    onResolve: (keep: 'mine' | 'theirs') => void;
}

interface Segment {
    kind: 'prose' | 'generated';
    /** The exact slice of the document, used to splice edits back in. */
    text: string;
    start: number;
    end: number;
    key?: string;
    /** For a generated block, the content without its markers. */
    inner?: string;
}

/** Split a document into editable prose and read-only generated blocks. */
export function segments(text: string): Segment[] {
    const scan = findBlocks(text);
    if (!scan.ok) return [{ kind: 'prose', text, start: 0, end: text.length }];

    const out: Segment[] = [];
    let cursor = 0;
    for (const block of scan.blocks) {
        if (block.start > cursor) {
            out.push({ kind: 'prose', text: text.slice(cursor, block.start), start: cursor, end: block.start });
        }
        out.push({
            kind: 'generated',
            text: text.slice(block.start, block.end),
            start: block.start,
            end: block.end,
            key: block.key,
            // The header already names the block; repeating the markers is noise.
            inner: block.content,
        });
        cursor = block.end;
    }
    if (cursor < text.length) {
        out.push({ kind: 'prose', text: text.slice(cursor), start: cursor, end: text.length });
    }
    return out;
}

export function Editor({ path, text, dirty, conflict, onChange, onResolve }: EditorProps): React.JSX.Element {
    const parts = useMemo(() => segments(text), [text]);

    const replace = (segment: Segment, next: string): void => {
        onChange(text.slice(0, segment.start) + next + text.slice(segment.end));
    };

    return (
        <div className="editor">
            <div className="editor-head">
                <span className="path">{path}</span>
                {dirty && <span className="muted">· unsaved</span>}
            </div>

            {/* A conflict is surfaced, never merged. Nobody picks a winner but you. */}
            {conflict !== undefined && (
                <div className="conflict" role="alert">
                    <strong>This file changed on disk</strong>
                    <span className="muted">while you had unsaved edits.</span>
                    <button type="button" className="btn" onClick={() => onResolve('mine')}>Keep mine</button>
                    <button type="button" className="btn" onClick={() => onResolve('theirs')}>Take theirs</button>
                </div>
            )}

            <div className="editor-scroll">
                {parts.map((segment, i) =>
                    segment.kind === 'prose' ? (
                        <textarea
                            key={`p${i}`}
                            className="editor-area"
                            value={segment.text}
                            spellCheck={false}
                            onChange={(e) => replace(segment, e.target.value)}
                            rows={Math.max(4, segment.text.split('\n').length + 1)}
                        />
                    ) : (
                        <div className="generated" key={`g${i}`}>
                            <div className="generated-head">
                                <span>Generated · {segment.key}</span>
                                <span className="muted">maintained by Basic</span>
                            </div>
                            <pre className="generated-body">{segment.inner ?? segment.text}</pre>
                        </div>
                    ),
                )}
            </div>
        </div>
    );
}
