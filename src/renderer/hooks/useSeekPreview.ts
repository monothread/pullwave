import { useEffect, useRef, useState } from 'react';
import { openPreviewMedia } from '../components/previewMedia';
import { SeekPreviewGrabber, type SeekPreviewSource } from '../components/seekPreview';

function createCanvas(): HTMLCanvasElement {
    return document.createElement('canvas');
}

export function useSeekPreview(source: SeekPreviewSource | undefined, second: number | null): HTMLCanvasElement | null {
    const [frame, setFrame] = useState<HTMLCanvasElement | null>(null);
    const grabber = useRef<SeekPreviewGrabber | null>(null);
    const kind = source?.kind;
    const url = source?.url;

    useEffect(() => {
        return () => {
            grabber.current?.close();
            grabber.current = null;
            setFrame(null);
        };
    }, [kind, url]);

    useEffect(() => {
        if (kind === undefined || url === undefined || second === null) {
            return;
        }
        if (grabber.current === null) {
            grabber.current = new SeekPreviewGrabber(
                { kind, url },
                {
                    onFrame: setFrame,
                    onFailure: () => {
                        setFrame(null);
                    }
                },
                { openMedia: openPreviewMedia, createCanvas }
            );
        }
        grabber.current.request(second);
    }, [kind, url, second]);

    return frame;
}
