// A quality of the stream as the master playlist lists it.
export interface StreamLevel {
    height: number;
    bitrate: number;
}

// The position of the level that wins every comparison with `isBetter`; the first one wins a tie, and null means there is none to choose from.
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

// The position of the best quality of the master: the tallest picture, and among those of the same height the one with the highest bitrate.
// The first one wins a tie, and null means there is none to choose from.
export function bestLevelIndex(levels: readonly StreamLevel[]): number | null {
    return pickLevelIndex(levels, (level, current) => {
        return level.height > current.height || (level.height === current.height && level.bitrate > current.bitrate);
    });
}

// The position of the lightest quality of the master (the one the preview of the timeline loads): the shortest picture, and among those of
// the same height the one with the lowest bitrate. The first one wins a tie, and null means there is none to choose from.
export function lowestLevelIndex(levels: readonly StreamLevel[]): number | null {
    return pickLevelIndex(levels, (level, current) => {
        return level.height < current.height || (level.height === current.height && level.bitrate < current.bitrate);
    });
}
