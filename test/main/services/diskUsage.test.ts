import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { folderSize, readDiskUsage, sectionDirectory } from '@main/services/diskUsage';
import { cleanTempDirs, makeTempDir } from '../../helpers/tempDir';

afterEach(() => {
    cleanTempDirs();
});

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

describe('folderSize', () => {
    it('adds up the files of the folder and of the folders inside it', async () => {
        const root = makeTempDir();
        mkdirSync(join(root, 'a', 'b'), { recursive: true });
        writeFileSync(join(root, 'one.bin'), '1'.repeat(10));
        writeFileSync(join(root, 'a', 'two.bin'), '2'.repeat(20));
        writeFileSync(join(root, 'a', 'b', 'three.bin'), '3'.repeat(30));
        await expect(folderSize(root)).resolves.toBe(60);
    });

    it('is zero for an empty folder', async () => {
        await expect(folderSize(makeTempDir())).resolves.toBe(0);
    });

    it('is zero for a folder that does not exist', async () => {
        await expect(folderSize(join(makeTempDir(), 'missing'))).resolves.toBe(0);
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
});

describe('readDiskUsage', () => {
    it('reads the space of the disk and the size of the folder', async () => {
        const root = makeTempDir();
        writeFileSync(join(root, 'a.bin'), 'a'.repeat(55));
        const usage = await readDiskUsage(root);
        expect(usage).toEqual({ directory: root, totalBytes: expect.any(Number), freeBytes: expect.any(Number), folderBytes: 55 });
        expect(usage?.totalBytes).toBeGreaterThan(0);
        expect(usage?.freeBytes).toBeGreaterThanOrEqual(0);
        expect(usage?.freeBytes).toBeLessThanOrEqual(usage?.totalBytes ?? 0);
    });

    it('reads the disk of the closest folder that exists when the folder was not created yet', async () => {
        const missing = join(makeTempDir(), 'not', 'created');
        const usage = await readDiskUsage(missing);
        expect(usage?.directory).toBe(missing);
        expect(usage?.folderBytes).toBe(0);
        expect(usage?.totalBytes).toBeGreaterThan(0);
    });
});
