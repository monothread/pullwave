import type { DiskUsage } from '@shared/types';

// Smallest part of the ring a folder with files in it gets, so that a small folder on a big disk can still be seen.
export const MIN_FOLDER_PERCENT = 1;

export interface DiskShares {
    // What the folder takes, what other files take and what is free, as percentages of the whole disk (the three add up to 100).
    folderPercent: number;
    othersPercent: number;
    freePercent: number;
    // What is in use on the whole disk (the folder and the other files).
    usedPercent: number;
    othersBytes: number;
}

function clampPercent(value: number): number {
    return Math.min(100, Math.max(0, value));
}

export function diskShares(usage: DiskUsage): DiskShares {
    if (usage.totalBytes <= 0) {
        return { folderPercent: 0, othersPercent: 0, freePercent: 100, usedPercent: 0, othersBytes: 0 };
    }
    const usedBytes = Math.max(0, usage.totalBytes - usage.freeBytes);
    const folderBytes = Math.min(usage.folderBytes, usedBytes);
    const usedPercent = clampPercent((usedBytes / usage.totalBytes) * 100);
    const exactFolder = clampPercent((folderBytes / usage.totalBytes) * 100);
    const folderPercent = folderBytes > 0 ? Math.min(usedPercent, Math.max(MIN_FOLDER_PERCENT, exactFolder)) : 0;
    return {
        folderPercent,
        othersPercent: usedPercent - folderPercent,
        freePercent: 100 - usedPercent,
        usedPercent,
        othersBytes: usedBytes - folderBytes
    };
}
