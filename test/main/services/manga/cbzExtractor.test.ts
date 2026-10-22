import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractCbzPages } from '@main/services/manga/cbzExtractor';
import { craftZip } from '../../../helpers/craftZip';
import { cleanTempDirs, makeTempDir } from '../../../helpers/tempDir';

afterEach(() => {
    cleanTempDirs();
});

function prepare(entries: Array<{ name: string; data?: string }>): { file: string; directory: string } {
    const root = makeTempDir();
    const file = join(root, 'Chapter 1.cbz');
    writeFileSync(file, craftZip(entries));
    const directory = join(root, 'Chapter 1.cbz.part');
    mkdirSync(directory);
    return { file, directory };
}

describe('extractCbzPages', () => {
    it('writes every page under its own name, with its bytes', async () => {
        const { file, directory } = prepare([
            { name: '001.jpg', data: 'one' },
            { name: '003.png', data: 'three' },
            { name: '010.webp', data: 'ten' }
        ]);
        await extractCbzPages(file, directory);
        expect(readdirSync(directory).sort()).toEqual(['001.jpg', '003.png', '010.webp']);
        expect(readFileSync(join(directory, '001.jpg'), 'utf-8')).toBe('one');
        expect(readFileSync(join(directory, '003.png'), 'utf-8')).toBe('three');
        expect(readFileSync(join(directory, '010.webp'), 'utf-8')).toBe('ten');
    });

    it('leaves out the ComicInfo, anything that is not a page and any name with a path', async () => {
        const { file, directory } = prepare([
            { name: 'ComicInfo.xml', data: '<ComicInfo/>' },
            { name: 'readme.txt', data: 'x' },
            { name: 'sub/002.jpg', data: 'deep' },
            { name: '004.tmp', data: 'half' },
            { name: '005.jpg', data: 'five' }
        ]);
        await extractCbzPages(file, directory);
        expect(readdirSync(directory)).toEqual(['005.jpg']);
    });

    it.each(['../001.jpg', '/001.jpg'])('refuses an archive with the name %s and writes nothing outside the folder', async (name) => {
        const { file, directory } = prepare([{ name, data: 'escape' }]);
        await expect(extractCbzPages(file, directory)).rejects.toThrow();
        expect(readdirSync(directory)).toEqual([]);
        expect(existsSync(join(directory, '..', '001.jpg'))).toBe(false);
    });

    it('writes nothing for an archive with no page', async () => {
        const { file, directory } = prepare([{ name: 'ComicInfo.xml', data: '<ComicInfo/>' }]);
        await extractCbzPages(file, directory);
        expect(readdirSync(directory)).toEqual([]);
    });

    it('fails for a file that is not a ZIP and for one that is gone', async () => {
        const root = makeTempDir();
        const directory = join(root, 'out');
        mkdirSync(directory);
        const bad = join(root, 'bad.cbz');
        writeFileSync(bad, 'not a zip');
        await expect(extractCbzPages(bad, directory)).rejects.toThrow();
        await expect(extractCbzPages(join(root, 'gone.cbz'), directory)).rejects.toThrow();
        expect(readdirSync(directory)).toEqual([]);
    });

    it('fails when the folder to write into is not there', async () => {
        const { file, directory } = prepare([{ name: '001.jpg', data: 'one' }]);
        await expect(extractCbzPages(file, join(directory, 'missing'))).rejects.toThrow();
    });
});
