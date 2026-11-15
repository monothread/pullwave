export interface StreamLevel {
    height: number;
    bitrate: number;
}

function pickLevelIndex(levels: readonly StreamLevel[], isBetter: (level: StreamLevel, current: StreamLevel) => boolean): number | null {
    let picked: number | null = null;
    levels.forEach((level, position) => {
        const current = picked === null ? undefined : levels[picked];
        if (current === undefined || isBetter(level, current)) {
            picked = position;
        }
    });
    return picked;
}

export function bestLevelIndex(levels: readonly StreamLevel[]): number | null {
    return pickLevelIndex(levels, (level, current) => {
        return level.height > current.height || (level.height === current.height && level.bitrate > current.bitrate);
    });
}

export function lowestLevelIndex(levels: readonly StreamLevel[]): number | null {
    return pickLevelIndex(levels, (level, current) => {
        return level.height < current.height || (level.height === current.height && level.bitrate < current.bitrate);
    });
}
