import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { stat, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_SETTINGS } from '@shared/constants';
import type { DiskUsage } from '@shared/types';
import type { ConcurrencyLimit } from '@main/services/concurrencyLimit';
import { folderSize, readDiskUsage, readSectionDiskUsage, sectionDirectory, siblingSection } from '@main/services/diskUsage';
import { cleanTempDirs, makeTempDir } from '../../helpers/tempDir';

// The functions that tell the disk are wrapped so that a test can say that a folder is on another disk, or that the disk cannot be read.
vi.mock('node:fs/promises', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs/promises')>();
    return { ...actual, stat: vi.fn(actual.stat), statfs: vi.fn(actual.statfs) };
});

const realFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');

afterEach(() => {
    cleanTempDirs();
    vi.mocked(stat).mockImplementation(realFs.stat);
    vi.mocked(statfs).mockImplementation(realFs.statfs);
});

// Every folder whose path starts with `prefix` is told to be on the disk `disk`, or (null) to fail when the disk is asked.
function placeOnDisk(prefix: string, disk: number | null): void {
    vi.mocked(stat).mockImplementation(async (path) => {
        if (String(path).startsWith(prefix) && disk === null) {
            throw new Error('The disk cannot be told.');
        }
        const real = await realFs.stat(path);
        return String(path).startsWith(prefix) && disk !== null ? Object.assign(real, { dev: disk }) : real;
    });
}

function writeSized(path: string, bytes: number): void {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, 'x'.repeat(bytes));
}

describe('sectionDirectory', () => {
    it('uses the folder chosen for the anime', () => {
        expect(sectionDirectory('anime', { ...DEFAULT_SETTINGS, animeDownloadDir: '/media/anime' }, '/home/a/Downloads')).toBe('/media/anime');
    });

    it('uses the folder chosen for the manga', () => {
        expect(sectionDirectory('manga', { ...DEFAULT_SETTINGS, mangaDirectory: '/media/manga' }, '/home/a/Downloads')).toBe('/media/manga');
    });

    it('falls back to the default anime folder inside the downloads folder', () => {
        expect(sectionDirectory('anime', { ...DEFAULT_SETTINGS, animeDownloadDir: '', mangaDirectory: '/media/manga' }, '/home/a/Downloads')).toBe(join('/home/a/Downloads', 'Pullwave Anime'));
    });

    it('falls back to the default manga folder inside the downloads folder', () => {
        expect(sectionDirectory('manga', { ...DEFAULT_SETTINGS, mangaDirectory: '', animeDownloadDir: '/media/anime' }, '/home/a/Downloads')).toBe(join('/home/a/Downloads', 'Pullwave Manga'));
    });
});

describe('siblingSection', () => {
    it('is the manga for the anime', () => {
        expect(siblingSection('anime')).toBe('manga');
    });

    it('is the anime for the manga', () => {
        expect(siblingSection('manga')).toBe('anime');
    });
});

describe('folderSize', () => {
    it('adds up the files of the folder and of the folders inside it', async () => {
        const root = makeTempDir();
        mkdirSync(join(root, 'a', 'b'), { recursive: true });
        writeFileSync(join(root, 'one.bin'), '1'.repeat(10));
        writeFileSync(join(root, 'a', 'two.bin'), '2'.repeat(20));
        writeFileSync(join(root, 'a', 'b', 'three.bin'), '3'.repeat(30));
        await expect(folderSize(root)).resolves.toBe(60);
    });

    it('adds up many folders side by side', async () => {
        const root = makeTempDir();
        for (let folder = 0; folder < 20; folder += 1) {
            for (let file = 0; file < 5; file += 1) {
                writeSized(join(root, `folder-${folder}`, 'inner', `file-${file}.bin`), folder + file + 1);
            }
        }
        // For each folder: 5 files with (folder + 1) ... (folder + 5) bytes.
        const expected = Array.from({ length: 20 }, (_unused, folder) => {
            return 5 * folder + 15;
        }).reduce((total, size) => {
            return total + size;
        }, 0);
        await expect(folderSize(root)).resolves.toBe(expected);
    });

    it('is zero for an empty folder', async () => {
        await expect(folderSize(makeTempDir())).resolves.toBe(0);
    });

    it('is zero for a folder that does not exist', async () => {
        await expect(folderSize(join(makeTempDir(), 'missing'))).resolves.toBe(0);
    });

    it('is zero for a path that is a file, not a folder', async () => {
        const root = makeTempDir();
        writeFileSync(join(root, 'file.bin'), 'abc');
        await expect(folderSize(join(root, 'file.bin'))).resolves.toBe(0);
    });

    it('does not follow links to folders, and counts the link itself', async () => {
        const root = makeTempDir();
        const outside = makeTempDir();
        writeFileSync(join(outside, 'big.bin'), 'z'.repeat(1000));
        symlinkSync(outside, join(root, 'link'));
        const size = await folderSize(root);
        expect(size).toBeLessThan(1000);
        expect(size).toBeGreaterThan(0);
    });

    it('asks the limit it was given for every read of the disk, one for each folder and each file', async () => {
        const root = makeTempDir();
        mkdirSync(join(root, 'a'), { recursive: true });
        writeFileSync(join(root, 'one.bin'), '1'.repeat(10));
        writeFileSync(join(root, 'a', 'two.bin'), '2'.repeat(20));
        const limit = vi.fn(<Result>(task: () => Promise<Result>): Promise<Result> => {
            return task();
        });
        await expect(folderSize(root, limit as ConcurrencyLimit)).resolves.toBe(30);
        // Reads the root, the file in it, the folder `a` and the file in it.
        expect(limit).toHaveBeenCalledTimes(4);
    });
});

describe('readDiskUsage', () => {
    it('reads the space of the disk, the size of the folder and of the folder of the other section on the same disk', async () => {
        const root = makeTempDir();
        const anime = join(root, 'anime');
        const manga = join(root, 'manga');
        writeSized(join(anime, 'a.bin'), 55);
        writeSized(join(manga, 'b.bin'), 21);
        writeSized(join(manga, 'deep', 'c.bin'), 4);
        const usage = await readDiskUsage({ section: 'anime', directory: anime }, { section: 'manga', directory: manga });
        expect(usage).toEqual({
            directory: anime,
            totalBytes: expect.any(Number),
            freeBytes: expect.any(Number),
            folderBytes: 55,
            sibling: { section: 'manga', directory: manga, bytes: 25, placement: 'same-disk' }
        });
        expect(usage?.totalBytes).toBeGreaterThan(0);
        expect(usage?.freeBytes).toBeGreaterThanOrEqual(0);
        expect(usage?.freeBytes).toBeLessThanOrEqual(usage?.totalBytes ?? 0);
    });

    it('reads the disk with the numbers the system gives', async () => {
        vi.mocked(statfs).mockResolvedValue({ type: 1, bsize: 4096, frsize: 4096, blocks: 1000, bfree: 600, bavail: 400, files: 0, ffree: 0 });
        const root = makeTempDir();
        const usage = await readDiskUsage({ section: 'manga', directory: join(root, 'manga') }, { section: 'anime', directory: join(root, 'anime') });
        expect(usage).toMatchObject({ totalBytes: 4096000, freeBytes: 1638400 });
        expect(statfs).toHaveBeenCalledWith(root);
    });

    it('reads the manga with the anime as the folder of the other section', async () => {
        const root = makeTempDir();
        writeSized(join(root, 'anime', 'a.bin'), 7);
        writeSized(join(root, 'manga', 'b.bin'), 9);
        const usage = await readDiskUsage({ section: 'manga', directory: join(root, 'manga') }, { section: 'anime', directory: join(root, 'anime') });
        expect(usage?.folderBytes).toBe(9);
        expect(usage?.sibling).toEqual({ section: 'anime', directory: join(root, 'anime'), bytes: 7, placement: 'same-disk' });
    });

    it('reads the disk of the closest folder that exists when the folder was not created yet', async () => {
        const root = makeTempDir();
        const missing = join(root, 'not', 'created');
        const usage = await readDiskUsage({ section: 'anime', directory: missing }, { section: 'manga', directory: join(root, 'also', 'missing') });
        expect(usage?.directory).toBe(missing);
        expect(usage?.folderBytes).toBe(0);
        expect(usage?.totalBytes).toBeGreaterThan(0);
        expect(usage?.sibling).toEqual({ section: 'manga', directory: join(root, 'also', 'missing'), bytes: 0, placement: 'same-disk' });
    });

    it('counts the files once when both sections use the same folder', async () => {
        const root = makeTempDir();
        writeSized(join(root, 'both', 'a.bin'), 30);
        const usage = await readDiskUsage({ section: 'anime', directory: join(root, 'both') }, { section: 'manga', directory: join(root, 'both') });
        expect(usage?.folderBytes).toBe(30);
        expect(usage?.sibling).toEqual({ section: 'manga', directory: join(root, 'both'), bytes: 30, placement: 'overlap' });
    });

    it('says the folders overlap when the folder of the other section is inside the folder', async () => {
        const root = makeTempDir();
        writeSized(join(root, 'anime', 'a.bin'), 10);
        writeSized(join(root, 'anime', 'manga', 'b.bin'), 6);
        const usage = await readDiskUsage({ section: 'anime', directory: join(root, 'anime') }, { section: 'manga', directory: join(root, 'anime', 'manga') });
        expect(usage?.folderBytes).toBe(16);
        expect(usage?.sibling).toEqual({ section: 'manga', directory: join(root, 'anime', 'manga'), bytes: 6, placement: 'overlap' });
    });

    it('says the folders overlap when the folder is inside the folder of the other section', async () => {
        const root = makeTempDir();
        writeSized(join(root, 'manga', 'b.bin'), 6);
        writeSized(join(root, 'manga', 'anime', 'a.bin'), 10);
        const usage = await readDiskUsage({ section: 'anime', directory: join(root, 'manga', 'anime') }, { section: 'manga', directory: join(root, 'manga') });
        expect(usage?.folderBytes).toBe(10);
        expect(usage?.sibling).toEqual({ section: 'manga', directory: join(root, 'manga'), bytes: 16, placement: 'overlap' });
    });

    it('does not take a folder whose name only starts like the other one for a folder inside it', async () => {
        const root = makeTempDir();
        writeSized(join(root, 'media', 'a.bin'), 3);
        writeSized(join(root, 'media-extra', 'b.bin'), 5);
        const usage = await readDiskUsage({ section: 'anime', directory: join(root, 'media') }, { section: 'manga', directory: join(root, 'media-extra') });
        expect(usage?.sibling.placement).toBe('same-disk');
        expect(usage?.sibling.bytes).toBe(5);
    });

    it('says the folder of the other section is on another disk when the system tells another disk', async () => {
        const root = makeTempDir();
        writeSized(join(root, 'anime', 'a.bin'), 11);
        writeSized(join(root, 'manga', 'b.bin'), 13);
        placeOnDisk(join(root, 'manga'), 987654);
        const usage = await readDiskUsage({ section: 'anime', directory: join(root, 'anime') }, { section: 'manga', directory: join(root, 'manga') });
        expect(usage?.folderBytes).toBe(11);
        expect(usage?.sibling).toEqual({ section: 'manga', directory: join(root, 'manga'), bytes: 13, placement: 'other-disk' });
    });

    it('says the folder is on another disk when the disk of the folder of the other section cannot be told', async () => {
        const root = makeTempDir();
        writeSized(join(root, 'manga', 'b.bin'), 13);
        placeOnDisk(join(root, 'manga'), null);
        const usage = await readDiskUsage({ section: 'anime', directory: join(root, 'anime') }, { section: 'manga', directory: join(root, 'manga') });
        expect(usage?.sibling).toEqual({ section: 'manga', directory: join(root, 'manga'), bytes: 13, placement: 'other-disk' });
    });

    it('is null when the disk cannot be read', async () => {
        vi.mocked(statfs).mockRejectedValue(new Error('no disk'));
        const root = makeTempDir();
        await expect(readDiskUsage({ section: 'anime', directory: root }, { section: 'manga', directory: root })).resolves.toBeNull();
    });
});

describe('readSectionDiskUsage', () => {
    it('measures the anime folder of the settings with the manga folder next to it', async () => {
        const root = makeTempDir();
        writeSized(join(root, 'my-anime', 'a.bin'), 40);
        writeSized(join(root, 'my-manga', 'b.bin'), 2);
        const settings = { ...DEFAULT_SETTINGS, animeDownloadDir: join(root, 'my-anime'), mangaDirectory: join(root, 'my-manga') };
        const usage = (await readSectionDiskUsage('anime', settings, join(root, 'Downloads'))) as DiskUsage;
        expect(usage.directory).toBe(join(root, 'my-anime'));
        expect(usage.folderBytes).toBe(40);
        expect(usage.sibling).toEqual({ section: 'manga', directory: join(root, 'my-manga'), bytes: 2, placement: 'same-disk' });
    });

    it('measures the manga folder of the settings with the anime folder next to it', async () => {
        const root = makeTempDir();
        writeSized(join(root, 'my-anime', 'a.bin'), 40);
        writeSized(join(root, 'my-manga', 'b.bin'), 2);
        const settings = { ...DEFAULT_SETTINGS, animeDownloadDir: join(root, 'my-anime'), mangaDirectory: join(root, 'my-manga') };
        const usage = (await readSectionDiskUsage('manga', settings, join(root, 'Downloads'))) as DiskUsage;
        expect(usage.directory).toBe(join(root, 'my-manga'));
        expect(usage.folderBytes).toBe(2);
        expect(usage.sibling).toEqual({ section: 'anime', directory: join(root, 'my-anime'), bytes: 40, placement: 'same-disk' });
    });

    it('uses the default folders inside the downloads folder when none is chosen', async () => {
        const root = makeTempDir();
        const downloads = join(root, 'Downloads');
        writeSized(join(downloads, 'Pullwave Anime', 'a.bin'), 8);
        const usage = (await readSectionDiskUsage('anime', { ...DEFAULT_SETTINGS, animeDownloadDir: '', mangaDirectory: '' }, downloads)) as DiskUsage;
        expect(usage.directory).toBe(join(downloads, 'Pullwave Anime'));
        expect(usage.folderBytes).toBe(8);
        expect(usage.sibling).toEqual({ section: 'manga', directory: join(downloads, 'Pullwave Manga'), bytes: 0, placement: 'same-disk' });
    });
});
