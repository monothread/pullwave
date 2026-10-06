import { useEffect, useState, type RefObject } from 'react';
import { readSubtitleScale, saveSubtitleScale, stepSubtitleScale } from '../components/subtitleScale';

export interface SubtitleStyle {
    scale: number;
    // One step bigger (1) or smaller (-1).
    resize: (direction: 1 | -1) => void;
}

// The size of the subtitles: what the viewer chose is remembered for every episode and shown through a variable on the video,
// which the style of the subtitles reads (see .player__video::cue).
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
