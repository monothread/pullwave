import type { DiskUsage } from '@shared/types';

// Smallest part of the ring a folder with files in it gets, so that a small folder on a big disk can still be seen.
export const MIN_FOLDER_PERCENT = 1;

export interface DiskShares {
    // What the folder takes, what the folder of the other section takes, what other files take and what is free, as percentages of the
    // whole disk (the four add up to 100). The folder of the other section has a part only when it is on the same disk and apart.
    folderPercent: number;
    siblingPercent: number;
    othersPercent: number;
    freePercent: number;
    // What is in use on the whole disk (the folder, the folder of the other section and the other files).
    usedPercent: number;
    // The bytes of the other files, which do not include the folder of the other section when that one has a part of its own.
    othersBytes: number;
}

function clampPercent(value: number): number {
    return Math.min(100, Math.max(0, value));
}

// The part of the ring a folder gets: its real share, but never less than the smallest one that can be seen and never more than there is
// room for.
function visiblePercent(bytes: number, totalBytes: number, room: number): number {
    if (bytes <= 0) {
        return 0;
    }
    return Math.min(room, Math.max(MIN_FOLDER_PERCENT, clampPercent((bytes / totalBytes) * 100)));
}

export function diskShares(usage: DiskUsage): DiskShares {
    if (usage.totalBytes <= 0) {
        return { folderPercent: 0, siblingPercent: 0, othersPercent: 0, freePercent: 100, usedPercent: 0, othersBytes: 0 };
    }
    const usedBytes = Math.max(0, usage.totalBytes - usage.freeBytes);
    const folderBytes = Math.min(usage.folderBytes, usedBytes);
    const siblingBytes = usage.sibling.placement === 'same-disk' ? Math.min(usage.sibling.bytes, usedBytes - folderBytes) : 0;
    const usedPercent = clampPercent((usedBytes / usage.totalBytes) * 100);
    const folderPercent = visiblePercent(folderBytes, usage.totalBytes, usedPercent);
    const siblingPercent = visiblePercent(siblingBytes, usage.totalBytes, usedPercent - folderPercent);
    return {
        folderPercent,
        siblingPercent,
        othersPercent: usedPercent - folderPercent - siblingPercent,
        freePercent: 100 - usedPercent,
        usedPercent,
        othersBytes: usedBytes - folderBytes - siblingBytes
    };
}
