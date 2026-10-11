import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { comparePageNames, CACHED_CHAPTERS, isImageName, LocalPages, LocalPagesError } from '@main/services/manga/localPages';
import { craftZip } from '../../../helpers/craftZip';
import { cleanTempDirs, makeTempDir } from '../../../helpers/tempDir';

afterEach(() => {
    cleanTempDirs();
});

function writeCbz(dir: string, name: string, entries: Array<{ name: string; data?: string }>): string {
    const path = join(dir, name);
    writeFileSync(path, craftZip(entries));
    return path;
}

describe('isImageName and comparePageNames', () => {
    it.each(['001.jpg', 'a.JPEG', 'x.png', 'y.webp', 'z.gif', 'w.avif'])('takes %s for an image', (name) => {
        expect(isImageName(name)).toBe(true);
    });

    it.each(['ComicInfo.xml', 'notes.txt', 'folder/', 'x.jpg/', 'noextension'])('does not take %s for an image', (name) => {
        expect(isImageName(name)).toBe(false);
    });

    it('orders the pages by their numbers, whatever their width', () => {
        expect(['10.png', '2.png', '1.png', '010.png'].sort(comparePageNames)).toEqual(['1.png', '2.png', '10.png', '010.png']);
    });
});

describe('LocalPages from a CBZ', () => {
    it('counts the images only, in reading order, and reads a page', async () => {
        const dir = makeTempDir();
        const path = writeCbz(dir, 'Chapter 1.cbz', [
            { name: '002.png', data: 'two' },
            { name: 'ComicInfo.xml', data: '<ComicInfo/>' },
            { name: '001.png', data: 'one' },
            { name: '010.png', data: 'ten' },
            { name: 'readme.txt', data: 'x' }
        ]);
        const pages = new LocalPages();
        await expect(pages.count(path)).resolves.toBe(3);
        await expect(pages.read(path, 0)).resolves.toEqual(Buffer.from('one'));
        await expect(pages.read(path, 1)).resolves.toEqual(Buffer.from('two'));
        await expect(pages.read(path, 2)).resolves.toEqual(Buffer.from('ten'));
    });

    it('refuses a page that is not there', async () => {
        const path = writeCbz(makeTempDir(), 'c.cbz', [{ name: '001.png', data: 'one' }]);
        const pages = new LocalPages();
        await expect(pages.read(path, 1)).rejects.toThrow(LocalPagesError);
        await expect(pages.read(path, -1)).rejects.toThrow('There is no such page');
        await expect(pages.read(path, 0.5)).rejects.toThrow('There is no such page');
    });

    it('fails for a file that is not a ZIP, and for one that is gone', async () => {
        const dir = makeTempDir();
        const bad = join(dir, 'bad.cbz');
        writeFileSync(bad, 'not a zip');
        const pages = new LocalPages();
        await expect(pages.count(bad)).rejects.toThrow();
        await expect(pages.count(join(dir, 'missing.cbz'))).rejects.toThrow();
    });

    it('lists a chapter again when its file changed', async () => {
        const dir = makeTempDir();
        const path = writeCbz(dir, 'c.cbz', [{ name: '001.png', data: 'one' }]);
        const pages = new LocalPages();
        await expect(pages.count(path)).resolves.toBe(1);
        writeFileSync(path, craftZip([{ name: '001.png', data: 'one' }, { name: '002.png', data: 'two' }]));
        utimesSync(path, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
        await expect(pages.count(path)).resolves.toBe(2);
    });

    it('keeps the list of the last few chapters only', async () => {
        const dir = makeTempDir();
        const pages = new LocalPages();
        const paths = Array.from({ length: CACHED_CHAPTERS + 1 }, (_unused, index) => {
            return writeCbz(dir, `c${String(index)}.cbz`, [{ name: '001.png', data: 'x' }]);
        });
        for (const path of paths) {
            await pages.count(path);
        }
        // Every chapter can still be read, the oldest list is made again.
        await expect(pages.read(paths[0]!, 0)).resolves.toEqual(Buffer.from('x'));
        await expect(pages.read(paths.at(-1)!, 0)).resolves.toEqual(Buffer.from('x'));
    });
});

describe('LocalPages from a folder of images', () => {
    it('counts the images only, in reading order, and reads a page', async () => {
        const folder = join(makeTempDir(), 'Chapter 1');
        mkdirSync(folder);
        writeFileSync(join(folder, '002.jpg'), 'two');
        writeFileSync(join(folder, '001.jpg'), 'one');
        writeFileSync(join(folder, 'ComicInfo.xml'), '<ComicInfo/>');
        mkdirSync(join(folder, 'sub.png'));
        const pages = new LocalPages();
        await expect(pages.count(folder)).resolves.toBe(2);
        await expect(pages.read(folder, 0)).resolves.toEqual(Buffer.from('one'));
        await expect(pages.read(folder, 1)).resolves.toEqual(Buffer.from('two'));
        await expect(pages.read(folder, 2)).rejects.toThrow('There is no such page');
    });
});
