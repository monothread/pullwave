import { useId } from 'react';
import { graphPoints } from './speed';

// The size the graph is drawn in; the page stretches it to its box.
export const GRAPH_WIDTH = 300;
export const GRAPH_HEIGHT = 80;

// The speed of the last minute as a line over a filled area, as in the downloads of a console.
export function SpeedGraph({ samples, label }: { samples: readonly number[]; label: string }) {
    const gradientId = useId();
    const line = graphPoints(samples, GRAPH_WIDTH, GRAPH_HEIGHT);
    return (
        <svg className="speed-graph" viewBox={`0 0 ${String(GRAPH_WIDTH)} ${String(GRAPH_HEIGHT)}`} preserveAspectRatio="none" role="img" aria-label={label}>
            <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" className="speed-graph__stop-top" />
                    <stop offset="100%" className="speed-graph__stop-bottom" />
                </linearGradient>
            </defs>
            {line !== '' && (
                <>
                    <polygon className="speed-graph__area" points={`0,${String(GRAPH_HEIGHT)} ${line} ${String(GRAPH_WIDTH)},${String(GRAPH_HEIGHT)}`} fill={`url(#${gradientId})`} />
                    <polyline className="speed-graph__line" points={line} fill="none" />
                </>
            )}
        </svg>
    );
}
