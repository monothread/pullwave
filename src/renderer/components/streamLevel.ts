// A quality of the stream as the master playlist lists it.
export interface StreamLevel {
    height: number;
    bitrate: number;
}

// The position of the best quality of the master: the tallest picture, and among those of the same height the one with the highest bitrate.
// The first one wins a tie, and null means there is none to choose from.
export function bestLevelIndex(levels: readonly StreamLevel[]): number | null {
    let best: number | null = null;
    levels.forEach((level, position) => {
        const current = best === null ? undefined : levels[best];
        if (current === undefined || level.height > current.height || (level.height === current.height && level.bitrate > current.bitrate)) {
            best = position;
        }
    });
    return best;
}
