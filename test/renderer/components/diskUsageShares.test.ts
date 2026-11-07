import type { DiskSiblingPlacement, DiskUsage } from '@shared/types';
import { diskShares, MIN_FOLDER_PERCENT } from '@renderer/components/diskUsageShares';

const GB = 1024 ** 3;

function usageOf(totalBytes: number, freeBytes: number, folderBytes: number, siblingBytes = 0, placement: DiskSiblingPlacement = 'same-disk'): DiskUsage {
    return {
        directory: '/d',
        totalBytes,
        freeBytes,
        folderBytes,
        sibling: { section: 'manga', directory: '/m', bytes: siblingBytes, placement }
    };
}

describe('diskShares', () => {
    it('splits the disk into the folder, the other files and the free space', () => {
        expect(diskShares(usageOf(100 * GB, 40 * GB, 10 * GB))).toEqual({
            folderPercent: 10,
            siblingPercent: 0,
            othersPercent: 50,
            freePercent: 40,
            usedPercent: 60,
            othersBytes: 50 * GB
        });
    });

    it('gives the folder of the other section a part of its own when it is on the same disk', () => {
        expect(diskShares(usageOf(100 * GB, 40 * GB, 10 * GB, 20 * GB))).toEqual({
            folderPercent: 10,
            siblingPercent: 20,
            othersPercent: 30,
            freePercent: 40,
            usedPercent: 60,
            othersBytes: 30 * GB
        });
    });

    it.each<DiskSiblingPlacement>(['other-disk', 'overlap'])('gives the folder of the other section no part when the placement is %s', (placement) => {
        expect(diskShares(usageOf(100 * GB, 40 * GB, 10 * GB, 20 * GB, placement))).toEqual({
            folderPercent: 10,
            siblingPercent: 0,
            othersPercent: 50,
            freePercent: 40,
            usedPercent: 60,
            othersBytes: 50 * GB
        });
    });

    it('gives a small folder a part that can be seen', () => {
        const shares = diskShares(usageOf(1000 * GB, 500 * GB, 1));
        expect(shares.folderPercent).toBe(MIN_FOLDER_PERCENT);
        expect(shares.othersPercent).toBe(50 - MIN_FOLDER_PERCENT);
        expect(shares.folderPercent + shares.othersPercent + shares.freePercent).toBe(100);
    });

    it('gives a small folder of the other section a part that can be seen too', () => {
        const shares = diskShares(usageOf(1000 * GB, 500 * GB, 1, 1));
        expect(shares.folderPercent).toBe(MIN_FOLDER_PERCENT);
        expect(shares.siblingPercent).toBe(MIN_FOLDER_PERCENT);
        expect(shares.othersPercent).toBe(50 - 2 * MIN_FOLDER_PERCENT);
        expect(shares.folderPercent + shares.siblingPercent + shares.othersPercent + shares.freePercent).toBe(100);
    });

    it('gives an empty folder no part', () => {
        expect(diskShares(usageOf(100, 50, 0))).toEqual({
            folderPercent: 0,
            siblingPercent: 0,
            othersPercent: 50,
            freePercent: 50,
            usedPercent: 50,
            othersBytes: 50
        });
    });

    it('never lets the folder be bigger than what is in use', () => {
        const shares = diskShares(usageOf(100, 90, 500));
        expect(shares).toEqual({ folderPercent: 10, siblingPercent: 0, othersPercent: 0, freePercent: 90, usedPercent: 10, othersBytes: 0 });
    });

    it('never lets the folders together be bigger than what is in use', () => {
        const shares = diskShares(usageOf(100, 70, 20, 500));
        expect(shares).toEqual({ folderPercent: 20, siblingPercent: 10, othersPercent: 0, freePercent: 70, usedPercent: 30, othersBytes: 0 });
    });

    it('leaves the folder of the other section nothing when the folder takes all that is in use', () => {
        const shares = diskShares(usageOf(100, 70, 500, 40));
        expect(shares).toEqual({ folderPercent: 30, siblingPercent: 0, othersPercent: 0, freePercent: 70, usedPercent: 30, othersBytes: 0 });
    });

    it('shows a full disk', () => {
        expect(diskShares(usageOf(100, 0, 25))).toEqual({
            folderPercent: 25,
            siblingPercent: 0,
            othersPercent: 75,
            freePercent: 0,
            usedPercent: 100,
            othersBytes: 75
        });
    });

    it('shows a full disk with both folders', () => {
        expect(diskShares(usageOf(100, 0, 25, 35))).toEqual({
            folderPercent: 25,
            siblingPercent: 35,
            othersPercent: 40,
            freePercent: 0,
            usedPercent: 100,
            othersBytes: 40
        });
    });

    it('treats a disk of unknown size as free', () => {
        expect(diskShares(usageOf(0, 0, 0))).toEqual({
            folderPercent: 0,
            siblingPercent: 0,
            othersPercent: 0,
            freePercent: 100,
            usedPercent: 0,
            othersBytes: 0
        });
    });
});
