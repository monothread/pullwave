import { useEffect, useRef } from 'react';

interface SeekPreviewThumbProps {
    frame: HTMLCanvasElement;
}

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
