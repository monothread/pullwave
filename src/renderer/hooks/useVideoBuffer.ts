import { useEffect, useState, type RefObject } from 'react';

export const LOADING_DELAY_MS = 150;

const WAIT_EVENTS = ['seeking', 'waiting'];
const READY_EVENTS = ['playing', 'seeked', 'canplay', 'emptied', 'error'];
const BUFFER_EVENTS = ['progress', 'timeupdate', 'seeked', 'loadedmetadata', 'durationchange', 'emptied'];

export interface VideoBuffer {
    loading: boolean;
    bufferedPercent: number;
}

export function bufferedEnd(ranges: TimeRanges, currentTime: number): number {
    for (let index = 0; index < ranges.length; index += 1) {
        if (ranges.start(index) <= currentTime && ranges.end(index) >= currentTime) {
            return ranges.end(index);
        }
    }
    return 0;
}

export function bufferedPercentOf(element: HTMLVideoElement): number {
    const { duration } = element;
    if (!Number.isFinite(duration) || duration <= 0) {
        return 0;
    }
    return Math.min(100, (bufferedEnd(element.buffered, element.currentTime) / duration) * 100);
}

export function useVideoBuffer(video: RefObject<HTMLVideoElement | null>): VideoBuffer {
    const [loading, setLoading] = useState(false);
    const [bufferedPercent, setBufferedPercent] = useState(0);

    useEffect(() => {
        const element = video.current;
        if (!element) {
            return undefined;
        }
        let pending: ReturnType<typeof setTimeout> | null = null;
        const cancelPending = (): void => {
            if (pending !== null) {
                clearTimeout(pending);
                pending = null;
            }
        };
        const onWait = (): void => {
            if (pending === null) {
                pending = setTimeout(() => {
                    pending = null;
                    setLoading(true);
                }, LOADING_DELAY_MS);
            }
        };
        const onReady = (): void => {
            cancelPending();
            setLoading(false);
        };
        const onBuffer = (): void => {
            setBufferedPercent(bufferedPercentOf(element));
        };
        WAIT_EVENTS.forEach((name) => {
            element.addEventListener(name, onWait);
        });
        READY_EVENTS.forEach((name) => {
            element.addEventListener(name, onReady);
        });
        BUFFER_EVENTS.forEach((name) => {
            element.addEventListener(name, onBuffer);
        });
        onBuffer();
        return () => {
            cancelPending();
            WAIT_EVENTS.forEach((name) => {
                element.removeEventListener(name, onWait);
            });
            READY_EVENTS.forEach((name) => {
                element.removeEventListener(name, onReady);
            });
            BUFFER_EVENTS.forEach((name) => {
                element.removeEventListener(name, onBuffer);
            });
        };
    }, [video]);

    return { loading, bufferedPercent };
}
