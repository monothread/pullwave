import { diskShares, MIN_FOLDER_PERCENT } from '@renderer/components/diskUsageShares';

const GB = 1024 ** 3;

describe('diskShares', () => {
    it('splits the disk into the folder, the other files and the free space', () => {
        expect(diskShares({ directory: '/d', totalBytes: 100 * GB, freeBytes: 40 * GB, folderBytes: 10 * GB })).toEqual({
            folderPercent: 10,
            othersPercent: 50,
            freePercent: 40,
            usedPercent: 60,
            othersBytes: 50 * GB
        });
    });

    it('gives a small folder a part that can be seen', () => {
        const shares = diskShares({ directory: '/d', totalBytes: 1000 * GB, freeBytes: 500 * GB, folderBytes: 1 });
        expect(shares.folderPercent).toBe(MIN_FOLDER_PERCENT);
        expect(shares.othersPercent).toBe(50 - MIN_FOLDER_PERCENT);
        expect(shares.folderPercent + shares.othersPercent + shares.freePercent).toBe(100);
    });

    it('gives an empty folder no part', () => {
        expect(diskShares({ directory: '/d', totalBytes: 100, freeBytes: 50, folderBytes: 0 })).toEqual({
            folderPercent: 0,
            othersPercent: 50,
            freePercent: 50,
            usedPercent: 50,
            othersBytes: 50
        });
    });

    it('never lets the folder be bigger than what is in use', () => {
        const shares = diskShares({ directory: '/d', totalBytes: 100, freeBytes: 90, folderBytes: 500 });
        expect(shares).toEqual({ folderPercent: 10, othersPercent: 0, freePercent: 90, usedPercent: 10, othersBytes: 0 });
    });

    it('shows a full disk', () => {
        expect(diskShares({ directory: '/d', totalBytes: 100, freeBytes: 0, folderBytes: 25 })).toEqual({
            folderPercent: 25,
            othersPercent: 75,
            freePercent: 0,
            usedPercent: 100,
            othersBytes: 75
        });
    });

    it('treats a disk of unknown size as free', () => {
        expect(diskShares({ directory: '/d', totalBytes: 0, freeBytes: 0, folderBytes: 0 })).toEqual({
            folderPercent: 0,
            othersPercent: 0,
            freePercent: 100,
            usedPercent: 0,
            othersBytes: 0
        });
    });
});
