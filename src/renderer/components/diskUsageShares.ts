import type { DiskUsage } from '@shared/types';

export const MIN_FOLDER_PERCENT = 1;

export interface DiskShares {
    folderPercent: number;
    siblingPercent: number;
    othersPercent: number;
    freePercent: number;
    usedPercent: number;
    othersBytes: number;
}

function clampPercent(value: number): number {
    return Math.min(100, Math.max(0, value));
}

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
