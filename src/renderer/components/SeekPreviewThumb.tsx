import { useEffect, useRef } from 'react';

interface SeekPreviewThumbProps {
    frame: HTMLCanvasElement;
}

// The frame of the preview of the timeline, copied into a canvas of the tooltip (the frame itself stays in the cache, to be shown again).
export function SeekPreviewThumb({ frame }: SeekPreviewThumbProps) {
    const canvas = useRef<HTMLCanvasElement | null>(null);

    useEffect(() => {
        const element = canvas.current;
        if (element === null) {
            return;
        }
        element.width = frame.width;
        element.height = frame.height;
        element.getContext('2d')?.drawImage(frame, 0, 0);
    }, [frame]);

    return <canvas ref={canvas} className="player__thumb" aria-hidden="true" data-testid="player-thumb" />;
}
