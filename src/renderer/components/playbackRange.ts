export interface PlaybackRange {
    start: number;
    end: number;
}

export const RANGE_END_MARGIN = 0.05;

export function rangeLength(range: PlaybackRange): number {
    return Math.max(0, range.end - range.start);
}

export function timeInRange(currentTime: number, range: PlaybackRange): number {
    return Math.min(rangeLength(range), Math.max(0, currentTime - range.start));
}

export function mediaTimeOf(rangeTime: number, range: PlaybackRange): number {
    return range.start + Math.min(rangeLength(range), Math.max(0, rangeTime));
}

export function atRangeEnd(currentTime: number, range: PlaybackRange): boolean {
    return currentTime >= range.end - RANGE_END_MARGIN;
}

export function outsideRange(currentTime: number, range: PlaybackRange): boolean {
    return currentTime < range.start - RANGE_END_MARGIN || atRangeEnd(currentTime, range);
}
