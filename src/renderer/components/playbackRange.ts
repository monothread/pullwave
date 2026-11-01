// A part of a media file the player plays as if it were the whole of it (the preview of a cut, D-131): its timeline goes from 0 to the length
// of the part, playing starts at its start and stops at its end.
export interface PlaybackRange {
    start: number;
    end: number;
}

// How close to the end of the part playing counts as the end.
export const RANGE_END_MARGIN = 0.05;

export function rangeLength(range: PlaybackRange): number {
    return Math.max(0, range.end - range.start);
}

// The time of the media as the timeline of the part shows it.
export function timeInRange(currentTime: number, range: PlaybackRange): number {
    return Math.min(rangeLength(range), Math.max(0, currentTime - range.start));
}

// The time of the media for a point of the timeline of the part.
export function mediaTimeOf(rangeTime: number, range: PlaybackRange): number {
    return range.start + Math.min(rangeLength(range), Math.max(0, rangeTime));
}

// Whether playing reached the end of the part.
export function atRangeEnd(currentTime: number, range: PlaybackRange): boolean {
    return currentTime >= range.end - RANGE_END_MARGIN;
}

// Whether the media is outside the part (before its start, or at its end), so playing has to start again from the start.
export function outsideRange(currentTime: number, range: PlaybackRange): boolean {
    return currentTime < range.start - RANGE_END_MARGIN || atRangeEnd(currentTime, range);
}
