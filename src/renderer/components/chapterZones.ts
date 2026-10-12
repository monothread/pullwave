// The zones between chapters in the scroll modes: below the last page there is the zone of the next chapter, and above the first page the
// one of the previous chapter. The user goes through a zone to say they want the other chapter; these are the rules, with no screen in them.

// How long the zone has to be all in view before the chapter is switched (scrolling back before that cancels it).
export const ZONE_DWELL_MS = 500;
// The part of the area that a zone takes, and the least it is in pixels.
export const ZONE_HEIGHT_RATIO = 0.6;
export const ZONE_MIN_HEIGHT = 240;
// From this much of a zone in view it counts as all in view.
export const ZONE_FULL = 0.98;
// A zone is armed only after it was out of view (this much or less in view): a chapter that opens with its zone in view does not switch.
export const ZONE_ARM_BELOW = 0.15;

export interface Edges {
    top: number;
    bottom: number;
}

function clamp(value: number): number {
    return Math.min(1, Math.max(0, value));
}

export function zoneHeight(areaHeight: number): number {
    return Math.max(ZONE_MIN_HEIGHT, Math.round(areaHeight * ZONE_HEIGHT_RATIO));
}

// How much of the zone below the last page is in view: 0 when its top is at the bottom of the area, 1 when all of it is.
export function endZoneProgress(zone: Edges, areaBottom: number): number {
    const height = zone.bottom - zone.top;
    return height <= 0 ? 0 : clamp((areaBottom - zone.top) / height);
}

// How much of the zone above the first page is in view: 0 when its bottom is at the top of what shows (under the bar), 1 when all of it is.
export function startZoneProgress(zone: Edges, visibleTop: number): number {
    const height = zone.bottom - zone.top;
    return height <= 0 ? 0 : clamp((zone.bottom - visibleTop) / height);
}

// Where to scroll to so that the first page is just under the bar: the zone above it is out of view.
export function chapterStartScrollTop(current: number, pagesTop: number, wantedTop: number): number {
    return Math.max(0, Math.round(current + pagesTop - wantedTop));
}
