/* An edge between two cards.
 *
 * Smoothstep with a rounded corner and a stub off the card before the first
 * turn - that stub is what reads as graceful rather than a line jabbed at a
 * box. A gated edge carries a lock badge at its midpoint which doubles as its
 * click target, because a 1.5px line is not something anyone should have to
 * aim at. */

import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react';

export interface EdgeData extends Record<string, unknown> {
    label: string;
    gated: boolean;
    /** A sketch has no relation yet: dashed, and labelled as such. */
    sketch: boolean;
    onSelect?: (id: string) => void;
}

export function Edge(props: EdgeProps): React.JSX.Element {
    const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd } = props;
    const d = (props.data ?? {}) as unknown as EdgeData;

    const [path, labelX, labelY] = getSmoothStepPath({
        sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
        borderRadius: 8,
        offset: 24,
    });

    return (
        <>
            <BaseEdge
                id={id}
                path={path}
                markerEnd={markerEnd}
                // A wide invisible stroke under the line, so it is easy to hit.
                interactionWidth={20}
            />
            <EdgeLabelRenderer>
                <button
                    type="button"
                    className="edge-badge nodrag nopan"
                    style={{
                        position: 'absolute',
                        transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
                    }}
                    onClick={() => d.onSelect?.(id)}
                >
                    {d.gated && <span className="lock" aria-hidden="true">🔒</span>}
                    <span>{d.sketch ? 'sketch' : d.label}</span>
                </button>
            </EdgeLabelRenderer>
        </>
    );
}
