import { useEffect, useState, type RefObject } from 'react';
import { readSubtitleScale, saveSubtitleScale, stepSubtitleScale } from '../components/subtitleScale';

export interface SubtitleStyle {
    scale: number;
    resize: (direction: 1 | -1) => void;
}

export function useSubtitleStyle(video: RefObject<HTMLVideoElement | null>): SubtitleStyle {
    const [scale, setScale] = useState(readSubtitleScale);

    useEffect(() => {
        video.current?.style.setProperty('--subtitle-scale', String(scale));
    }, [video, scale]);

    function resize(direction: 1 | -1): void {
        const next = stepSubtitleScale(scale, direction);
        setScale(next);
        saveSubtitleScale(next);
    }

    return { scale, resize };
}
