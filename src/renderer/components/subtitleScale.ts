const STORAGE_KEY = 'pullwave-subtitle-scale';

export const DEFAULT_SUBTITLE_SCALE = 1;
export const MIN_SUBTITLE_SCALE = 0.5;
export const MAX_SUBTITLE_SCALE = 3;
export const SUBTITLE_SCALE_STEP = 0.25;

export function clampSubtitleScale(scale: number): number {
    return Math.min(MAX_SUBTITLE_SCALE, Math.max(MIN_SUBTITLE_SCALE, scale));
}

export function stepSubtitleScale(scale: number, direction: 1 | -1): number {
    return clampSubtitleScale(Math.round((scale + direction * SUBTITLE_SCALE_STEP) / SUBTITLE_SCALE_STEP) * SUBTITLE_SCALE_STEP);
}

export function readSubtitleScale(): number {
    try {
        const stored = Number(window.localStorage.getItem(STORAGE_KEY));
        return Number.isFinite(stored) && stored > 0 ? clampSubtitleScale(stored) : DEFAULT_SUBTITLE_SCALE;
    } catch {
        return DEFAULT_SUBTITLE_SCALE;
    }
}

export function saveSubtitleScale(scale: number): void {
    try {
        window.localStorage.setItem(STORAGE_KEY, String(scale));
    } catch {
        return;
    }
}

export function scalePercent(scale: number): string {
    return `${Math.round(scale * 100)}%`;
}
