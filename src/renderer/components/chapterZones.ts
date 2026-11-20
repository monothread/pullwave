export const ZONE_DWELL_MS = 500;
export const ZONE_HEIGHT_RATIO = 0.6;
export const ZONE_MIN_HEIGHT = 240;
export const ZONE_FULL = 0.98;
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

export function endZoneProgress(zone: Edges, areaBottom: number): number {
    const height = zone.bottom - zone.top;
    return height <= 0 ? 0 : clamp((areaBottom - zone.top) / height);
}

export function startZoneProgress(zone: Edges, visibleTop: number): number {
    const height = zone.bottom - zone.top;
    return height <= 0 ? 0 : clamp((zone.bottom - visibleTop) / height);
}

export function chapterStartScrollTop(current: number, pagesTop: number, wantedTop: number): number {
    return Math.max(0, Math.round(current + pagesTop - wantedTop));
}

export function restingBarBottom(areaTop: number, bar: Edges | null): number {
    if (bar === null) {
        return areaTop;
    }
    return Math.max(bar.bottom, areaTop + Math.max(0, bar.bottom - bar.top));
}
